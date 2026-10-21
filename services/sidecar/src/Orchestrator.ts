import type {
  AppConfig,
  Attachment,
  AttachmentMeta,
  Checkpoint,
  Command,
  DomainEvent,
  EventBody,
  ModelRef,
  MessageLevel,
  ReadModel as ReadModelData,
  ThreadView,
  Usage,
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
import type { MemoryStore } from "./memory/MemoryStore.js";
import { uid, truncate } from "./util/ids.js";
import { parseAgentMentions, slugify, stripAgentMentions } from "./util/mentions.js";
import { logger } from "./util/logger.js";

const log = logger("orchestrator");

const ORCHESTRATOR_THREAD_ID = "th_orchestrator";

const ORCHESTRATOR_TOOL_NAMES =
  "orchestrator_capabilities, orchestrator_create_thread, orchestrator_delegate_task, orchestrator_task_status, orchestrator_task_cancel, orchestrator_thread_list, orchestrator_thread_read, orchestrator_thread_wait, orchestrator_thread_interrupt, orchestrator_send_message, orchestrator_memory_write, orchestrator_memory_search, orchestrator_memory_list, orchestrator_agent_registry";

const threadContext = (threadId: string): string => {
  const role =
    threadId === ORCHESTRATOR_THREAD_ID
      ? "You are the Orchestrator of this workspace."
      : "You are a subagent in this workspace.";
  return (
    `${role} Your thread id is "${threadId}". ` +
    `You can orchestrate other agents through the "orchestrator" MCP tools (${ORCHESTRATOR_TOOL_NAMES}). ` +
    `Use orchestrator_delegate_task to hand off independent work to a child agent and wait for its result; ` +
    `pass parent_id="${threadId}" so the child is linked to this thread. ` +
    `When asked what an agent is doing or how it is going, answer in plain conversational prose: ` +
    `one or two sentences about its actual current activity. Never use headings, labels, bullet lists, ` +
    `or a status-report template.`
  );
};

interface Run {
  threadId: string;
  session: SessionHandle;
  executor: HarnessAdapter;
  harness: string;
  model: string;
  persistent: boolean;
  stopped: boolean;
  busy: boolean;
  lastUsage?: Usage;
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
  memory: MemoryStore;
  bus: Broadcaster;
}

export class Orchestrator {
  private readonly runs = new Map<string, Run>();
  private readonly deps: OrchestratorDeps;
  private orchestratorId: string | null = null;

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
    this.ensureOrchestrator();
    this.deps.mcp.subscribe((server) => {
      this.emit({
        type: "mcp.status",
        name: server.name,
        status: server.status,
        tools: server.tools,
        ...(server.schemaChars !== undefined ? { schemaChars: server.schemaChars } : {}),
      });
    });
    void this.deps.mcp.connectEnabled();
    log.info("orchestrator initialised");
  }

  private ensureOrchestrator(): void {
    const existing = this.deps.readModel.snapshot().threads.find((t) => t.kind === "orchestrator");
    if (existing) {
      this.orchestratorId = existing.id;
      return;
    }
    const config = this.deps.readModel.snapshot().config;
    this.orchestratorId = ORCHESTRATOR_THREAD_ID;
    this.emit({
      type: "thread.started",
      threadId: ORCHESTRATOR_THREAD_ID,
      title: "Orchestrator",
      harness: config.model.harness || "opencode",
      model: config.model.id,
      kind: "orchestrator",
    });
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
    this.system(
      threadId,
      res.ok ? `Checkpoint ${res.sha.slice(0, 7)} saved` : "Checkpoint failed",
      res.ok ? { details: message } : { level: "warning", details: res.output },
    );
    return res;
  }

  async restoreCheckpoint(threadId: string, sha: string): Promise<{ ok: boolean; output: string }> {
    const thread = this.findThread(threadId);
    if (!thread?.worktree) return { ok: false, output: "This thread has no isolated worktree." };
    const res = await this.deps.worktrees.restore(thread.worktree, sha);
    this.system(
      threadId,
      res.ok ? `Restored worktree to ${sha.slice(0, 7)}.` : "Restore failed",
      res.ok ? {} : { level: "warning", details: res.output },
    );
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
      this.system(threadId, "Commit failed", { level: "warning", details: commit.output });
      return { ok: false, output: commit.output };
    }
    const push = await this.deps.worktrees.push(thread.worktree, thread.branch);
    if (!push.ok) {
      this.system(threadId, "Push failed", { level: "warning", details: push.output });
      return { ok: false, output: push.output };
    }
    const pr = await this.deps.worktrees.createPullRequest(thread.worktree, {
      title,
      body: options.body,
      base: options.base,
    });
    const url = /https?:\/\/\S+/.exec(pr.output)?.[0];
    this.system(
      threadId,
      pr.ok
        ? url
          ? `Pull request created: ${url}`
          : "Pull request created"
        : "Pushed, but no pull request was created",
      { level: pr.ok ? "info" : "warning", details: pr.output },
    );
    return pr;
  }

  private system(
    threadId: string,
    text: string,
    opts: { level?: MessageLevel; details?: string } = {},
  ): void {
    const details = opts.details?.trim();
    this.emit({
      type: "message.appended",
      threadId,
      messageId: uid("m"),
      role: "system",
      text,
      ...(opts.level ? { level: opts.level } : {}),
      ...(details ? { details } : {}),
    });
  }

  async handle(command: Command): Promise<{ accepted: true }> {
    switch (command.kind) {
      case "StartThread":
        void this.startThread(command.prompt, command.harness, command.model, undefined, command.attachments);
        break;
      case "StopAgent":
        await this.stopAgent(command.threadId);
        break;
      case "SendMessage":
        await this.sendMessage(command.threadId, command.text, command.attachments);
        break;
      case "MarkRead":
        this.markRead(command.threadId);
        break;
      case "RetryThread":
        this.retryThread(command.threadId, command.model);
        break;
      case "ForkThread":
        this.forkThread(command.threadId);
        break;
      case "DiscardThread":
        await this.deleteThread(command.threadId);
        break;
      case "MergeThread":
        await this.mergeThread(command.threadId);
        break;
      case "ClearFinished":
        await this.clearFinished();
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
      case "SetMcpRoute":
        this.deps.mcp.setRoute(command.name, command.route);
        await this.publishConfig();
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

    const persistent = threadId === this.orchestratorId;
    const profile = persistent ? "orchestrator" : "agents";
    const session = await executor.startSession(cwd, profile).catch((err: unknown) => {
      this.emit({ type: "agent.error", threadId, message: errMessage(err) });
      return null;
    });
    if (!session) return;
    const run: Run = { threadId, session, executor, harness, model, persistent, stopped: false, busy: false };
    this.runs.set(threadId, run);

    try {
      await this.runTurn(run, prompt, saved);
    } finally {
      if (!persistent) {
        this.runs.delete(threadId);
        await executor.disposeSession?.(session);
      }
    }
  }

  private async runTurn(
    run: Run,
    prompt: string,
    saved: { name: string; mime: string; data: string; size: number; path: string }[],
  ): Promise<void> {
    const { threadId } = run;
    run.stopped = false;
    run.busy = true;

    const view = this.findThread(threadId);
    const memoryBlock =
      run.persistent && view ? this.deps.memory.render(view, this.listThreadViews()) : "";
    const system = [threadContext(threadId), memoryBlock, this.deps.skills.systemPrompt()]
      .filter(Boolean)
      .join("\n\n");

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
        this.markUnread(threadId);
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
      for await (const evt of run.executor.sendTurn(run.session, effectivePrompt, run.model, options)) {
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
            this.emit({
              type: "tool.result",
              threadId,
              callId: evt.callId,
              ok: evt.ok,
              result: evt.result,
              ...(evt.truncated ? { truncated: true } : {}),
            });
            break;
          case "usage":
            run.lastUsage = evt.usage;
            this.emit({ type: "usage.updated", threadId, usage: evt.usage });
            break;
          case "error":
            this.markUnread(threadId);
            this.emit({ type: "agent.error", threadId, message: evt.message });
            run.stopped = true;
            break;
          case "done":
            this.emit({ type: "turn.completed", threadId });
            this.emit({ type: "agent.status", threadId, status: run.persistent ? "idle" : "done" });
            break;
        }
      }
    } catch (err) {
      this.markUnread(threadId);
      this.emit({ type: "agent.error", threadId, message: errMessage(err) });
    } finally {
      if (run.persistent) {
        await this.maybeCompact(run);
        this.compactMemory();
      }
      run.busy = false;
    }
  }

  private async maybeCompact(run: Run): Promise<void> {
    const usage = run.lastUsage;
    if (!usage) return;
    const used =
      usage.total ??
      usage.input + usage.output + (usage.reasoning ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    const limit = usage.contextLimit;
    if (!limit || used < limit * 0.7) return;
    run.lastUsage = undefined;
    const compacted = run.executor.compact
      ? await run.executor.compact(run.session, run.model).catch(() => false)
      : false;
    if (compacted) {
      this.system(run.threadId, "Compacted the conversation to free context.", { level: "info" });
      return;
    }
    run.session.externalId = undefined;
    this.system(run.threadId, "Started a fresh session to free context. Earlier work is preserved in memory.", {
      level: "info",
    });
  }

  private markUnread(threadId: string): void {
    if (threadId === this.orchestratorId) return;
    const thread = this.findThread(threadId);
    if (!thread || thread.unread) return;
    this.emit({ type: "thread.unread", threadId });
  }

  private markRead(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread?.unread) return;
    this.emit({ type: "thread.read", threadId });
  }

  private compactMemory(): void {
    const thread = this.orchestratorId ? this.findThread(this.orchestratorId) : undefined;
    if (!thread) return;
    this.deps.memory.compact(thread.messages);
    this.deps.memory.syncAgents(this.listThreadViews());
  }

  memoryWrite(text: string, tags: string[] = []): string {
    const note = this.deps.memory.writeNote(text, tags, "orchestrator");
    const tagText = note.tags.length ? ` (tags: ${note.tags.join(", ")})` : "";
    return `Saved to memory${tagText}: "${note.text}"`;
  }

  memorySearch(query: string, limit = 10): string {
    const notes = this.deps.memory.search(query, limit);
    if (!notes.length) return `No memories matched "${query}".`;
    const rows = notes.map((note) => {
      const tags = note.tags.length ? ` [${note.tags.join(", ")}]` : "";
      return `• ${note.text.slice(0, 240)}${tags}`;
    });
    return `Found ${notes.length} ${notes.length === 1 ? "memory" : "memories"} for "${query}":\n${rows.join("\n")}`;
  }

  memoryList(limit = 20): string {
    const notes = this.deps.memory.snapshot().notes.slice(-limit);
    if (!notes.length) return "No memories yet.";
    const rows = notes.map((note) => {
      const tags = note.tags.length ? ` [${note.tags.join(", ")}]` : "";
      return `• ${note.text.slice(0, 240)}${tags}`;
    });
    return `${notes.length} recent ${notes.length === 1 ? "memory" : "memories"}:\n${rows.join("\n")}`;
  }

  agentRegistry(): string {
    const threads = this.listThreadViews().filter((thread) => thread.kind !== "orchestrator");
    if (!threads.length) return "No agents yet.";
    const titles = new Map(threads.map((thread) => [thread.id, thread.title]));
    const shown = threads.slice(-20);
    const rows = shown.map((thread) => {
      const last = [...thread.messages].reverse().find((m) => m.role === "assistant" && m.text.trim());
      const parent = thread.parentId
        ? ` — child of "${titles.get(thread.parentId) ?? "another agent"}"`
        : "";
      const tail = last ? `\n  latest: ${last.text.replace(/\s+/g, " ").slice(0, 120)}` : "";
      return `• "${truncate(thread.title, 80)}" [${thread.status}]${parent}\n  id: ${thread.id}${tail}`;
    });
    const more = threads.length > shown.length ? `\n… and ${threads.length - shown.length} older` : "";
    return `${threads.length} ${threads.length === 1 ? "agent" : "agents"}:\n${rows.join("\n")}${more}`;
  }

  async sendMessage(
    threadId: string,
    text: string,
    attachments?: Attachment[],
  ): Promise<void> {
    const thread = this.findThread(threadId);
    if (!thread) return;

    if (thread.kind === "orchestrator") {
      const targets = this.resolveMentionTargets(text);
      if (targets.length) {
        this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "user", text, source: "user" });
        const instruction = stripAgentMentions(text) || "Continue with your task and report your current status.";
        for (const target of targets) await this.sendMessage(target.id, instruction, attachments);
        this.system(threadId, `Sent to ${targets.map((t) => truncate(t.title, 40)).join(", ")}.`);
        return;
      }
    }

    const saved = attachments?.length ? await this.saveAttachments(threadId, attachments) : [];
    this.emit({
      type: "message.appended",
      threadId,
      messageId: uid("m"),
      role: "user",
      text,
      source: "user",
    });
    const existing = this.runs.get(threadId);
    if (existing) {
      if (existing.busy) {
        this.system(threadId, "Still working on the previous message — try again once it finishes.");
        return;
      }
      this.emit({ type: "agent.status", threadId, status: "running" });
      void this.runTurn(existing, text, saved);
      return;
    }
    this.emit({ type: "agent.status", threadId, status: "running" });
    const cwd = thread.worktree ?? this.deps.workspace;
    void this.runThread(threadId, text, thread.harness, thread.model, cwd, saved);
  }

  private resolveMentionTargets(text: string): ThreadView[] {
    const slugs = parseAgentMentions(text);
    if (!slugs.length) return [];
    const agents = this.deps.readModel.snapshot().threads.filter((t) => t.kind !== "orchestrator");
    const bySlug = new Map<string, ThreadView>();
    for (const agent of agents) {
      const slug = slugify(agent.title);
      if (!bySlug.has(slug)) bySlug.set(slug, agent);
    }
    const targets: ThreadView[] = [];
    for (const slug of slugs) {
      const agent = bySlug.get(slug);
      if (agent && !targets.includes(agent)) targets.push(agent);
    }
    return targets;
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
    this.emit({ type: "agent.status", threadId, status: run.persistent ? "idle" : "stopped" });
    this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "system", text: "Stopped by user." });
    if (run.persistent) run.busy = false;
    else this.runs.delete(threadId);
  }

  private async clearFinished(): Promise<void> {
    const threads = this.deps.readModel.snapshot().threads;
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const blocked = new Set<string>();
    for (const thread of threads) {
      if (thread.status !== "running") continue;
      let current: ThreadView | undefined = thread;
      while (current && !blocked.has(current.id)) {
        blocked.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    for (const thread of threads) {
      if (thread.kind === "orchestrator" || blocked.has(thread.id)) continue;
      await this.deleteThread(thread.id);
    }
  }

  private async clearAll(): Promise<void> {
    for (const threadId of [...this.runs.keys()]) {
      if (threadId === this.orchestratorId) continue;
      await this.stopAgent(threadId);
    }
    for (const thread of this.deps.readModel.snapshot().threads) {
      if (thread.kind === "orchestrator") continue;
      await this.deleteThread(thread.id);
    }
  }

  private findThread(threadId: string): ThreadView | undefined {
    return this.deps.readModel.find(threadId);
  }

  private retryThread(threadId: string, model?: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.kind === "orchestrator") return;
    void this.startThread(thread.prompt ?? thread.title, thread.harness, model ?? thread.model, thread.id);
  }

  private forkThread(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.kind === "orchestrator") return;
    void this.startThread(thread.prompt ?? thread.title, thread.harness, thread.model, thread.id);
  }

  private async deleteThread(threadId: string): Promise<void> {
    if (threadId === this.orchestratorId) {
      this.system(threadId, "The orchestrator can't be deleted.");
      return;
    }
    const thread = this.findThread(threadId);
    if (!thread) return;
    const children = this.deps.readModel
      .snapshot()
      .threads.filter((candidate) => candidate.parentId === threadId);
    for (const child of children) await this.deleteThread(child.id);
    if (this.runs.has(threadId)) await this.stopAgent(threadId);
    if (thread.worktree) {
      await this.deps.adapters.releaseWorkspace(thread.worktree);
      await this.deps.worktrees.remove({
        branch: thread.branch ?? this.deps.worktrees.handle(threadId).branch,
        dir: thread.worktree,
      });
    }
    this.emit({ type: "thread.removed", threadId });
  }

  private async mergeThread(threadId: string): Promise<void> {
    const thread = this.findThread(threadId);
    if (!thread?.branch) {
      this.system(threadId, "Nothing to merge — this thread has no isolated branch.", { level: "warning" });
      return;
    }
    const res = await this.deps.worktrees.merge(thread.branch);
    this.system(
      threadId,
      res.ok ? `Merged ${thread.branch} into the workspace.` : "Merge failed",
      res.ok ? {} : { level: "warning", details: res.output || "Unknown error" },
    );
  }

  private async setEnabled(target: "harness" | "mcp" | "skill", id: string, enabled: boolean): Promise<void> {
    if (target === "harness") {
      this.deps.config.setHarnessEnabled(id, enabled);
    } else if (target === "skill") {
      this.deps.skills.setEnabled(id, enabled);
    } else {
      const server = this.deps.mcp.setEnabled(id, enabled);
      if (server) {
        this.emit({
          type: "mcp.status",
          name: server.name,
          status: server.status,
          tools: server.tools,
          ...(server.schemaChars !== undefined ? { schemaChars: server.schemaChars } : {}),
        });
      }
    }
    await this.publishConfig();
  }

  get config(): AppConfig | null {
    return this.deps.readModel.snapshot().config;
  }
}
