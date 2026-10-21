import path from "node:path";
import { mkdirSync } from "node:fs";
import type { AntigravityStatus, HarnessStatus, ModelDescriptor, Usage } from "@orchestrator/contracts";
import { runtimeDir } from "../config/paths.js";
import { uid } from "../util/ids.js";
import { logger } from "../util/logger.js";
import { cleanToolText } from "../util/text.js";
import { AcpClient, type AcpNotification } from "../antigravity/AcpClient.js";
import {
  ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE,
  ANTIGRAVITY_PERSONAL_AUTH,
  hasCredentials,
  parseAuthorizationLine,
  prepareProfile,
  forwardCallback,
  type AntigravityAuthConfig,
} from "../antigravity/Profile.js";
import {
  installRuntime,
  installState,
  resolveRuntime,
  type InstallProgress,
  type AntigravityRuntime,
} from "../antigravity/Installation.js";
import type { HarnessAdapter, ProviderEvent, SessionHandle, TurnOptions } from "./HarnessAdapter.js";

const log = logger("adapter:antigravity");

const DEFAULT_MODELS: ModelDescriptor[] = [
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
];

interface ConfigOption {
  id?: string;
  currentValue?: unknown;
  options?: Array<{ value?: string; name?: string; options?: Array<{ value?: string; name?: string }> }>;
}

interface LiveSession {
  client: AcpClient;
  sessionId: string;
  cwd: string;
  options: ConfigOption[];
}

export class AntigravityHarness implements HarnessAdapter {
  readonly id = "antigravity";
  readonly name = "Antigravity";
  readonly color = "#c792ea";
  readonly canExecute = true;

  private state: HarnessStatus = "disabled";
  private modelCache: ModelDescriptor[] = [];
  private readonly sessions = new Map<string, LiveSession>();
  private authConfig: AntigravityAuthConfig = ANTIGRAVITY_PERSONAL_AUTH;
  private mode = "yolo";
  private pendingSignIn:
    | { client: AcpClient; dir: string; url: string | null; resolve: (url: string) => void }
    | null = null;
  private onAuthUrl: ((url: string) => void) | null = null;

  get status(): HarnessStatus {
    return this.state;
  }

  getProfileDir(): string {
    return path.join(runtimeDir, "antigravity", "profile");
  }

  describe(): string {
    return this.statusInfo().detail;
  }

  private runtime(): AntigravityRuntime {
    const runtime = resolveRuntime();
    if (!runtime) throw new Error("Antigravity runtime is not installed. Install it in Settings.");
    return runtime;
  }

  async detect(): Promise<boolean> {
    return resolveRuntime() !== null;
  }

