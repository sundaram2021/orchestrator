import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MessageView, ThreadView } from "@orchestrator/contracts";
import { uid } from "../util/ids.js";

export type MemorySource = "orchestrator" | "user" | "auto";

export interface MemoryNote {
  id: string;
  text: string;
  tags: string[];
  ts: number;
  source: MemorySource;
}

export interface AgentSummary {
  id: string;
  title: string;
  summary: string;
  updatedAt: number;
}

export interface MemorySnapshot {
  notes: MemoryNote[];
  agents: AgentSummary[];
  summary: string;
  updatedAt: number;
}

interface MemoryData {
  notes: MemoryNote[];
  agents: Record<string, AgentSummary>;
  summary: string;
  compacted: number;
  updatedAt: number;
}

const MAX_NOTES = 200;
const MAX_SUMMARY = 8000;
const MAX_AGENTS = 100;
const RENDERED_NOTES = 40;
const RECENT_MESSAGES = 6;

const empty = (): MemoryData => ({ notes: [], agents: {}, summary: "", compacted: 0, updatedAt: 0 });

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export class MemoryStore {
  private data: MemoryData;

  constructor(private readonly file?: string) {
    this.data = this.load();
  }

  private load(): MemoryData {
    if (!this.file) return empty();
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      const notes: MemoryNote[] = Array.isArray(parsed.notes)
        ? parsed.notes.flatMap((raw) => {
            if (!raw || typeof raw !== "object") return [];
            const note = raw as Record<string, unknown>;
            if (typeof note.id !== "string" || typeof note.text !== "string") return [];
            return [
              {
                id: note.id,
                text: note.text,
                tags: Array.isArray(note.tags)
                  ? note.tags.filter((tag): tag is string => typeof tag === "string")
                  : [],
                ts: typeof note.ts === "number" ? note.ts : 0,
                source: note.source === "user" || note.source === "auto" ? note.source : "orchestrator",
              },
            ];
          })
        : [];
      const agents: Record<string, AgentSummary> = {};
      if (parsed.agents && typeof parsed.agents === "object") {
        for (const [key, raw] of Object.entries(parsed.agents as Record<string, unknown>)) {
          if (!raw || typeof raw !== "object") continue;
          const agent = raw as Record<string, unknown>;
          if (typeof agent.id !== "string" || typeof agent.title !== "string") continue;
          agents[key] = {
            id: agent.id,
            title: agent.title,
            summary: typeof agent.summary === "string" ? agent.summary : "",
            updatedAt: typeof agent.updatedAt === "number" ? agent.updatedAt : 0,
          };
        }
      }
      return {
        notes,
        agents,
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        compacted: typeof parsed.compacted === "number" ? parsed.compacted : 0,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      };
    } catch {
      return empty();
    }
  }

  private write(): void {
    if (!this.file) return;
    this.data.updatedAt = Date.now();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    } catch {
      /* best-effort; memory is non-critical */
    }
  }

  private capSummary(summary: string): string {
    return summary.length > MAX_SUMMARY ? summary.slice(-MAX_SUMMARY) : summary;
  }

  snapshot(): MemorySnapshot {
    return {
      notes: this.data.notes.map((note) => ({ ...note, tags: [...note.tags] })),
      agents: Object.values(this.data.agents).map((agent) => ({ ...agent })),
      summary: this.data.summary,
      updatedAt: this.data.updatedAt,
    };
  }

  writeNote(text: string, tags: string[] = [], source: MemorySource = "orchestrator"): MemoryNote {
    const note: MemoryNote = {
      id: uid("note_"),
      text: text.trim(),
      tags: tags.filter(Boolean),
      ts: Date.now(),
      source,
    };
    this.data.notes.push(note);
    if (this.data.notes.length > MAX_NOTES) this.data.notes = this.data.notes.slice(-MAX_NOTES);
    this.write();
    return note;
  }

  forgetNote(id: string): boolean {
    const next = this.data.notes.filter((note) => note.id !== id);
    if (next.length === this.data.notes.length) return false;
    this.data.notes = next;
    this.write();
    return true;
  }

  search(query: string, limit = 10): MemoryNote[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.data.notes.slice(-limit);
    return this.data.notes
      .filter((note) => note.text.toLowerCase().includes(q) || note.tags.some((tag) => tag.toLowerCase().includes(q)))
      .slice(-limit);
  }

  compact(messages: MessageView[], keep = 12): void {
    const end = messages.length - keep;
    if (end <= this.data.compacted) return;
    const lines: string[] = [];
    for (const message of messages.slice(this.data.compacted, end)) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      const text = oneLine(message.text);
      if (text) lines.push(`${message.role}: ${text.slice(0, 240)}`);
    }
    this.data.compacted = end;
    this.data.summary = this.capSummary([this.data.summary, ...lines].filter(Boolean).join("\n"));
    this.write();
  }

  syncAgents(threads: ThreadView[]): void {
    const now = Date.now();
    for (const thread of threads) {
      if (thread.kind === "orchestrator") continue;
      const last = [...thread.messages].reverse().find((m) => m.role === "assistant" && m.text.trim());
      this.data.agents[thread.id] = {
        id: thread.id,
        title: thread.title,
        summary: last ? oneLine(last.text).slice(0, 500) : (this.data.agents[thread.id]?.summary ?? ""),
        updatedAt: now,
      };
    }
    const entries = Object.values(this.data.agents).sort((a, b) => b.updatedAt - a.updatedAt);
    if (entries.length > MAX_AGENTS) {
      this.data.agents = Object.fromEntries(entries.slice(0, MAX_AGENTS).map((agent) => [agent.id, agent]));
    }
    this.write();
  }

  render(thread: ThreadView, threads: ThreadView[]): string {
    const lines: string[] = [
      "## Orchestrator memory",
      "You are the Orchestrator, the user's single point of contact. Save durable facts, decisions and preferences with orchestrator_memory_write; look them up with orchestrator_memory_search; inspect agents with orchestrator_agent_registry.",
    ];
    if (this.data.summary.trim()) {
      lines.push("", "### Summary of earlier conversation", this.data.summary.trim());
    }
    const notes = this.data.notes.slice(-RENDERED_NOTES);
    if (notes.length) {
      lines.push("", "### Notes");
      for (const note of notes) {
        lines.push(`- ${note.text}${note.tags.length ? ` [${note.tags.join(", ")}]` : ""}`);
      }
    }
    const agents = threads.filter((t) => t.kind !== "orchestrator");
    if (agents.length) {
      lines.push("", "### Agents");
      for (const agent of agents) {
        const last = [...agent.messages].reverse().find((m) => m.role === "assistant" && m.text.trim());
        const tail = last ? ` — ${oneLine(last.text).slice(0, 160)}` : "";
        lines.push(`- ${agent.id} [${agent.status}] ${agent.title}${tail}`);
      }
    }
    const recent = thread.messages
      .slice(0, Math.max(0, thread.messages.length - 1))
      .slice(-RECENT_MESSAGES)
      .map((message) => ({ role: message.role, text: oneLine(message.text) }))
      .filter((message) => message.text && (message.role === "user" || message.role === "assistant"))
      .map((message) => `${message.role}: ${message.text.slice(0, 300)}`);
    if (recent.length) lines.push("", "### Recent conversation", ...recent);
    return lines.join("\n");
  }
}
