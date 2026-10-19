import type { ChildProcess } from "node:child_process";
import { spawn } from "cross-spawn";
import { killTree } from "../util/process.js";
import { asRecord, errMessage } from "../util/coerce.js";
import { logger } from "../util/logger.js";

const log = logger("antigravity:acp");

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface AcpNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface AcpRequest {
  method: string;
  params: Record<string, unknown>;
}

export interface AcpSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface AcpClientOptions {
  onNotification?: (notification: AcpNotification) => void;
  onRequest?: (request: AcpRequest) => Promise<unknown>;
  onStderrLine?: (line: string) => void;
  onExit?: (code: number | null) => void;
}

export class AcpClient {
  onNotification?: (notification: AcpNotification) => void;
  onRequest?: (request: AcpRequest) => Promise<unknown>;
  onStderrLine?: (line: string) => void;
  onExit?: (code: number | null) => void;

  private readonly child: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private closed = false;

  constructor(
    spawnOptions: AcpSpawnOptions,
    options: AcpClientOptions = {},
  ) {
    this.onNotification = options.onNotification;
    this.onRequest = options.onRequest;
    this.onStderrLine = options.onStderrLine;
    this.onExit = options.onExit;
    this.child = spawn(spawnOptions.command, spawnOptions.args, {
      cwd: spawnOptions.cwd,
      env: spawnOptions.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onStdout(chunk.toString()));
    this.child.stderr?.on("data", (chunk: Buffer) => this.onStderr(chunk.toString()));
    this.child.on("error", (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    this.child.on("close", (code) => {
      this.closed = true;
      this.failAll(new Error(`Antigravity agent exited with code ${code ?? -1}`));
      this.onExit?.(code);
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let index: number;
    while ((index = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, index).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line.trim()) this.handleLine(line);
    }
  }

  private onStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    let index: number;
    while ((index = this.stderrBuffer.indexOf("\n")) !== -1) {
      const line = this.stderrBuffer.slice(0, index).replace(/\r$/, "");
      this.stderrBuffer = this.stderrBuffer.slice(index + 1);
      if (line.trim()) this.onStderrLine?.(line);
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      log.debug(`non-json stdout: ${line.slice(0, 200)}`);
      return;
    }
    const id = message.id;
    if (typeof id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if ("error" in message) {
        pending.reject(toError(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof id === "number" && typeof message.method === "string") {
      void this.handleAgentRequest(id, message.method, asRecord(message.params));
      return;
    }
    if (typeof message.method === "string") {
      this.onNotification?.({
        method: message.method,
        params: asRecord(message.params),
      });
    }
  }

  private async handleAgentRequest(id: number, method: string, params: Record<string, unknown>): Promise<void> {
    try {
      const result = this.onRequest ? await this.onRequest({ method, params }) : undefined;
      this.write({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err) {
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: errMessage(err) },
      });
    }
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed) return;
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Antigravity agent connection is closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Antigravity agent connection closed"));
    try {
      this.child.stdin?.end();
    } catch {
      /* ignore */
    }
    killTree(this.child);
  }
}

function toError(error: unknown): Error {
  if (error && typeof error === "object") {
    const shaped = error as { message?: string; code?: number; data?: unknown };
    const err = new Error(shaped.message ?? "Antigravity agent error");
    if (typeof shaped.code === "number") (err as Error & { code?: number }).code = shaped.code;
    if (shaped.data !== undefined) (err as Error & { data?: unknown }).data = shaped.data;
    return err;
  }
  return new Error(String(error));
}
