import type { ChildProcess } from "node:child_process";
import { errMessage } from "../util/coerce.js";
import { existsSync } from "node:fs";
import type { HarnessStatus, ModelDescriptor, Usage } from "@orchestrator/contracts";
import { killTree, runCapture, spawnStream } from "../util/process.js";
import { uid } from "../util/ids.js";
import { logger } from "../util/logger.js";
import { cleanToolText } from "../util/text.js";
import { parseOpenCodeModels } from "../models/catalog.js";
import { openCodeBridgeConfig } from "../config/paths.js";
import { OpenCodeServer, type ServerEvent, type ServerModel } from "./OpenCodeServer.js";
import { OpenCodeServerPool, type ServerHandle } from "./OpenCodeServerPool.js";
import type { HarnessAdapter, ProviderEvent, SessionHandle, TurnAttachment, TurnOptions } from "./HarnessAdapter.js";

const log = logger("adapter:opencode");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const harnessEnv = (): NodeJS.ProcessEnv =>
  existsSync(openCodeBridgeConfig)
    ? { ...process.env, OPENCODE_CONFIG: openCodeBridgeConfig }
    : process.env;

const parseModelRef = (model: string): { model: string; variant?: string } => {
  const hash = model.indexOf("#");
  if (hash === -1) return { model };
  return { model: model.slice(0, hash), variant: model.slice(hash + 1) };
};

const toServerModel = (model: string): ServerModel => {
  const { model: base, variant } = parseModelRef(model);
  const slash = base.indexOf("/");
  const providerID = slash === -1 ? "opencode" : base.slice(0, slash);
  const modelID = slash === -1 ? base : base.slice(slash + 1);
  return { providerID, modelID, ...(variant ? { variant } : {}) };
};

interface PartShape {
  id?: string;
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  time?: { end?: number };
  state?: { status?: string; input?: unknown; output?: string };
}

interface MessageInfoShape {
  role?: string;
  error?: ProviderErrorShape;
  modelID?: string;
  providerID?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    total?: number;
    cache?: { read?: number; write?: number };
  };
}

interface ProviderErrorShape {
  message?: string;
  data?: { message?: string };
}

const errorMessage = (err: unknown, fallback: string): string => {
  if (!err || typeof err !== "object") return fallback;
  const shaped = err as ProviderErrorShape;
  if (typeof shaped.message === "string" && shaped.message) return shaped.message;
  if (typeof shaped.data?.message === "string" && shaped.data.message) return shaped.data.message;
  return fallback;
};

const toUsage = (info: MessageInfoShape, limits: Map<string, number>): Usage | null => {
  const tokens = info.tokens;
  if (!tokens || typeof tokens.input !== "number") return null;
  const input = tokens.input;
  const output = typeof tokens.output === "number" ? tokens.output : 0;
  const reasoning = typeof tokens.reasoning === "number" ? tokens.reasoning : undefined;
  const cacheRead = typeof tokens.cache?.read === "number" ? tokens.cache.read : undefined;
  const cacheWrite = typeof tokens.cache?.write === "number" ? tokens.cache.write : undefined;
  const hasTokens =
    input > 0 || output > 0 || (reasoning ?? 0) > 0 || (cacheRead ?? 0) > 0 || (cacheWrite ?? 0) > 0;
  if (!hasTokens) return null;
  const total =
    typeof tokens.total === "number"
      ? tokens.total
      : input + output + (reasoning ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  const key = info.providerID && info.modelID ? `${info.providerID}/${info.modelID}` : "";
  const contextLimit = limits.get(key);
  return {
    input,
    output,
    total,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    ...(typeof info.cost === "number" ? { cost: info.cost } : {}),
    ...(contextLimit ? { contextLimit } : {}),
  };
};

export function parseRunLine(line: string): ProviderEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }
  const type = obj.type;
  const part = (obj.part ?? {}) as Record<string, unknown>;

  if (type === "error") {
    const err = (obj.error ?? part.error) as Record<string, unknown> | undefined;
    const message = typeof err?.message === "string" ? err.message : "opencode error";
    return [{ kind: "error", message }];
  }

  if (type === "text" && typeof part.text === "string") {
    return [{ kind: "assistant", text: part.text }];
  }

  if (type === "reasoning" && typeof part.text === "string") {
    return [{ kind: "reasoning", text: part.text }];
  }

  if (type === "tool") {
    const tool = typeof part.tool === "string" ? part.tool : "tool";
    const callId = typeof part.callID === "string" ? part.callID : uid("call");
    const state = (part.state ?? {}) as Record<string, unknown>;
    const out: ProviderEvent[] = [];
    const input = state.input ? JSON.stringify(state.input) : "{}";
    out.push({ kind: "tool", callId, tool, args: input });
    if (state.status === "completed" || typeof state.output === "string") {
      const output = cleanToolText(String(state.output ?? ""));
      out.push({
        kind: "toolResult",
        callId,
        ok: state.status !== "error",
        result: output.text,
        ...(output.truncated ? { truncated: true } : {}),
      });
    }
    return out;
  }

  return [];
}

