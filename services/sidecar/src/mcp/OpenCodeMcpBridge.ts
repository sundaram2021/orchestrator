import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LoadedMcpServer, McpTransportSpec } from "./mcpConfig.js";
import { openCodeBridgeConfig } from "../config/paths.js";
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
): OpenCodeBridgeConfig {
  const mcp: Record<string, OpenCodeMcpEntry> = {};
  for (const server of servers) {
    if (server.transport) {
      mcp[server.config.name] = toEntry(server.transport, server.config.enabled);
    }
  }
  for (const [name, entry] of Object.entries(builtins)) {
    mcp[name] = entry;
  }
  return { $schema: "https://opencode.ai/config.json", mcp };
}

export class OpenCodeMcpBridge {
  private lastJson = "";
  private readonly path: string;
  private readonly builtins = new Map<string, OpenCodeMcpEntry>();

  constructor(path = openCodeBridgeConfig) {
    this.path = path;
  }

  setBuiltin(name: string, entry: OpenCodeMcpEntry): void {
    this.builtins.set(name, entry);
  }

  sync(servers: LoadedMcpServer[]): string {
    const payload = JSON.stringify(
      buildBridgeConfig(servers, Object.fromEntries(this.builtins)),
      null,
      2,
    );
    if (payload === this.lastJson) return this.path;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, payload, { mode: 0o600 });
      renameSync(tmp, this.path);
      this.lastJson = payload;
      const enabled = servers.filter((s) => s.config.enabled && s.transport).length;
      log.info(`routed ${enabled} MCP servers to OpenCode -> ${this.path}`);
    } catch (err) {
      log.warn(`failed to write ${this.path}`, err instanceof Error ? err.message : err);
    }
    return this.path;
  }
}
