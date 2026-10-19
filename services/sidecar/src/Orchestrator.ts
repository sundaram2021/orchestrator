import type {
  AppConfig,
  Attachment,
  AttachmentMeta,
  Checkpoint,
  Command,
  DomainEvent,
  EventBody,
  ModelRef,
  ReadModel as ReadModelData,
  ThreadView,
} from "@orchestrator/contracts";
import { mkdir, writeFile } from "node:fs/promises";
import { errMessage } from "./util/coerce.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "./event/EventStore.js";
import { ReadModel } from "./event/ReadModel.js";
import type { Broadcaster } from "./Broadcaster.js";
import type { AdapterManager } from "./adapters/AdapterManager.js";
import type { HarnessAdapter, SessionHandle } from "./adapters/HarnessAdapter.js";
import type { ConfigService } from "./config/ConfigService.js";
import type { McpManager } from "./mcp/McpManager.js";
import type { SkillsLoader } from "./skills/SkillsLoader.js";
import type { WorktreeService } from "./git/WorktreeService.js";
import { uid, truncate } from "./util/ids.js";
import { logger } from "./util/logger.js";

const log = logger("orchestrator");

const ORCHESTRATOR_TOOL_NAMES =
  "orchestrator_capabilities, orchestrator_create_thread, orchestrator_delegate_task, orchestrator_task_status, orchestrator_task_cancel, orchestrator_thread_list, orchestrator_thread_read, orchestrator_thread_wait, orchestrator_thread_interrupt";

const threadContext = (threadId: string): string =>
  `You are an agent running inside Orchestrator. Your thread id is "${threadId}". ` +
  `You can orchestrate other agents through the "orchestrator" MCP tools (${ORCHESTRATOR_TOOL_NAMES}). ` +
  `Use orchestrator_delegate_task to hand off independent work to a child agent and wait for its result; ` +
  `pass parent_id="${threadId}" so the child is linked to this thread.`;

interface Run {
  threadId: string;
  session: SessionHandle;
  executor: HarnessAdapter;
  stopped: boolean;
}

export interface OrchestratorDeps {
  workspace: string;
  store: EventStore;
  readModel: ReadModel;
  adapters: AdapterManager;
  config: ConfigService;
  mcp: McpManager;
  skills: SkillsLoader;
  worktrees: WorktreeService;
  bus: Broadcaster;
}

export class Orchestrator {
  private readonly runs = new Map<string, Run>();
  private readonly deps: OrchestratorDeps;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  private emit(body: EventBody): DomainEvent {
    const event = this.deps.store.append(body);
    this.deps.readModel.apply(event);
    this.deps.bus.emit(event);
    return event;
  }

  private async publishConfig(): Promise<void> {
    const config = await this.deps.config.assemble();
    this.deps.readModel.setConfig(config);
    this.emit({ type: "config.changed", config });
  }

  async refreshConfig(): Promise<void> {
    await this.publishConfig();
  }

  async init(): Promise<void> {
    await this.deps.adapters.startAll();
    const config = await this.deps.config.assemble();
    this.deps.readModel.setConfig(config);
    this.emit({ type: "config.changed", config });
    for (const adapter of this.deps.adapters.list()) {
      this.emit({ type: "harness.status", harnessId: adapter.id, status: adapter.status });
    }
    for (const thread of this.deps.readModel.snapshot().threads) {
      if (thread.status === "running") {
        this.emit({ type: "agent.status", threadId: thread.id, status: "stopped" });
      }
    }
    this.deps.mcp.subscribe((server) => {
      this.emit({ type: "mcp.status", name: server.name, status: server.status, tools: server.tools });
    });
    void this.deps.mcp.connectEnabled();
    log.info("orchestrator initialised");
  }

  snapshot(): ReadModelData {
    return this.deps.readModel.snapshot();
  }

  capabilities(): {
    harnesses: { id: string; name: string; models: { id: string; name: string }[] }[];
    model: ModelRef;
  } {
    const config = this.deps.readModel.snapshot().config;
    return {
      model: config.model,
      harnesses: config.harnesses.map((h) => ({
        id: h.id,
        name: h.name,
        models: h.models.map((m) => ({ id: m.id, name: m.name })),
      })),
    };
  }

