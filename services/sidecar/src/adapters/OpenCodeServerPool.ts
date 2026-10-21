import type { ServerEvent, ServerModel } from "./OpenCodeServer.js";
import type { McpProfile } from "../mcp/profile.js";

export interface ServerHandle {
  url(cwd: string): Promise<string>;
  createSession(model: ServerModel, title?: string): Promise<string>;
  sendMessage(
    sessionID: string,
    model: ServerModel,
    text: string,
    system?: string,
    attachments?: { name: string; mime: string; data: string }[],
  ): Promise<void>;
  abort(sessionID: string): Promise<void>;
  summarize(sessionID: string, model: ServerModel): Promise<boolean>;
  subscribe(listener: (event: ServerEvent) => void): () => void;
  providerLimits(): Promise<Map<string, number>>;
  dispose(): Promise<void>;
}

export interface PoolOptions {
  idleMs?: number;
  now?: () => number;
}

interface Entry {
  server: ServerHandle;
  active: number;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
}

const DEFAULT_IDLE_MS = 5 * 60_000;

const keyFor = (cwd: string, profile: McpProfile): string => `${profile}\u0000${cwd}`;

export class OpenCodeServerPool {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly factory: (profile: McpProfile, env: NodeJS.ProcessEnv) => ServerHandle,
    private readonly envFor: (profile: McpProfile) => NodeJS.ProcessEnv,
    private readonly options: PoolOptions = {},
  ) {}

  size(): number {
    return this.entries.size;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private get idleMs(): number {
    return this.options.idleMs ?? DEFAULT_IDLE_MS;
  }

  private ensure(cwd: string, profile: McpProfile): Entry {
    const key = keyFor(cwd, profile);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        server: this.factory(profile, this.envFor(profile)),
        active: 0,
        lastUsed: this.now(),
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  async probe(cwd: string, profile: McpProfile = "agents"): Promise<ServerHandle> {
    const entry = this.ensure(cwd, profile);
    await entry.server.url(cwd);
    return entry.server;
  }

  async acquire(cwd: string, profile: McpProfile = "agents"): Promise<ServerHandle> {
    const entry = this.ensure(cwd, profile);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    entry.active++;
    entry.lastUsed = this.now();
    return entry.server;
  }

  release(cwd: string, profile: McpProfile = "agents"): void {
    const key = keyFor(cwd, profile);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.active = Math.max(0, entry.active - 1);
    entry.lastUsed = this.now();
    if (entry.active === 0) this.scheduleIdle(key);
  }

  peek(cwd: string, profile: McpProfile = "agents"): ServerHandle | undefined {
    return this.entries.get(keyFor(cwd, profile))?.server;
  }

  async drop(cwd: string, profile?: McpProfile): Promise<void> {
    const keys = profile
      ? [keyFor(cwd, profile)]
      : [...this.entries.keys()].filter((key) => key.endsWith(`\u0000${cwd}`));
    await Promise.all(keys.map((key) => this.dropKey(key)));
  }

  private async dropKey(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    await entry.server.dispose();
  }

  private scheduleIdle(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => void this.evict(key), this.idleMs);
    entry.idleTimer.unref?.();
  }

  private async evict(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.active > 0) return;
    await this.dropKey(key);
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      entries.map((entry) => {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        return entry.server.dispose();
      }),
    );
  }
}
