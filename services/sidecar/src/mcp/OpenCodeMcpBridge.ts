import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LoadedMcpServer, McpTransportSpec } from "./mcpConfig.js";
import { openCodeBridgeConfigs } from "../config/paths.js";
import { MCP_PROFILES, type McpProfile } from "./profile.js";
import { logger } from "../util/logger.js";

const log = logger("mcp:bridge");

export type OpenCodeMcpEntry =
  | {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
      enabled: boolean;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
      enabled: boolean;
    };

const toEntry = (transport: McpTransportSpec, enabled: boolean): OpenCodeMcpEntry => {
  if (transport.kind === "stdio") {
    return {
      type: "local",
      command: [transport.command, ...transport.args],
      ...(Object.keys(transport.env).length ? { environment: transport.env } : {}),
      enabled,
    };
  }
  return {
    type: "remote",
    url: transport.url,
    ...(Object.keys(transport.headers).length ? { headers: transport.headers } : {}),
    enabled,
  };
};

export interface OpenCodeBridgeConfig {
  $schema: string;
  mcp: Record<string, OpenCodeMcpEntry>;
}

export function buildBridgeConfig(
  servers: LoadedMcpServer[],
  builtins: Record<string, OpenCodeMcpEntry> = {},
  profile: McpProfile = "agents",
): OpenCodeBridgeConfig {
  const mcp: Record<string, OpenCodeMcpEntry> = {};
  for (const server of servers) {
    if (!server.transport) continue;
    const enabled =
      profile === "agents" ? server.config.enabled && server.config.route : false;
    mcp[server.config.name] = toEntry(server.transport, enabled);
  }
  for (const [name, entry] of Object.entries(builtins)) {
    mcp[name] = entry;
  }
  return { $schema: "https://opencode.ai/config.json", mcp };
}

export class OpenCodeMcpBridge {
  private readonly lastJson = new Map<McpProfile, string>();
  private readonly paths: Record<McpProfile, string>;
  private readonly builtins = new Map<string, OpenCodeMcpEntry>();

  constructor(paths: Record<McpProfile, string> = openCodeBridgeConfigs) {
    this.paths = paths;
  }

  setBuiltin(name: string, entry: OpenCodeMcpEntry): void {
    this.builtins.set(name, entry);
  }

  sync(servers: LoadedMcpServer[]): Record<McpProfile, string> {
    for (const profile of MCP_PROFILES) {
      this.write(profile, servers);
    }
    return this.paths;
  }

  private write(profile: McpProfile, servers: LoadedMcpServer[]): void {
    const path = this.paths[profile];
    const payload = JSON.stringify(
      buildBridgeConfig(servers, Object.fromEntries(this.builtins), profile),
      null,
      2,
    );
    if (payload === this.lastJson.get(profile)) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, payload, { mode: 0o600 });
      renameSync(tmp, path);
      this.lastJson.set(profile, payload);
      const routed = servers.filter(
        (server) => server.config.enabled && server.config.route && server.transport,
      ).length;
      log.info(
        profile === "agents"
          ? `routed ${routed} MCP servers to agents -> ${path}`
          : `wrote orchestrator MCP profile -> ${path}`,
      );
    } catch (err) {
      log.warn(`failed to write ${path}`, err instanceof Error ? err.message : err);
    }
  }
}