  async spawnThread(opts: {
    prompt: string;
    harness?: string;
    model?: string;
    parentId?: string;
  }): Promise<string> {
    const config = this.deps.readModel.snapshot().config;
    const harness = opts.harness?.trim() || config.model.harness;
    const model = opts.model?.trim() || config.model.id;
    return this.startThread(opts.prompt, harness, model, opts.parentId);
  }

  threadView(threadId: string): ThreadView | undefined {
    return this.findThread(threadId);
  }

  listThreadViews(): ThreadView[] {
    return this.deps.readModel.snapshot().threads;
  }

  async interrupt(threadId: string): Promise<void> {
    await this.stopAgent(threadId);
  }

  async awaitThread(threadId: string, timeoutMs = 600_000): Promise<ThreadView | undefined> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const view = this.findThread(threadId);
      if (!view) return undefined;
      if (view.status !== "running") return view;
      if (Date.now() >= deadline) return view;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  replay(fromSeq: number): DomainEvent[] {
    return this.deps.store.since(fromSeq);
  }

  async listCheckpoints(threadId: string): Promise<Checkpoint[]> {
    const thread = this.findThread(threadId);
    if (!thread?.worktree) return [];
    return this.deps.worktrees.log(thread.worktree);
  }

  async createCheckpoint(
    threadId: string,
    label?: string,
  ): Promise<{ ok: boolean; sha: string; output: string }> {
    const thread = this.findThread(threadId);
    if (!thread?.worktree) return { ok: false, sha: "", output: "This thread has no isolated worktree." };
    const message = label?.trim() || `checkpoint ${new Date().toISOString()}`;
    const res = await this.deps.worktrees.checkpoint(thread.worktree, message);
    this.emit({
      type: "message.appended",
      threadId,
      messageId: uid("m"),
      role: "system",
      text: res.ok ? `Checkpoint ${res.sha}: ${message}` : `Checkpoint failed: ${res.output}`,
    });
    return res;
  }

  async restoreCheckpoint(threadId: string, sha: string): Promise<{ ok: boolean; output: string }> {
    const thread = this.findThread(threadId);
    if (!thread?.worktree) return { ok: false, output: "This thread has no isolated worktree." };
    const res = await this.deps.worktrees.restore(thread.worktree, sha);
    this.emit({
      type: "message.appended",
      threadId,
      messageId: uid("m"),
      role: "system",
      text: res.ok ? `Restored worktree to ${sha}.` : `Restore failed: ${res.output}`,
    });
    return res;
  }

  async landThread(
    threadId: string,
    options: { title?: string; body?: string; base?: string } = {},
  ): Promise<{ ok: boolean; output: string }> {
    const thread = this.findThread(threadId);
    if (!thread?.branch || !thread.worktree) {
      return { ok: false, output: "This thread has no isolated branch to land." };
    }
    const title = options.title?.trim() || thread.title;
    const commit = await this.deps.worktrees.checkpoint(thread.worktree, title);
    if (!commit.ok) {
      this.system(threadId, `Commit failed: ${commit.output}`);
      return { ok: false, output: commit.output };
    }
    const push = await this.deps.worktrees.push(thread.worktree, thread.branch);
    if (!push.ok) {
      this.system(threadId, `Push failed: ${push.output}`);
      return { ok: false, output: push.output };
    }
    const pr = await this.deps.worktrees.createPullRequest(thread.worktree, {
      title,
      body: options.body,
      base: options.base,
    });
    this.system(threadId, pr.ok ? `Pull request: ${pr.output}` : `Pushed, but no PR: ${pr.output}`);
    return pr;
  }