  async start(): Promise<void> {
    this.state = "connecting";
    this.state = (await this.detect()) ? "connected" : "disabled";
    log.info(`antigravity ${this.state}`);
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) session.client.close();
    this.sessions.clear();
    this.cancelSignIn();
    this.state = "disabled";
  }

  async models(): Promise<ModelDescriptor[]> {
    if (this.modelCache.length) return this.modelCache;
    if (installState().installed) return DEFAULT_MODELS;
    return [];
  }

  private captureModels(options: ConfigOption[]): void {
    const model = options.find((option) => option.id === "model");
    if (!model || !Array.isArray(model.options)) return;
    const models: ModelDescriptor[] = [];
    for (const entry of model.options) {
      const values = entry.options ?? [entry];
      for (const value of values) {
        if (typeof value.value === "string" && value.value) {
          models.push({ id: value.value, name: value.name ?? value.value });
        }
      }
    }
    if (models.length) this.modelCache = models;
  }

  statusInfo(): AntigravityStatus {
    const state = installState();
    const runtime = resolveRuntime();
    const signedIn = hasCredentials(this.getProfileDir());
    const detail = !state.installed
      ? "Not installed. Download the Antigravity agent to run its models."
      : !signedIn
        ? `Installed${state.version ? ` (${state.version})` : ""} · sign in with Google to run.`
        : `Ready${state.version ? ` (${state.version})` : ""} · signed in.`;
    return {
      installed: state.installed,
      signedIn,
      version: state.version ?? null,
      executablePath: runtime?.executablePath ?? null,
      detail,
    };
  }

  async install(onProgress?: (progress: InstallProgress) => void): Promise<AntigravityStatus> {
    await installRuntime(onProgress);
    this.state = "connected";
    return this.statusInfo();
  }

  async startSession(cwd: string): Promise<SessionHandle> {
    const runtime = this.runtime();
    const session = await this.spawnSession(runtime, cwd);
    const handle: SessionHandle = { id: uid("ag_"), cwd, externalId: session.sessionId };
    this.sessions.set(handle.id, session);
    return handle;
  }


  private async spawnSession(runtime: AntigravityRuntime, cwd: string): Promise<LiveSession> {
    const profileDir = this.getProfileDir();
    mkdirSync(cwd, { recursive: true });
    const { env } = prepareProfile({
      profileDirectory: profileDir,
      harnessPath: runtime.harnessPath,
      auth: this.authConfig,
    });
    const client = new AcpClient(
      {
        command: runtime.executablePath,
        args: process.platform === "linux" ? ["--uid="] : [],
        cwd,
        env,
      },
      {
        onStderrLine: (line) => this.handleAuthLine(line),
      },
    );
    await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "orchestrator", version: "0.1.0" },
    });
    await this.authenticate(client);
    const result = await client.request<{ sessionId?: string; configOptions?: ConfigOption[] }>(
      "session/new",
      { cwd, mcpServers: [] },
    );
    if (!result.sessionId) {
      client.close();
      throw new Error("Antigravity did not return a session id.");
    }
    const options = result.configOptions ?? [];
    this.captureModels(options);
    await client
      .request("session/set_mode", { sessionId: result.sessionId, modeId: this.mode })
      .catch((err) => log.warn(`antigravity set_mode failed: ${err instanceof Error ? err.message : err}`));
    return { client, sessionId: result.sessionId, cwd, options };
  }

  private async authenticate(client: AcpClient): Promise<void> {
    try {
      await client.request("authenticate", { methodId: this.authConfig.authMethod });
    } catch (err) {
      const code = (err as Error & { code?: number }).code;
      if (code === -32000) throw new Error(ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE);
      throw err;
    }
  }

  private handleAuthLine(line: string): void {
    const parsed = parseAuthorizationLine(line);
    if (!parsed) return;
    if (this.pendingSignIn) {
      this.pendingSignIn.url = parsed.authorizationUrl;
      this.pendingSignIn.resolve(parsed.authorizationUrl);
    }
    this.onAuthUrl?.(parsed.authorizationUrl);
  }

  async signIn(onAuthorizationUrl: (url: string) => void): Promise<{ url: string }> {
    const runtime = this.runtime();
    const dir = path.join(runtimeDir, "antigravity", "signin");
    mkdirSync(dir, { recursive: true });
    const { env } = prepareProfile({
      profileDirectory: this.getProfileDir(),
      harnessPath: runtime.harnessPath,
      auth: this.authConfig,
    });
    const client = new AcpClient(
      {
        command: runtime.executablePath,
        args: process.platform === "linux" ? ["--uid="] : [],
        cwd: dir,
        env,
      },
      { onStderrLine: (line) => this.handleAuthLine(line) },
    );
    this.onAuthUrl = onAuthorizationUrl;
    let resolveUrl: (url: string) => void = () => undefined;
    const urlPromise = new Promise<string>((resolve) => {
      resolveUrl = resolve;
    });
    this.pendingSignIn = { client, dir, url: null, resolve: resolveUrl };
    try {
      await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "orchestrator", version: "0.1.0" },
      });
      void client
        .request("authenticate", { methodId: this.authConfig.authMethod })
        .then(() => {
          this.pendingSignIn = null;
          client.close();
        })
        .catch((err) => log.warn(`antigravity sign-in error: ${err instanceof Error ? err.message : err}`));
      const url = await Promise.race([
        urlPromise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Antigravity did not return a sign-in URL.")), 30_000),
        ),
      ]);
      return { url };
    } catch (err) {
      this.cancelSignIn();
      throw err;
    }
  }

  async completeSignIn(callbackUrl: string): Promise<boolean> {
    if (!this.pendingSignIn) throw new Error("No Antigravity sign-in is in progress.");
    return forwardCallback(callbackUrl);
  }

  cancelSignIn(): void {
    this.pendingSignIn?.client.close();
    this.pendingSignIn = null;
    this.onAuthUrl = null;
  }

  sendTurn(
    session: SessionHandle,
    prompt: string,
    model: string,
    options?: TurnOptions,
  ): AsyncIterable<ProviderEvent> {
    const live = this.sessions.get(session.id);
    if (!live) {
      return errorStream("Antigravity session is not active. Start a new thread.");
    }
    const self = this;
    const blocks = buildPromptBlocks(prompt, options);
    async function* run(): AsyncGenerator<ProviderEvent> {
      const queue: AcpNotification[] = [];
      let notify: (() => void) | null = null;
      let finished = false;
      const toolState = new Map<string, "open" | "done">();
      const previous = live!.client.onNotification;
      live!.client.onNotification = (notification) => {
        previous?.(notification);
        if (notification.method === "session/update") {
          queue.push(notification);
          notify?.();
        }
      };
      live!.client.onRequest = (request) => self.handleAgentRequest(request.method, request.params);
      try {
        if (model) await self.setModel(live!, model).catch((err) => log.warn(String(err)));
        const promptDone = live!.client
          .request<{ stopReason?: string; usage?: unknown }>("session/prompt", {
            sessionId: live!.sessionId,
            prompt: blocks,
          })
          .then((result) => ({ result }))
          .catch((err: unknown) => ({ error: err }));
        let promptResult: { stopReason?: string; usage?: unknown } | undefined;
        while (!finished || queue.length > 0) {
          if (queue.length === 0) {
            const outcome = await Promise.race([
              promptDone.then((r) => ({ kind: "prompt" as const, value: r })),
              new Promise<{ kind: "tick" }>((resolve) => {
                notify = () => resolve({ kind: "tick" });
              }),
            ]);
            notify = null;
            if (outcome.kind === "prompt") {
              if ("error" in outcome.value) {
                yield { kind: "error", message: errorText(outcome.value.error) };
                return;
              }
              promptResult = outcome.value.result;
              finished = true;
              continue;
            }
            continue;
          }
          const notification = queue.shift()!;
          for (const event of mapUpdate(notification.params, toolState)) yield event;
        }
        const usage = toUsage(promptResult?.usage);
        if (usage) yield { kind: "usage", usage };
        yield { kind: "done" };
      } finally {
        live!.client.onNotification = previous;
        live!.client.onRequest = undefined;
      }
    }
    return run();
  }

  private async setModel(live: LiveSession, model: string): Promise<void> {
    const config = live.options.find((option) => option.id === "model");
    if (!config) return;
    const current = typeof config.currentValue === "string" ? config.currentValue : undefined;
    if (current === model) return;
    await live.client.request("session/set_config_option", {
      sessionId: live.sessionId,
      configId: "model",
      value: model,
    });
  }

  private async handleAgentRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "session/request_permission") {
      const options = Array.isArray(params.options)
        ? (params.options as Array<{ optionId?: string; kind?: string }>)
        : [];
      const chosen =
        options.find((option) => option.kind === "allow_always") ??
        options.find((option) => option.kind === "allow_once") ??
        options[0];
      return chosen?.optionId
        ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }
    throw new Error(`Unsupported Antigravity client method: ${method}`);
  }

  async interrupt(session: SessionHandle): Promise<void> {
    const live = this.sessions.get(session.id);
    if (!live) return;
    live.client.notify("session/cancel", { sessionId: live.sessionId });
  }

  async disposeSession(session: SessionHandle): Promise<void> {
    const live = this.sessions.get(session.id);
    if (!live) return;
    live.client.close();
    this.sessions.delete(session.id);
  }

  async disposeWorkspace(dir: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.cwd === dir) {
        session.client.close();
        this.sessions.delete(id);
      }
    }
  }
}

