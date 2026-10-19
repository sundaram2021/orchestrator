import type {
  AppConfig,
  DomainEvent,
  MessageView,
  ReadModel as ReadModelData,
  ThreadView,
} from "@orchestrator/contracts";
import { uid } from "../util/ids.js";

export class ReadModel {
  private threads = new Map<string, ThreadView>();
  private config: AppConfig;
  private lastSeq = -1;

  constructor(initialConfig: AppConfig) {
    this.config = initialConfig;
  }

  setConfig(config: AppConfig): void {
    this.config = config;
  }

  private touch(thread: ThreadView): void {
    thread.updatedAt = Date.now();
  }

  apply(event: DomainEvent): void {
    this.lastSeq = event.seq;
    const e = event.event;

    switch (e.type) {
      case "thread.started": {
        const now = Date.now();
        this.threads.set(e.threadId, {
          id: e.threadId,
          title: e.title,
          harness: e.harness,
          model: e.model,
          status: e.kind === "orchestrator" ? "idle" : "running",
          createdAt: now,
          updatedAt: now,
          messages: [],
          ...(e.kind ? { kind: e.kind } : {}),
          ...(e.prompt ? { prompt: e.prompt } : {}),
          ...(e.branch ? { branch: e.branch } : {}),
          ...(e.worktree ? { worktree: e.worktree } : {}),
          ...(e.parentId ? { parentId: e.parentId } : {}),
          ...(e.attachments ? { attachments: e.attachments } : {}),
        });
        break;
      }
      case "agent.status": {
        const t = this.threads.get(e.threadId);
        if (t) {
          t.status = e.status;
          this.touch(t);
        }
        break;
      }
      case "thread.unread": {
        const t = this.threads.get(e.threadId);
        if (t) t.unread = true;
        break;
      }
      case "thread.read": {
        const t = this.threads.get(e.threadId);
        if (t) t.unread = false;
        break;
      }
      case "message.appended": {
        const t = this.threads.get(e.threadId);
        if (t) {
          t.messages.push({
            id: e.messageId,
            role: e.role,
            text: e.text,
            tools: [],
            ...(e.source ? { source: e.source } : {}),
          });
          this.touch(t);
        }
        break;
      }
      case "message.delta": {
        const t = this.threads.get(e.threadId);
        const msg = t?.messages.find((m) => m.id === e.messageId);
        if (t && msg) {
          msg.text += e.delta;
          this.touch(t);
        }
        break;
      }
      case "message.reasoning": {
        const t = this.threads.get(e.threadId);
        const msg = t?.messages.find((m) => m.id === e.messageId);
        if (t && msg) {
          msg.reasoning = (msg.reasoning ?? "") + e.delta;
          this.touch(t);
        }
        break;
      }
      case "tool.called": {
        const t = this.threads.get(e.threadId);
        if (t) {
          const last = t.messages[t.messages.length - 1];
          const target: MessageView | undefined =
            last && last.role === "assistant"
              ? last
              : { id: uid("m"), role: "assistant", text: "", tools: [] };
          if (target !== last) t.messages.push(target);
          target.tools.push({ callId: e.callId, tool: e.tool, args: e.args, startedAt: event.ts });
          this.touch(t);
        }
        break;
      }
      case "tool.result": {
        const t = this.threads.get(e.threadId);
        if (t) {
          for (const m of t.messages) {
            const tool = m.tools.find((x) => x.callId === e.callId);
            if (tool) {
              tool.ok = e.ok;
              tool.result = e.result;
              tool.endedAt = event.ts;
              break;
            }
          }
          this.touch(t);
        }
        break;
      }
      case "agent.error": {
        const t = this.threads.get(e.threadId);
        if (t) {
          t.status = "error";
          t.messages.push({ id: uid("m"), role: "system", text: e.message, tools: [] });
          this.touch(t);
        }
        break;
      }
      case "thread.removed": {
        this.threads.delete(e.threadId);
        break;
      }
      case "usage.updated": {
        const t = this.threads.get(e.threadId);
        if (t) {
          t.usage = e.usage;
          this.touch(t);
        }
        break;
      }
      case "config.changed": {
        this.config = e.config;
        break;
      }
      case "harness.status":
      case "mcp.status":
      case "turn.completed":
        break;
    }
  }

  find(threadId: string): ThreadView | undefined {
    return this.threads.get(threadId);
  }

  snapshot(): ReadModelData {
    const threads = [...this.threads.values()].sort((a, b) => a.createdAt - b.createdAt);
    return {
      threads: threads.map((t) => ({ ...t, messages: [...t.messages] })),
      status: {
        agentsRunning: threads.filter((t) => t.status === "running").length,
        totalThreads: threads.length,
      },
      config: this.config,
      lastSeq: this.lastSeq,
    };
  }
}
