import type {
  AppConfig,
  Command,
  DomainEvent,
  EventBody,
  ModelRef,
  ReadModel as ReadModelData,
  ThreadView,
} from "@orchestrator/contracts";
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

  replay(fromSeq: number): DomainEvent[] {
    return this.deps.store.since(fromSeq);
  }

  async handle(command: Command): Promise<{ accepted: true }> {
    switch (command.kind) {
      case "StartThread":
        void this.startThread(command.prompt, command.harness, command.model);
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
      case "SetModel":
        this.deps.config.setModel(command.model as ModelRef);
        await this.publishConfig();
        break;
      case "SetEnabled":
        await this.setEnabled(command.target, command.id, command.enabled);
        break;
    }
    return { accepted: true };
  }

  private async startThread(
    prompt: string,
    harness: string,
    model: string,
    parentId?: string,
  ): Promise<void> {
    const threadId = uid("th_");
    const worktree = await this.deps.worktrees.create(threadId).catch(() => null);
    this.emit({
      type: "thread.started",
      threadId,
      title: truncate(prompt),
      harness,
      model,
      prompt,
      ...(worktree ? { branch: worktree.branch, worktree: worktree.dir } : {}),
      ...(parentId ? { parentId } : {}),
    });

    const executor = this.deps.adapters.executorFor(harness);
    if (!executor) {
      this.emit({ type: "agent.error", threadId, message: `No adapter available for ${harness}` });
      return;
    }

    const session = await executor.startSession(worktree?.dir ?? this.deps.workspace);
    const run: Run = { threadId, session, executor, stopped: false };
    this.runs.set(threadId, run);

    const skillPrompt = this.deps.skills.systemPrompt();
    if (skillPrompt) this.emit({ type: "message.appended", threadId, messageId: uid("m"), role: "system", text: skillPrompt });

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
      const options = skillPrompt ? { system: skillPrompt } : undefined;
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
          case "tool":
            this.emit({ type: "tool.called", threadId, callId: evt.callId, tool: evt.tool, args: evt.args });
            break;
          case "toolResult":
            this.emit({ type: "tool.result", threadId, callId: evt.callId, ok: evt.ok, result: evt.result });
            break;
          case "error":
            this.emit({ type: "agent.error", threadId, message: evt.message });
            run.stopped = true;
            break;
          case "done":
            this.emit({ type: "turn.completed", threadId });
            this.emit({ type: "agent.status", threadId, status: "done" });
            break;
          case "status":
            break;
        }
      }
    } catch (err) {
      this.emit({ type: "agent.error", threadId, message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.runs.delete(threadId);
    }
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

  private findThread(threadId: string): ThreadView | undefined {
    return this.deps.readModel.snapshot().threads.find((t) => t.id === threadId);
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
