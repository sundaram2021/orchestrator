import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ThreadView } from "@orchestrator/contracts";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "orchestrator";
const SERVER_VERSION = "0.1.0";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const threadIdProp = { type: "string", description: "Target thread id (e.g. th_abc123)." };

export const ORCHESTRATOR_TOOLS: McpToolDef[] = [
  {
    name: "capabilities",
    description:
      "List the harnesses (OpenCode, Antigravity) and their available models, plus the current default model. Use these ids for create_thread / delegate_task.",
    inputSchema: obj({}),
  },
  {
    name: "create_thread",
    description:
      "Start a new top-level agent thread with a prompt and return its thread id immediately (runs in the background). Prefer delegate_task when you need the result back.",
    inputSchema: obj(
      {
        prompt: { type: "string", description: "The task prompt for the new agent." },
        harness: { type: "string", description: "Harness id from capabilities (defaults to the current model)." },
        model: { type: "string", description: "Model id from capabilities (defaults to the current model)." },
        parent_id: { type: "string", description: "Optional parent thread id to link lineage." },
      },
      ["prompt"],
    ),
  },
  {
    name: "delegate_task",
    description:
      "Hand off a task to a new child agent thread. With wait=true it blocks until the child finishes and returns its result; otherwise it returns the thread id immediately. Pass parent_id to link lineage.",
    inputSchema: obj(
      {
        prompt: { type: "string", description: "The task prompt for the child agent." },
        harness: { type: "string", description: "Harness id from capabilities." },
        model: { type: "string", description: "Model id from capabilities." },
        parent_id: { type: "string", description: "Parent thread id to link lineage." },
        wait: { type: "boolean", description: "Block until the child finishes and return its result (default false)." },
        timeout_ms: { type: "number", description: "Max wait budget in ms when wait=true (default 600000)." },
      },
      ["prompt"],
    ),
  },
  {
    name: "task_status",
    description: "Read a thread's status, model, branch, message count and latest assistant result.",
    inputSchema: obj({ thread_id: threadIdProp }, ["thread_id"]),
  },
  {
    name: "task_cancel",
    description: "Stop a running thread (interrupts the active turn).",
    inputSchema: obj({ thread_id: threadIdProp }, ["thread_id"]),
  },
  {
    name: "thread_list",
    description: "List threads, newest first, with id, status and title.",
    inputSchema: obj({ limit: { type: "number", description: "Max rows (default 50)." } }),
  },
  {
    name: "thread_read",
    description: "Read a thread's timeline. view='messages' (default) returns user/assistant text; view='activity' also includes reasoning and tool calls.",
    inputSchema: obj(
      {
        thread_id: threadIdProp,
        view: { type: "string", enum: ["messages", "activity"], description: "Detail level (default messages)." },
      },
      ["thread_id"],
    ),
  },
  {
    name: "thread_wait",
    description: "Wait for a thread to reach a terminal state (done/stopped/error) and return its summary. Times out without interrupting the run.",
    inputSchema: obj(
      {
        thread_id: threadIdProp,
        timeout_ms: { type: "number", description: "Max wait in ms (default 600000)." },
      },
      ["thread_id"],
    ),
  },
  {
    name: "thread_interrupt",
    description: "Interrupt the active turn of a thread (alias of task_cancel).",
    inputSchema: obj({ thread_id: threadIdProp }, ["thread_id"]),
  },
];

