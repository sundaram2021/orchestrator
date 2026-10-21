import spawn from "cross-spawn";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { killTree } from "../util/process.js";
import { logger } from "../util/logger.js";

const log = logger("opencode:server");

export interface ServerEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface ServerModel {
  providerID: string;
  modelID: string;
  variant?: string;
}

type ServerChild = ChildProcessByStdio<null, Readable, Readable>;

export class OpenCodeServer {
  private child: ServerChild | null = null;
  private base: string | null = null;
  private starting: Promise<string> | null = null;
  private sseAbort: AbortController | null = null;
  private readonly listeners = new Set<(event: ServerEvent) => void>();

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async url(cwd: string): Promise<string> {
    if (this.base) return this.base;
    if (!this.starting) this.starting = this.start(cwd).finally(() => (this.starting = null));
    return this.starting;
  }

  private start(cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn("opencode", ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
        cwd,
        env: this.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }) as ServerChild;

      let settled = false;
      let buffer = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killTree(child);
        reject(new Error("opencode serve did not start in time"));
      }, 20_000);

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const match = /https?:\/\/127\.0\.0\.1:(\d+)/.exec(buffer);
        if (!match || settled) return;
        settled = true;
        clearTimeout(timer);
        this.child = child;
        this.base = `http://127.0.0.1:${match[1]}`;
        this.attachEvents();
        log.info(`server ready at ${this.base}`);
        resolve(this.base);
      });
      child.stderr.on("data", (chunk: Buffer) => log.debug(chunk.toString().trim()));
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      child.on("close", () => {
        if (this.child === child) {
          this.child = null;
          this.base = null;
          this.sseAbort?.abort();
          this.sseAbort = null;
        }
      });
    });
  }

  private attachEvents(): void {
    if (!this.base) return;
    const controller = new AbortController();
    this.sseAbort = controller;
    const url = this.base;
    void (async () => {
      try {
        const res = await fetch(`${url}/event`, {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (!line.startsWith("data:")) continue;
            let event: ServerEvent;
            try {
              event = JSON.parse(line.slice(5).trim()) as ServerEvent;
            } catch {
              continue;
            }
            for (const listener of this.listeners) listener(event);
          }
        }
      } catch {
        /* connection closed on shutdown */
      }
    })();
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!this.base) throw new Error("opencode server is not running");
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) throw new Error(`opencode ${method} ${path} failed: HTTP ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  async createSession(model: ServerModel, title?: string): Promise<string> {
    const result = (await this.request("POST", "/session", {
      title,
      model: { providerID: model.providerID, id: model.modelID, ...(model.variant ? { variant: model.variant } : {}) },
    })) as { id?: string };
    if (!result?.id) throw new Error("opencode did not return a session id");
    return result.id;
  }

  async sendMessage(
    sessionID: string,
    model: ServerModel,
    text: string,
    system?: string,
    attachments?: { name: string; mime: string; data: string }[],
  ): Promise<void> {
    const files = (attachments ?? []).map((a) => ({
      type: "file" as const,
      mime: a.mime,
      filename: a.name,
      url: `data:${a.mime};base64,${a.data}`,
    }));
    await this.request("POST", `/session/${sessionID}/message`, {
      model: { providerID: model.providerID, modelID: model.modelID },
      ...(model.variant ? { variant: model.variant } : {}),
      ...(system ? { system } : {}),
      parts: [{ type: "text", text }, ...files],
    });
  }

  async abort(sessionID: string): Promise<void> {
    await this.request("POST", `/session/${sessionID}/abort`).catch(() => undefined);
  }

  async summarize(sessionID: string, model: ServerModel): Promise<boolean> {
    const result = await this.request("POST", `/session/${sessionID}/summarize`, {
      providerID: model.providerID,
      modelID: model.modelID,
    });
    return result === true;
  }

  async providerLimits(): Promise<Map<string, number>> {
    const limits = new Map<string, number>();
    try {
      const data = (await this.request("GET", "/provider")) as {
        all?: { id?: string; models?: Record<string, { limit?: { context?: number } }> }[];
      };
      for (const provider of data.all ?? []) {
        if (!provider.id || !provider.models) continue;
        for (const [modelId, model] of Object.entries(provider.models)) {
          const context = model.limit?.context;
          if (typeof context === "number" && context > 0) {
            limits.set(`${provider.id}/${modelId}`, context);
          }
        }
      }
    } catch {
      /* provider catalog unavailable — usage will omit context limit */
    }
    return limits;
  }

  async dispose(): Promise<void> {
    this.sseAbort?.abort();
    this.sseAbort = null;
    this.listeners.clear();
    const child = this.child;
    this.child = null;
    this.base = null;
    if (child) killTree(child);
  }
}
