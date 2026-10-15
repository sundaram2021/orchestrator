import { existsSync } from "node:fs";
import type { HarnessStatus, ModelDescriptor } from "@orchestrator/contracts";
import { configPaths } from "../config/paths.js";
import { spawnDetached } from "../util/process.js";
import { logger } from "../util/logger.js";
import type { HarnessAdapter, LaunchableHarness, ProviderEvent, SessionHandle } from "./HarnessAdapter.js";

const log = logger("adapter:antigravity");

const LAUNCH_CANDIDATES = ["antigravity-ide.cmd", "antigravity-ide", "Antigravity IDE.exe"];

export class AntigravityAdapter implements HarnessAdapter, LaunchableHarness {
  readonly id = "antigravity";
  readonly name = "Antigravity";
  readonly color = "#c792ea";
  readonly canExecute = false;

  private state: HarnessStatus = "model-source-only";

  get status(): HarnessStatus {
    return this.state;
  }

  async detect(): Promise<boolean> {
    return existsSync(configPaths.antigravityMcp) || existsSync(configPaths.antigravityIdeMcp);
  }

  async start(): Promise<void> {
    const present = await this.detect();
    this.state = present ? "model-source-only" : "error";
  }

  async stop(): Promise<void> {
    this.state = "model-source-only";
  }

  async models(): Promise<ModelDescriptor[]> {
    return [];
  }

  async startSession(cwd: string): Promise<SessionHandle> {
    return { id: `ag_${cwd}`, cwd };
  }

  sendTurn(_session: SessionHandle, _prompt: string, _model: string): AsyncIterable<ProviderEvent> {
    return (async function* () {
      yield {
        kind: "error",
        message: "Antigravity is a model source only; run its models through OpenCode.",
      };
      yield { kind: "done" };
    })();
  }

  async interrupt(_session: SessionHandle): Promise<void> {
    return;
  }

  async launch(): Promise<{ ok: boolean; detail: string }> {
    let lastError = "no launcher found";
    for (const candidate of LAUNCH_CANDIDATES) {
      try {
        await spawnDetached(candidate, []);
        return { ok: true, detail: `launched ${candidate}` };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    log.warn("failed to launch Antigravity IDE", lastError);
    return { ok: false, detail: lastError };
  }
}
