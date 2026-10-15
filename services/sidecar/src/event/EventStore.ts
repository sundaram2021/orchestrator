import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DomainEvent, EventBody } from "@orchestrator/contracts";

const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD = 256;

export class EventStore {
  private readonly events: DomainEvent[] = [];
  private seq = 0;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file?: string) {}

  load(): readonly DomainEvent[] {
    if (!this.file) return this.events;
    let text = "";
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return this.events;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as DomainEvent;
        this.events.push(event);
        this.seq = Math.max(this.seq, event.seq + 1);
      } catch {
        /* skip corrupt line */
      }
    }
    return this.events;
  }

  append(body: EventBody): DomainEvent {
    const event: DomainEvent = { seq: this.seq++, ts: Date.now(), event: body };
    this.events.push(event);
    this.persist(event);
    return event;
  }

  private persist(event: DomainEvent): void {
    if (!this.file) return;
    this.buffer.push(JSON.stringify(event));
    if (this.buffer.length >= FLUSH_THRESHOLD) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.file || this.buffer.length === 0) return;
    const payload = `${this.buffer.join("\n")}\n`;
    this.buffer = [];
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, payload);
    } catch {
      /* best-effort durability */
    }
  }

  close(): void {
    this.flush();
  }

  since(fromSeq: number): DomainEvent[] {
    return this.events.filter((e) => e.seq >= fromSeq);
  }

  all(): readonly DomainEvent[] {
    return this.events;
  }

  get lastSeq(): number {
    return this.seq - 1;
  }
}