export class OpenCodeAdapter implements HarnessAdapter {
  readonly id = "opencode";
  readonly name = "OpenCode";
  readonly color = "#5b8def";
  readonly canExecute = true;

  private state: HarnessStatus = "disabled";
  private available = false;
  private readonly children = new Map<string, ChildProcess>();
  private poolInstance: OpenCodeServerPool | null = null;
  private liveServer = true;
  private readonly limitCache = new Map<string, number>();

  private async limitsFor(server: ServerHandle): Promise<Map<string, number>> {
    if (this.limitCache.size) return this.limitCache;
    try {
      const limits = await server.providerLimits();
      for (const [key, value] of limits) this.limitCache.set(key, value);
    } catch {
      /* ignore — context limit stays unknown */
    }
    return this.limitCache;
  }

  private get pool(): OpenCodeServerPool {
    if (!this.poolInstance) {
      this.poolInstance = new OpenCodeServerPool((env) => new OpenCodeServer(env), harnessEnv());
    }
    return this.poolInstance;
  }

  get status(): HarnessStatus {
    return this.state;
  }

  async detect(): Promise<boolean> {
    const res = await runCapture("opencode", ["--version"], { timeoutMs: 15000 });
    this.available = !res.failed && /\d+\.\d+/.test(res.stdout || res.stderr);
    return this.available;
  }

  async start(): Promise<void> {
    this.state = "connecting";
    const ok = await this.detect();
    this.state = ok ? "connected" : "error";
    log.info(`opencode ${ok ? "connected" : "unavailable"}`);
  }

  async stop(): Promise<void> {
    for (const child of this.children.values()) killTree(child);
    this.children.clear();
    await this.poolInstance?.disposeAll();
    this.poolInstance = null;
    this.state = "disabled";
  }

  async models(): Promise<ModelDescriptor[]> {
    const res = await runCapture("opencode", ["models"], { timeoutMs: 30000 });
    if (res.failed) return [];
    return parseOpenCodeModels(res.stdout).map((m) => ({ id: m.id, name: m.short }));
  }

  async startSession(cwd: string): Promise<SessionHandle> {
    return { id: uid("ses_"), cwd };
  }

  async interrupt(session: SessionHandle): Promise<void> {
    const child = this.children.get(session.id);
    if (child) {
      killTree(child);
      this.children.delete(session.id);
    }
    const server = this.poolInstance?.peek(session.cwd);
    if (session.externalId && server) await server.abort(session.externalId);
  }

  async disposeWorkspace(dir: string): Promise<void> {
    await this.poolInstance?.drop(dir);
  }