export interface OrchestratorApi {
  capabilities(): {
    harnesses: { id: string; name: string; models: { id: string; name: string }[] }[];
    model: { harness: string; id: string; name: string };
  };
  spawnThread(opts: {
    prompt: string;
    harness?: string;
    model?: string;
    parentId?: string;
  }): Promise<string>;
  threadView(threadId: string): ThreadView | undefined;
  listThreadViews(): ThreadView[];
  interrupt(threadId: string): Promise<void>;
  awaitThread(threadId: string, timeoutMs?: number): Promise<ThreadView | undefined>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const strArg = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const numArg = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const requireThreadId = (args: Record<string, unknown>): string => {
  const id = strArg(args, "thread_id");
  if (!id) throw new Error("thread_id is required");
  return id;
};

const requirePrompt = (args: Record<string, unknown>): string => {
  const prompt = strArg(args, "prompt");
  if (!prompt) throw new Error("prompt is required");
  return prompt;
};

const summarize = (thread: ThreadView): string => {
  const last = [...thread.messages].reverse().find((m) => m.role === "assistant" && m.text.trim());
  const lines = [
    `Thread ${thread.id}`,
    `title: ${thread.title}`,
    `status: ${thread.status}`,
    `model: ${thread.harness}/${thread.model}`,
  ];
  if (thread.parentId) lines.push(`parent: ${thread.parentId}`);
  if (thread.branch) lines.push(`branch: ${thread.branch}`);
  lines.push(`messages: ${thread.messages.length}`);
  if (last?.text.trim()) lines.push("", "last assistant:", last.text.trim().slice(0, 4000));
  return lines.join("\n");
};

const readThread = (thread: ThreadView, view: string): string => {
  const lines = [`Thread ${thread.id} — ${thread.title} [${thread.status}]`];
  for (const message of thread.messages) {
    if (view === "activity") {
      if (message.reasoning?.trim()) lines.push(`\n[reasoning] ${message.reasoning.trim().slice(0, 1500)}`);
      if (message.text.trim()) lines.push(`\n${message.role}: ${message.text.trim().slice(0, 2500)}`);
      for (const tool of message.tools) {
        lines.push(`  · tool ${tool.tool}${tool.ok === false ? " (failed)" : tool.ok === true ? " (ok)" : " (pending)"}`);
      }
    } else if (message.text.trim()) {
      lines.push(`\n${message.role}: ${message.text.trim().slice(0, 2500)}`);
    }
  }
  return lines.join("\n");
};

export async function callOrchestratorTool(
  api: OrchestratorApi,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "capabilities":
      return JSON.stringify(api.capabilities(), null, 2);

    case "create_thread": {
      const prompt = requirePrompt(args);
      const threadId = await api.spawnThread({
        prompt,
        ...(strArg(args, "harness") ? { harness: strArg(args, "harness") } : {}),
        ...(strArg(args, "model") ? { model: strArg(args, "model") } : {}),
        ...(strArg(args, "parent_id") ? { parentId: strArg(args, "parent_id") } : {}),
      });
      return `Created thread ${threadId}. Use task_status with thread_id="${threadId}" to read progress.`;
    }

    case "delegate_task": {
      const prompt = requirePrompt(args);
      const threadId = await api.spawnThread({
        prompt,
        ...(strArg(args, "harness") ? { harness: strArg(args, "harness") } : {}),
        ...(strArg(args, "model") ? { model: strArg(args, "model") } : {}),
        ...(strArg(args, "parent_id") ? { parentId: strArg(args, "parent_id") } : {}),
      });
      if (args.wait !== true) {
        return `Delegated task in thread ${threadId}. Use task_status with thread_id="${threadId}" to read progress.`;
      }
      const timeout = numArg(args, "timeout_ms") ?? 600_000;
      const view = await api.awaitThread(threadId, timeout);
      if (!view) return `Thread ${threadId} not found.`;
      return (
        summarize(view) +
        (view.status === "running" ? "\n\n(wait timed out — the task is still running; call task_status later)" : "")
      );
    }

    case "task_status":
    case "thread_wait": {
      const threadId = requireThreadId(args);
      if (name === "thread_wait") {
        const timeout = numArg(args, "timeout_ms") ?? 600_000;
        const view = await api.awaitThread(threadId, timeout);
        if (!view) throw new Error(`thread ${threadId} not found`);
        return summarize(view) + (view.status === "running" ? "\n\n(wait timed out — still running)" : "");
      }
      const view = api.threadView(threadId);
      if (!view) throw new Error(`thread ${threadId} not found`);
      return summarize(view);
    }

    case "thread_read": {
      const threadId = requireThreadId(args);
      const view = api.threadView(threadId);
      if (!view) throw new Error(`thread ${threadId} not found`);
      const detail = strArg(args, "view") === "activity" ? "activity" : "messages";
      return readThread(view, detail);
    }

    case "thread_list": {
      const limit = numArg(args, "limit") ?? 50;
      const threads = api.listThreadViews();
      const rows = threads.slice(0, Math.max(0, limit)).map(
        (t) => `${t.id}  [${t.status}]  ${t.title}${t.parentId ? `  (parent ${t.parentId})` : ""}`,
      );
      return rows.length ? rows.join("\n") : "No threads.";
    }

    case "task_cancel":
    case "thread_interrupt": {
      const threadId = requireThreadId(args);
      const view = api.threadView(threadId);
      if (!view) throw new Error(`thread ${threadId} not found`);
      await api.interrupt(threadId);
      return `Interrupted thread ${threadId}.`;
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const ok = (id: number | string | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result,
});

const err = (id: number | string | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export async function handleMcpMessage(
  api: OrchestratorApi,
  message: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const method = message.method;
  if (typeof method !== "string") return err(id, -32600, "invalid request");
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      const params = rec(message.params);
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: ORCHESTRATOR_TOOLS });
    case "tools/call": {
      const params = rec(message.params);
      const name = typeof params.name === "string" ? params.name : "";
      const args = rec(params.arguments);
      try {
        const text = await callOrchestratorTool(api, name, args);
        return ok(id, { content: [{ type: "text", text }] });
      } catch (error) {
        const text = `Error: ${error instanceof Error ? error.message : String(error)}`;
        return ok(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return err(id, -32601, `method not found: ${method}`);
  }
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const handlePost = async (
  api: OrchestratorApi,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(await readBody(req)) as JsonRpcRequest;
  } catch {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify(err(null, -32700, "parse error")));
    return;
  }
  const existing = req.headers["mcp-session-id"];
  const sessionId = typeof existing === "string" && existing ? existing : randomUUID();
  const headers = { "content-type": "application/json", "mcp-session-id": sessionId };
  const reply = await handleMcpMessage(api, message);
  if (!reply) {
    res.writeHead(202, headers).end();
    return;
  }
  res.writeHead(200, headers).end(JSON.stringify(reply));
};

const handleSse = (req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": orchestrator mcp ready\n\n");
  const timer = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 25_000);
  req.on("close", () => clearInterval(timer));
};

export function createMcpHandler(
  api: OrchestratorApi,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method === "POST") {
      void handlePost(api, req, res);
      return;
    }
    if (req.method === "GET") {
      handleSse(req, res);
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(405, { allow: "GET, POST, DELETE" }).end();
  };
}
