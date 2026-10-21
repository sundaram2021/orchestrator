import type { McpServerConfig, McpStatus } from "@orchestrator/contracts";
import { loadMcpServers, type LoadedMcpServer } from "./mcpConfig.js";
import { connectHttp, connectStdio, type McpConnection } from "./McpClient.js";
import { OpenCodeMcpBridge, type OpenCodeMcpEntry } from "./OpenCodeMcpBridge.js";
import { SettingsStore } from "../config/SettingsStore.js";
import { logger } from "../util/logger.js";
import { errMessage } from "../util/coerce.js";

const log = logger("mcp");

export class McpManager {
  private readonly servers: LoadedMcpServer[];
  private readonly connections = new Map<string, McpConnection>();
  private readonly listeners = new Set<(server: McpServerConfig) => void>();
  private readonly bridge: OpenCodeMcpBridge;

  constructor(
    bridge: OpenCodeMcpBridge = new OpenCodeMcpBridge(),
    private readonly settings: SettingsStore = new SettingsStore(),
  ) {
    this.bridge = bridge;
    this.servers = loadMcpServers();
    for (const server of this.servers) {
      server.config.enabled = this.settings.mcpEnabled(server.config.name, server.config.enabled);
      server.config.route = this.settings.mcpRouted(server.config.name, server.config.route);
    }
    this.syncBridge();
  }

  subscribe(listener: (server: McpServerConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private syncBridge(): void {
    this.bridge.sync(this.servers);
  }

  setBuiltin(name: string, entry: OpenCodeMcpEntry): void {
    this.bridge.setBuiltin(name, entry);
    this.syncBridge();
  }

  list(): McpServerConfig[] {
    return this.servers.map((s) => s.config);
  }

  private find(name: string): LoadedMcpServer | undefined {
    return this.servers.find((s) => s.config.name === name);
  }

  private update(
    config: McpServerConfig,
    status: McpStatus,
    tools?: string[],
    error?: string,
    schemaChars?: number,
  ): void {
    config.status = status;
    if (tools) {
      config.tools = tools;
      if (schemaChars !== undefined) config.schemaChars = schemaChars;
    }
    if (error) config.error = error;
    else delete config.error;
    for (const listener of this.listeners) listener(config);
  }

  setEnabled(name: string, enabled: boolean): McpServerConfig | undefined {
    const server = this.find(name);
    if (!server) return undefined;
    server.config.enabled = enabled;
    this.settings.setMcp(name, enabled);
    this.syncBridge();
    if (enabled) {
      this.update(server.config, "connecting");
      void this.connect(name);
    } else {
      this.connections.get(name)?.close();
      this.connections.delete(name);
      this.update(server.config, "disabled", []);
    }
    return server.config;
  }

  setRoute(name: string, route: boolean): McpServerConfig | undefined {
    const server = this.find(name);
    if (!server) return undefined;
    server.config.route = route;
    this.settings.setMcpRoute(name, route);
    this.syncBridge();
    return server.config;
  }

  async connect(name: string): Promise<McpServerConfig | undefined> {
    const server = this.find(name);
    if (!server || !server.config.enabled) return server?.config;
    if (!server.transport) {
      this.update(server.config, "error", []);
      return server.config;
    }
    try {
      const connection =
        server.transport.kind === "http"
          ? await connectHttp(server.transport.url, server.transport.headers)
          : await connectStdio(server.transport.command, server.transport.args, server.transport.env);
      const infos = await connection.listTools();
      const tools = infos.map((info) => info.name);
      const schemaChars = infos.reduce((sum, info) => sum + info.schemaChars, 0);
      this.connections.get(name)?.close();
      this.connections.set(name, connection);
      this.update(server.config, "connected", tools, undefined, schemaChars);
      log.info(`${name} connected (${tools.length} tools, ${schemaChars} schema chars)`);
    } catch (err) {
      this.connections.get(name)?.close();
      this.connections.delete(name);
      this.update(server.config, "error", [], errMessage(err));
      log.warn(`${name} connection failed`, err instanceof Error ? err.message : err);
    }
    return server.config;
  }

  async connectEnabled(): Promise<void> {
    await Promise.all(
      this.servers.filter((s) => s.config.enabled).map((s) => this.connect(s.config.name)),
    );
  }

  async callTool(name: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const connection = this.connections.get(name);
    if (!connection) throw new Error(`mcp server ${name} is not connected`);
    return connection.callTool(tool, args);
  }

  async stopAll(): Promise<void> {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    for (const server of this.servers) {
      if (server.config.status === "connected") server.config.status = "disabled";
    }
  }
}
