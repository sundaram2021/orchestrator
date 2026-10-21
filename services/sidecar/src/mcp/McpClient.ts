import spawn from "cross-spawn";
import { PROTOCOL_VERSION } from "./protocol.js";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { killTree } from "../util/process.js";

const REQUEST_TIMEOUT_MS = 20000;

type StdioChild = ChildProcessByStdio<Writable, Readable, Readable>;

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface McpToolInfo {
  name: string;
  schemaChars: number;
}

export interface McpConnection {
  initialize(): Promise<void>;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): void;
}

const toToolInfos = (result: unknown): McpToolInfo[] => {
  const tools = (result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];
  return tools
    .filter((tool): tool is { name: string } => typeof tool.name === "string" && tool.name.length > 0)
    .map((tool) => ({ name: tool.name, schemaChars: JSON.stringify(tool).length }));
};

const parseSse = (text: string): JsonRpcMessage[] => {
  const events: JsonRpcMessage[] = [];
  let data: string[] = [];
  const flush = (): void => {
    if (data.length === 0) return;
    const joined = data.join("\n");
    data = [];
    try {
      events.push(JSON.parse(joined) as JsonRpcMessage);
    } catch {
      /* ignore malformed event */
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
    else if (line.trim() === "") flush();
  }
  flush();
  return events;
};

const readMessage = async (res: Response, id: number | string): Promise<JsonRpcMessage | null> => {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const events = parseSse(text);
    return (
      events.find((e) => e.id === id) ??
      events.find((e) => e.result !== undefined || e.error !== undefined) ??
      events[events.length - 1] ??
      null
    );
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as JsonRpcMessage;
  } catch {
    return null;
  }
};

class HttpConnection implements McpConnection {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  private baseHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
  }

  private async post(message: JsonRpcMessage, expectReply: boolean): Promise<JsonRpcMessage | null> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.baseHeaders(),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!expectReply) {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await res.text();
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return readMessage(res, message.id ?? "");
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const reply = await this.post({ jsonrpc: "2.0", id, method, params }, true);
    if (reply?.error) throw new Error(reply.error.message ?? "mcp error");
    return reply?.result;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "orchestrator", version: "0.1.0" },
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
  }

  async listTools(): Promise<McpToolInfo[]> {
    return toToolInfos(await this.request("tools/list", {}));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args });
    const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content ?? [];
    const text = content.map((c) => c.text ?? "").filter(Boolean).join("\n");
    return text || JSON.stringify(result ?? null);
  }

  close(): void {
    this.sessionId = null;
  }
}

class StdioConnection implements McpConnection {
  private readonly child: StdioChild;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(command: string, args: string[], env: Record<string, string> = {}) {
    this.child = spawn(command, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }) as StdioChild;

    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString()));
    this.child.on("error", (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    this.child.on("close", () => this.failAll(new Error("mcp stdio process closed")));
  }

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "mcp error"));
      else pending.resolve(message.result);
    }
  }

  private failAll(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`mcp stdio timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "orchestrator", version: "0.1.0" },
    });
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<McpToolInfo[]> {
    return toToolInfos(await this.request("tools/list", {}));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args });
    const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content ?? [];
    const text = content.map((c) => c.text ?? "").filter(Boolean).join("\n");
    return text || JSON.stringify(result ?? null);
  }

  close(): void {
    this.failAll(new Error("mcp stdio connection closed"));
    this.child.stdin.end();
    killTree(this.child);
  }
}

const withInit = async (connection: McpConnection): Promise<McpConnection> => {
  await connection.initialize();
  return connection;
};

export const connectHttp = (url: string, headers: Record<string, string> = {}): Promise<McpConnection> =>
  withInit(new HttpConnection(url, headers));

export const connectStdio = (
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<McpConnection> => withInit(new StdioConnection(command, args, env));
