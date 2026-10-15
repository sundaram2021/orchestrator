import type { ServerEvent, ServerModel } from "./OpenCodeServer.js";

export interface ServerHandle {
  url(cwd: string): Promise<string>;
  createSession(model: ServerModel, title?: string): Promise<string>;
  sendMessage(sessionID: string, model: ServerModel, text: string, system?: string): Promise<void>;
  abort(sessionID: string): Promise<void>;
  subscribe(listener: (event: ServerEvent) => void): () => void;
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

export class OpenCodeServerPool {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly factory: (env: NodeJS.ProcessEnv) => ServerHandle,
    private readonly env: NodeJS.ProcessEnv,
    private readonly options: PoolOptions = {},
  ) {}

  size(): number {
    return this.entries.size;
  }

  active(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.active;
    return total;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private get idleMs(): number {
    return this.options.idleMs ?? DEFAULT_IDLE_MS;
  }

  private ensure(cwd: string): Entry {
    let entry = this.entries.get(cwd);
    if (!entry) {
      entry = { server: this.factory(this.env), active: 0, lastUsed: this.now() };
      this.entries.set(cwd, entry);
    }
    return entry;
  }

  async probe(cwd: string): Promise<ServerHandle> {
    const entry = this.ensure(cwd);
    await entry.server.url(cwd);
    return entry.server;
  }

  async acquire(cwd: string): Promise<ServerHandle> {
    const entry = this.ensure(cwd);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    entry.active++;
    entry.lastUsed = this.now();
    return entry.server;
  }

  release(cwd: string): void {
    const entry = this.entries.get(cwd);
    if (!entry) return;
    entry.active = Math.max(0, entry.active - 1);
    entry.lastUsed = this.now();
    if (entry.active === 0) this.scheduleIdle(cwd);
  }

  peek(cwd: string): ServerHandle | undefined {
    return this.entries.get(cwd)?.server;
  }

  async drop(cwd: string): Promise<void> {
    const entry = this.entries.get(cwd);
    if (!entry) return;
    this.entries.delete(cwd);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    await entry.server.dispose();
  }

  private scheduleIdle(cwd: string): void {
    const entry = this.entries.get(cwd);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => void this.evict(cwd), this.idleMs);
    entry.idleTimer.unref?.();
  }

  private async evict(cwd: string): Promise<void> {
    const entry = this.entries.get(cwd);
    if (!entry || entry.active > 0) return;
    this.entries.delete(cwd);
    await entry.server.dispose();
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