function errorStream(message: string): AsyncIterable<ProviderEvent> {
  return (async function* () {
    yield { kind: "error", message } as ProviderEvent;
    yield { kind: "done" } as ProviderEvent;
  })();
}

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
}

function buildPromptBlocks(prompt: string, options?: TurnOptions): ContentBlock[] {
  const text = options?.system ? `${options.system}\n\n${prompt}` : prompt;
  const blocks: ContentBlock[] = [];
  if (text.trim()) blocks.push({ type: "text", text });
  for (const attachment of options?.attachments ?? []) {
    const mime = attachment.mime.toLowerCase();
    if (mime.startsWith("image/") && attachment.data) {
      blocks.push({ type: "image", data: attachment.data, mimeType: mime });
    } else if (attachment.path) {
      blocks.push({
        type: "resource_link",
        uri: pathToFileUrl(attachment.path),
        name: attachment.name,
        mimeType: mime,
      });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: prompt });
  return blocks;
}

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

const canonicalToolName = (title: string): string => {
  const trimmed = title.trim().replace(/^running\s+/i, "");
  if (
    /^(get|set|new|remove|invoke|select|where|start|stop|test|write|read|copy|move|rename|out|import|export)-/i.test(trimmed) ||
    /^(git|pnpm|npm|npx|node|python|pip|cargo|dotnet|go|make|bash|sh|zsh|cmd|powershell|pwsh)\b/i.test(trimmed)
  ) {
    return "run_command";
  }
  return trimmed.replace(/\s+/g, "_").toLowerCase();
};

