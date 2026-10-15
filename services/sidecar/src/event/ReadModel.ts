import type {
  AppConfig,
  DomainEvent,
  MessageView,
  ReadModel as ReadModelData,
  ThreadView,
} from "@orchestrator/contracts";
import { uid } from "../util/ids.js";

const blankConfig = (config: AppConfig) => config;

export class ReadModel {
  private threads = new Map<string, ThreadView>();
  private config: AppConfig;
  private lastSeq = -1;

  constructor(initialConfig: AppConfig) {
    this.config = blankConfig(initialConfig);
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
          status: "running",
          createdAt: now,
          updatedAt: now,
          messages: [],
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
      case "message.appended": {
        const t = this.threads.get(e.threadId);
        if (t) {
          t.messages.push({ id: e.messageId, role: e.role, text: e.text, tools: [] });
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
      case "tool.called": {
        const t = this.threads.get(e.threadId);
        if (t) {
          const last = t.messages[t.messages.length - 1];
          const target: MessageView | undefined =
            last && last.role === "assistant"
              ? last
              : { id: uid("m"), role: "assistant", text: "", tools: [] };
          if (target !== last) t.messages.push(target);
          target.tools.push({ callId: e.callId, tool: e.tool, args: e.args });
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