  private system(threadId: string, text: string): void {
    this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "system", text });
  }

  async handle(command: Command): Promise<{ accepted: true }> {
    switch (command.kind) {
      case "StartThread":
        void this.startThread(command.prompt, command.harness, command.model, undefined, command.attachments);
        break;
      case "StopAgent":
        await this.stopAgent(command.threadId);
        break;
      case "RetryThread":
        this.retryThread(command.threadId, command.model);
        break;
      case "ForkThread":
        this.forkThread(command.threadId);
        break;
      case "DiscardThread":
        await this.discardThread(command.threadId);
        break;
      case "MergeThread":
        await this.mergeThread(command.threadId);
        break;
      case "ClearFinished":
        this.clearFinished();
        break;
      case "ClearAll":
        await this.clearAll();
        break;
      case "SetModel":
        this.deps.config.setModel(command.model as ModelRef);
        await this.publishConfig();
        break;
      case "SetEnabled":
        await this.setEnabled(command.target, command.id, command.enabled);
        break;
      case "SetUpdateSettings":
        this.deps.config.setUpdateSettings({
          ...(command.autoUpdate !== undefined ? { autoUpdate: command.autoUpdate } : {}),
          ...(command.includeMajor !== undefined ? { includeMajor: command.includeMajor } : {}),
        });
        await this.publishConfig();
        break;
    }
    return { accepted: true };
  }

  private async startThread(
    prompt: string,
    harness: string,
    model: string,
    parentId?: string,
    attachments?: Attachment[],
  ): Promise<string> {
    const threadId = uid("th_");
    const worktree = await this.deps.worktrees.create(threadId).catch(() => null);
    const saved = attachments?.length ? await this.saveAttachments(threadId, attachments) : [];
    const meta: AttachmentMeta[] = saved.map((a) => ({ name: a.name, mime: a.mime, size: a.size }));
    this.emit({
      type: "thread.started",
      threadId,
      title: truncate(prompt),
      harness,
      model,
      prompt,
      ...(worktree ? { branch: worktree.branch, worktree: worktree.dir } : {}),
      ...(parentId ? { parentId } : {}),
      ...(meta.length ? { attachments: meta } : {}),
    });
    void this.runThread(threadId, prompt, harness, model, worktree?.dir ?? this.deps.workspace, saved);
    return threadId;
  }

  private async runThread(
    threadId: string,
    prompt: string,
    harness: string,
    model: string,
    cwd: string,
    saved: { name: string; mime: string; data: string; size: number; path: string }[],
  ): Promise<void> {
    const executor = this.deps.adapters.executorFor(harness);
    if (!executor) {
      this.emit({ type: "agent.error", threadId, message: `No adapter available for ${harness}` });
      return;
    }

    const session = await executor.startSession(cwd);
    const run: Run = { threadId, session, executor, stopped: false };
    this.runs.set(threadId, run);

    const system = [threadContext(threadId), this.deps.skills.systemPrompt()].filter(Boolean).join("\n\n");

    const invocation = this.deps.skills.matchInvocation(prompt);
    const effectivePrompt = invocation
      ? `${invocation.body ? `# Skill: ${invocation.name}\n${invocation.body}\n\n` : ""}${invocation.prompt || prompt}`
      : prompt;
    if (invocation) {
      this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "system", text: `Invoking skill /${invocation.name}` });
    }

    let assistantId: string | null = null;
    const ensureAssistant = (): string => {
      if (!assistantId) {
        assistantId = uid("m");
        this.emit({ type: "message.appended", threadId, messageId: assistantId, role: "assistant", text: "" });
      }
      return assistantId;
    };

    try {
      const options = {
        system,
        ...(saved.length
          ? {
              attachments: saved.map((a) => ({
                name: a.name,
                mime: a.mime,
                data: a.data,
                path: a.path,
              })),
            }
          : {}),
      };
      for await (const evt of executor.sendTurn(session, effectivePrompt, model, options)) {
        if (run.stopped) break;
        switch (evt.kind) {
          case "system":
            this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "system", text: evt.text });
            assistantId = null;
            break;
          case "assistant":
            this.emit({ type: "message.delta", threadId, messageId: ensureAssistant(), delta: evt.text });
            break;
          case "reasoning":
            this.emit({ type: "message.reasoning", threadId, messageId: ensureAssistant(), delta: evt.text });
            break;
          case "tool":
            this.emit({ type: "tool.called", threadId, callId: evt.callId, tool: evt.tool, args: evt.args });
            break;
          case "toolResult":
            this.emit({ type: "tool.result", threadId, callId: evt.callId, ok: evt.ok, result: evt.result });
            break;
          case "usage":
            this.emit({ type: "usage.updated", threadId, usage: evt.usage });
            break;
          case "error":
            this.emit({ type: "agent.error", threadId, message: evt.message });
            run.stopped = true;
            break;
          case "done":
            this.emit({ type: "turn.completed", threadId });
            this.emit({ type: "agent.status", threadId, status: "done" });
            break;
        }
      }
    } catch (err) {
      this.emit({ type: "agent.error", threadId, message: errMessage(err) });
    } finally {
      this.runs.delete(threadId);
      await run.executor.disposeSession?.(run.session);
    }
  }

  private async saveAttachments(
    threadId: string,
    attachments: Attachment[],
  ): Promise<{ name: string; mime: string; data: string; size: number; path: string }[]> {
    const dir = join(homedir(), ".orchestrator", "uploads", threadId);
    await mkdir(dir, { recursive: true });
    const saved: { name: string; mime: string; data: string; size: number; path: string }[] = [];
    for (const [index, a] of attachments.entries()) {
      const bytes = Buffer.from(a.data, "base64");
      const safe = `${index + 1}-${a.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const filePath = join(dir, safe);
      await writeFile(filePath, bytes);
      saved.push({ name: a.name, mime: a.mime, data: a.data, size: bytes.length, path: filePath });
    }
    return saved;
  }

  private async stopAgent(threadId: string): Promise<void> {
    const run = this.runs.get(threadId);
    if (!run) return;
    run.stopped = true;
    await run.executor.interrupt(run.session);
    this.emit({ type: "agent.status", threadId, status: "stopped" });
    this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "system", text: "Stopped by user." });
    this.runs.delete(threadId);
  }

  private clearFinished(): void {
    const threads: ThreadView[] = this.deps.readModel.snapshot().threads;
    for (const thread of threads) {
      if (thread.status !== "running") this.emit({ type: "thread.removed", threadId: thread.id });
    }
  }

  private async clearAll(): Promise<void> {
    for (const threadId of [...this.runs.keys()]) {
      await this.stopAgent(threadId);
    }
    for (const thread of this.deps.readModel.snapshot().threads) {
      this.emit({ type: "thread.removed", threadId: thread.id });
    }
  }

  private findThread(threadId: string): ThreadView | undefined {
    return this.deps.readModel.find(threadId);
  }

  private retryThread(threadId: string, model?: string): void {
    const thread = this.findThread(threadId);
    if (!thread) return;
    void this.startThread(thread.prompt ?? thread.title, thread.harness, model ?? thread.model, thread.id);
  }

  private forkThread(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread) return;
    void this.startThread(thread.prompt ?? thread.title, thread.harness, thread.model, thread.id);
  }

  private async discardThread(threadId: string): Promise<void> {
    if (this.runs.has(threadId)) await this.stopAgent(threadId);
    const thread = this.findThread(threadId);
    if (thread?.worktree) {
      await this.deps.adapters.releaseWorkspace(thread.worktree);
    }
    if (thread?.branch && thread.worktree) {
      await this.deps.worktrees.remove({ branch: thread.branch, dir: thread.worktree });
    }
    this.emit({ type: "thread.removed", threadId });
  }

  private async mergeThread(threadId: string): Promise<void> {
    const thread = this.findThread(threadId);
    if (!thread?.branch) {
      this.emit({
        type: "message.appended",
        threadId,
        messageId: uid("m"),
        role: "system",
        text: "Nothing to merge — this thread has no isolated branch.",
      });
      return;
    }
    const res = await this.deps.worktrees.merge(thread.branch);
    this.emit({
      type: "message.appended",
      threadId,
      messageId: uid("m"),
      role: "system",
      text: res.ok ? `Merged ${thread.branch} into the workspace.` : `Merge failed: ${res.output || "unknown error"}`,
    });
  }

  private async setEnabled(target: "harness" | "mcp" | "skill", id: string, enabled: boolean): Promise<void> {
    if (target === "harness") {
      this.deps.config.setHarnessEnabled(id, enabled);
    } else if (target === "skill") {
      this.deps.skills.setEnabled(id, enabled);
    } else {
      const server = this.deps.mcp.setEnabled(id, enabled);
      if (server) {
        this.emit({ type: "mcp.status", name: server.name, status: server.status, tools: server.tools });
      }
    }
    await this.publishConfig();
  }

  get config(): AppConfig | null {
    return this.deps.readModel.snapshot().config;
  }
}