const contentText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (obj.content !== undefined) return contentText(obj.content);
  if (obj.parts !== undefined) return contentText(obj.parts);
  return "";
};

const toolOutput = (shaped: Record<string, unknown>): string => {
  if (typeof shaped.rawOutput === "string" && shaped.rawOutput.trim()) return shaped.rawOutput;
  return contentText(shaped.content);
};

function mapUpdate(
  params: Record<string, unknown>,
  toolState: Map<string, "open" | "done">,
): ProviderEvent[] {
  const update = params.update;
  if (!update || typeof update !== "object") return [];
  const shaped = update as Record<string, unknown>;
  const kind = shaped.sessionUpdate;
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const content = shaped.content as { type?: string; text?: string } | undefined;
    if (content?.type === "text" && typeof content.text === "string" && content.text) {
      return [
        kind === "agent_thought_chunk"
          ? { kind: "reasoning", text: content.text }
          : { kind: "assistant", text: content.text },
      ];
    }
    return [];
  }
  if (kind === "tool_call") {
    const callId = typeof shaped.toolCallId === "string" ? shaped.toolCallId : uid("call");
    const events: ProviderEvent[] = [];
    if (!toolState.has(callId)) {
      toolState.set(callId, "open");
      const title = typeof shaped.title === "string" ? shaped.title : "tool";
      const args = shaped.rawInput ? JSON.stringify(shaped.rawInput) : "{}";
      events.push({ kind: "tool", callId, tool: canonicalToolName(title), args });
    }
    const status = shaped.status;
    if ((status === "completed" || status === "failed") && toolState.get(callId) !== "done") {
      toolState.set(callId, "done");
      const output = cleanToolText(toolOutput(shaped));
      events.push({
        kind: "toolResult",
        callId,
        ok: status !== "failed",
        result: output.text,
        ...(output.truncated ? { truncated: true } : {}),
      });
    }
    return events;
  }
  if (kind === "tool_call_update") {
    const callId = typeof shaped.toolCallId === "string" ? shaped.toolCallId : "";
    const status = shaped.status;
    if (!callId || (status !== "completed" && status !== "failed") || toolState.get(callId) === "done") {
      return [];
    }
    toolState.set(callId, "done");
    const output = cleanToolText(toolOutput(shaped));
    return [
      {
        kind: "toolResult",
        callId,
        ok: status !== "failed",
        result: output.text,
        ...(output.truncated ? { truncated: true } : {}),
      },
    ];
  }
  if (kind === "usage_update") {
    const used = shaped.used;
    const size = shaped.size;
    if (typeof used !== "number") return [];
    return [
      {
        kind: "usage",
        usage: {
          input: used,
          output: 0,
          total: used,
          ...(typeof size === "number" ? { contextLimit: size } : {}),
        },
      },
    ];
  }
  return [];
}

function toUsage(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    thoughtTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  };
  if (typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") return null;
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const total =
    typeof usage.totalTokens === "number" ? usage.totalTokens : input + output;
  if (input === 0 && output === 0) return null;
  return {
    input,
    output,
    total,
    ...(typeof usage.thoughtTokens === "number" ? { reasoning: usage.thoughtTokens } : {}),
    ...(typeof usage.cachedReadTokens === "number" ? { cacheRead: usage.cachedReadTokens } : {}),
    ...(typeof usage.cachedWriteTokens === "number" ? { cacheWrite: usage.cachedWriteTokens } : {}),
  };
}

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const shaped = error as { message?: string };
    if (typeof shaped.message === "string" && shaped.message) return shaped.message;
  }
  return String(error);
}