  private simulate(model: string): AsyncIterable<ProviderEvent> {
    const steps: Array<{ wait: number; event: ProviderEvent }> = [
      { wait: 400, event: { kind: "system", text: `OpenCode unavailable — running in simulation · ${model}` } },
      {
        wait: 900,
        event: { kind: "assistant", text: "Reading the request and planning the steps." },
      },
      { wait: 700, event: { kind: "tool", callId: uid("call"), tool: "read", args: '{"path":"src/main.ts"}' } },
      { wait: 500, event: { kind: "assistant", text: "\n\nApplying the change." } },
      { wait: 700, event: { kind: "done" } },
    ];
    return (async function* () {
      for (const step of steps) {
        await sleep(step.wait);
        yield step.event;
      }
    })();
  }

  private runTurn(
    session: SessionHandle,
    prompt: string,
    model: string,
    system?: string,
    attachments?: TurnAttachment[],
  ): AsyncIterable<ProviderEvent> {
    const children = this.children;
    const modelRef = parseModelRef(model);
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;

    async function* run(): AsyncGenerator<ProviderEvent> {
      const args = ["run", fullPrompt, "--format", "json", "-m", modelRef.model];
      if (modelRef.variant) args.push("--variant", modelRef.variant);
      for (const a of attachments ?? []) {
        if (a.path) args.push("-f", a.path);
      }
      const child = spawnStream("opencode", args, { cwd: session.cwd, env: harnessEnv() });
      children.set(session.id, child);

      let buffer = "";
      const errored = { value: false };
      const lines: string[] = [];
      let notify: (() => void) | null = null;

      child.stdout.on("data", (d: Buffer) => {
        buffer += d.toString();
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          lines.push(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 1);
        }
        notify?.();
      });
      child.stderr.on("data", (d: Buffer) => log.debug(d.toString().trim()));
      child.on("error", (err) => {
        errored.value = true;
        lines.push(JSON.stringify({ type: "error", error: { message: String(err) } }));
        notify?.();
      });

      const closed = new Promise<number>((resolve) => {
        child.on("close", (code) => {
          if (buffer.trim()) lines.push(buffer);
          resolve(code ?? 0);
          notify?.();
        });
      });

      while (true) {
        if (lines.length === 0) {
          const closedNow = await Promise.race([
            closed.then(() => "closed" as const),
            new Promise<"tick">((r) => {
              notify = () => r("tick");
            }),
          ]);
          notify = null;
          if (closedNow === "closed" && lines.length === 0) break;
          continue;
        }
        const line = lines.shift()!;
        for (const evt of parseRunLine(line)) {
          if (evt.kind === "error") errored.value = true;
          yield evt;
        }
      }

      const code = await closed;
      children.delete(session.id);
      if (code !== 0 && !errored.value) {
        yield { kind: "error", message: `opencode exited with code ${code}` };
        return;
      }
      if (code === 0) yield { kind: "done" };
    }

