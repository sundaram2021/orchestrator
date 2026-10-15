import type { HarnessAdapter } from "./HarnessAdapter.js";
import { logger } from "../util/logger.js";

const log = logger("adapters");

export class AdapterManager {
  private readonly adapters = new Map<string, HarnessAdapter>();
  private fallbackId: string | null = null;

  register(adapter: HarnessAdapter, options: { fallback?: boolean } = {}): void {
    this.adapters.set(adapter.id, adapter);
    if (options.fallback) this.fallbackId = adapter.id;
  }

  get(id: string): HarnessAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): HarnessAdapter[] {
    return [...this.adapters.values()];
  }

  executorFor(harnessId: string): HarnessAdapter | undefined {
    const direct = this.adapters.get(harnessId);
    if (direct?.canExecute && direct.status === "connected") return direct;
    if (this.fallbackId) {
      const fallback = this.adapters.get(this.fallbackId);
      if (fallback?.canExecute) return fallback;
    }
    return direct;
  }

  async startAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.start();
      } catch (err) {
        log.error(`failed to start ${adapter.id}`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.stop();
      } catch (err) {
        log.error(`failed to stop ${adapter.id}`, err);
      }
    }
  }
}
