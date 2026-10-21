import { readFileSync } from "node:fs";
import type { McpServerConfig } from "@orchestrator/contracts";
import { configPaths } from "../config/paths.js";
import { asStringRecord } from "../util/coerce.js";
import { logger } from "../util/logger.js";

const log = logger("mcp:config");

const readJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export type McpTransportSpec =
  | { kind: "http"; url: string; headers: Record<string, string> }
  | { kind: "stdio"; command: string; args: string[]; env: Record<string, string> };

export interface LoadedMcpServer {
  config: McpServerConfig;
  transport: McpTransportSpec | null;
}

interface OpenCodeMcpEntry {
  type?: string;
  command?: string[];
  url?: string;
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  enabled?: boolean;
}

function fromOpenCode(file: string): LoadedMcpServer[] {
  const json = readJson(file);
  const mcp = (json?.mcp ?? {}) as Record<string, OpenCodeMcpEntry>;
  return Object.entries(mcp).map(([name, entry]) => {
    const isLocal = (entry.type ?? "local") === "local";
    const command = entry.command ?? [];
    const config: McpServerConfig = {
      name,
      transport: isLocal ? "stdio" : ((entry.type as "sse" | "http") ?? "http"),
      source: "opencode",
      detail: isLocal ? command.join(" ") : (entry.url ?? "remote"),
      tools: [],
      status: "disabled",
      enabled: entry.enabled ?? true,
      route: false,
    };
    const transport: McpTransportSpec | null = isLocal
      ? command[0]
        ? { kind: "stdio", command: command[0], args: command.slice(1), env: asStringRecord(entry.environment) }
        : null
      : entry.url
        ? { kind: "http", url: entry.url, headers: asStringRecord(entry.headers) }
        : null;
    return { config, transport };
  });
}

function fromAntigravity(file: string, source: string): LoadedMcpServer[] {
  const json = readJson(file);
  const servers = (json?.mcpServers ?? {}) as Record<
    string,
    { serverUrl?: string; url?: string; headers?: Record<string, string> }
  >;
  return Object.entries(servers).map(([name, entry]) => {
    const url = entry.serverUrl ?? entry.url;
    const config: McpServerConfig = {
      name,
      transport: "http",
      source,
      detail: url ?? "remote",
      tools: [],
      status: "disabled",
      enabled: true,
      route: false,
    };
    const transport: McpTransportSpec | null = url
      ? { kind: "http", url, headers: asStringRecord(entry.headers) }
      : null;
    return { config, transport };
  });
}

export function loadMcpServers(): LoadedMcpServer[] {
  const servers: LoadedMcpServer[] = [];
  try {
    servers.push(...fromOpenCode(configPaths.opencode));
  } catch (err) {
    log.warn("failed to read opencode mcp config", err);
  }
  servers.push(...fromAntigravity(configPaths.antigravityMcp, "antigravity"));
  servers.push(...fromAntigravity(configPaths.antigravityIdeMcp, "antigravity-ide"));
  servers.push({
    config: {
      name: "engram",
      transport: "http",
      source: "engram",
      detail: "https://www.engram-memory.com",
      tools: [],
      status: "disabled",
      enabled: false,
      route: false,
    },
    transport: { kind: "http", url: "https://www.engram-memory.com", headers: {} },
  });

  const byName = new Map<string, LoadedMcpServer>();
  for (const server of servers) {
    const existing = byName.get(server.config.name);
    if (existing) {
      existing.config.source = `${existing.config.source}, ${server.config.source}`;
      if (!existing.transport && server.transport) existing.transport = server.transport;
    } else {
      byName.set(server.config.name, server);
    }
  }
  return [...byName.values()];
}