    return run();
  }

  private serveTurn(
    session: SessionHandle,
    prompt: string,
    model: string,
    system?: string,
    attachments?: TurnAttachment[],
  ): AsyncIterable<ProviderEvent> {
    const self = this;
    const modelRef = toServerModel(model);

    async function* serve(): AsyncGenerator<ProviderEvent> {
      const server = await self.pool.acquire(session.cwd);

      const queue: ServerEvent[] = [];
      let notify: (() => void) | null = null;
      let finished = false;
      const streamedParts = new Set<string>();
      const partTypes = new Map<string, string>();
      const toolState = new Map<string, "called" | "done">();
      let unsub: (() => void) | null = null;

      try {
        let serverID = session.externalId;
        if (!serverID) {
          serverID = await server.createSession(modelRef, session.cwd);
          session.externalId = serverID;
        }

        const limits = await self.limitsFor(server);

        unsub = server.subscribe((event) => {
          const sid = event.properties?.sessionID;
          if (typeof sid === "string" && sid !== serverID) return;
          queue.push(event);
          notify?.();
        });

        const post = server.sendMessage(serverID, modelRef, prompt, system, attachments).catch((err: unknown) => {
          queue.push({ type: "__error", properties: { message: errMessage(err) } });
          notify?.();
        });

        while (true) {
          if (queue.length === 0) {
            if (finished) break;
            await new Promise<void>((resolve) => {
              notify = () => resolve();
            });
            notify = null;
            continue;
          }
          const event = queue.shift()!;
          const props = event.properties ?? {};

          switch (event.type) {
            case "__error":
              yield { kind: "error", message: String(props.message ?? "opencode error") };
              return;
            case "message.part.delta": {
              const delta = props.delta;
              const partID = props.partID;
              if (props.field === "text" && typeof delta === "string" && delta) {
                const kind = typeof partID === "string" ? partTypes.get(partID) : undefined;
                if (typeof partID === "string") streamedParts.add(partID);
                if (kind === "reasoning") yield { kind: "reasoning", text: delta };
                else yield { kind: "assistant", text: delta };
              }
              break;
            }
            case "message.part.updated": {
              const part = props.part as PartShape | undefined;
              if (!part) break;
              if (part.id && part.type) partTypes.set(part.id, part.type);
              if (
                part.type === "text" &&
                typeof part.text === "string" &&
                part.id &&
                part.time?.end &&
                !streamedParts.has(part.id)
              ) {
                streamedParts.add(part.id);
                if (part.text) yield { kind: "assistant", text: part.text };
              } else if (
                part.type === "reasoning" &&
                typeof part.text === "string" &&
                part.id &&
                part.time?.end &&
                !streamedParts.has(part.id)
              ) {
                streamedParts.add(part.id);
                if (part.text) yield { kind: "reasoning", text: part.text };
              } else if (part.type === "tool" && part.callID) {
                const callId = part.callID;
                const state = part.state ?? {};
                if (!toolState.has(callId)) {
                  toolState.set(callId, "called");
                  yield {
                    kind: "tool",
                    callId,
                    tool: part.tool ?? "tool",
                    args: JSON.stringify(state.input ?? {}),
                  };
                }
                if ((state.status === "completed" || state.status === "error") && toolState.get(callId) !== "done") {
                  toolState.set(callId, "done");
                  const output = cleanToolText(String(state.output ?? ""));
                  yield {
                    kind: "toolResult",
                    callId,
                    ok: state.status !== "error",
                    result: output.text,
                    ...(output.truncated ? { truncated: true } : {}),
                  };
                }
              }
              break;
            }
            case "message.updated": {
              const info = props.info as MessageInfoShape | undefined;
              if (info?.role === "assistant") {
                if (info.error) {
                  yield { kind: "error", message: errorMessage(info.error, "opencode error") };
                }
                const usage = toUsage(info, limits);
                if (usage) yield { kind: "usage", usage };
              }
              break;
            }
            case "session.idle":
              finished = true;
              break;
            case "session.error": {
              yield { kind: "error", message: errorMessage(props.error, "opencode session error") };
              finished = true;
              break;
            }
            default:
              break;
          }
        }
        await post;
        yield { kind: "done" };
      } finally {
        unsub?.();
        self.pool.release(session.cwd);
      }
    }

    return serve();
  }

  sendTurn(
    session: SessionHandle,
    prompt: string,
    model: string,
    options?: TurnOptions,
  ): AsyncIterable<ProviderEvent> {
    if (!this.available) return this.simulate(model);
    if (!this.liveServer) return this.runTurn(session, prompt, model, options?.system, options?.attachments);

    const self = this;
    async function* guarded(): AsyncGenerator<ProviderEvent> {
      try {
        await self.pool.probe(session.cwd);
      } catch (err) {
        self.liveServer = false;
        log.warn("opencode serve unavailable, falling back to run mode", err instanceof Error ? err.message : err);
        await self.pool.drop(session.cwd).catch(() => undefined);
        yield* self.runTurn(session, prompt, model, options?.system, options?.attachments);
        return;
      }
      yield* self.serveTurn(session, prompt, model, options?.system, options?.attachments);
    }
    return guarded();
  }
}
