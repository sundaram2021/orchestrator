import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "./protocol.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ThreadView } from "@orchestrator/contracts";
import { asRecord, errMessage } from "../util/coerce.js";

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
    description:
      "Check what a thread is doing right now (or what it finished with). Returns a short plain-language description.",
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
  {
    name: "send_message",
    description:
      "Send a follow-up instruction to an existing agent thread and start it working. Use this to give further instructions to a child agent, or to answer something it asked.",
    inputSchema: obj(
      {
        thread_id: threadIdProp,
        text: { type: "string", description: "The instruction to deliver to the agent." },
      },
      ["thread_id", "text"],
    ),
  },
  {
    name: "memory_write",
    description:
      "Save a durable fact, user preference, architectural decision or important agent detail to orchestrator memory. Use tags to group entries.",
    inputSchema: obj(
      {
        text: { type: "string", description: "The fact to remember, written concisely." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for retrieval." },
      },
      ["text"],
    ),
  },
  {
    name: "memory_search",
    description: "Search orchestrator memory notes by text or tag.",
    inputSchema: obj(
      {
        query: { type: "string", description: "Text or tag to search for." },
        limit: { type: "number", description: "Max notes to return (default 10)." },
      },
      ["query"],
    ),
  },
  {
    name: "memory_list",
    description: "List the most recent orchestrator memory notes.",
    inputSchema: obj({ limit: { type: "number", description: "Max notes (default 40)." } }),
  },
  {
    name: "agent_registry",
    description:
      "List every agent thread (running or not) with id, status, title, lineage and latest assistant result.",
    inputSchema: obj({}),
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
  sendMessage(threadId: string, text: string): Promise<void>;
  memoryWrite(text: string, tags?: string[]): string;
  memorySearch(query: string, limit?: number): string;
  memoryList(limit?: number): string;
  agentRegistry(): string;
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
  const pending = [...thread.messages]
    .reverse()
    .flatMap((m) => [...m.tools].reverse())
    .find((tool) => tool.ok === undefined);
  if (thread.status === "running") {
    if (pending) return `"${thread.title}" is running and currently using ${humanTool(pending.tool)}.`;
    return `"${thread.title}" is running and working on its task.`;
  }
  if (thread.status === "error") return `"${thread.title}" hit an error and stopped.`;
  if (thread.status === "stopped") return `"${thread.title}" was stopped before finishing.`;
  return last
    ? `"${thread.title}" finished. ${last.text.trim().slice(0, 4000)}`
    : `"${thread.title}" finished without producing any output.`;
};

const KNOWN_TOOLS: Record<string, string> = {
  run_command: "a command",
  read_file: "a file",
  write_file: "a file",
  edit_file: "a file",
  list_dir: "a folder",
  list_files: "a folder",
  grep: "a code search",
  glob: "a file search",
  webfetch: "a web page",
  websearch: "the web",
  task: "a sub-agent",
  todowrite: "its task list",
  browser: "the browser",
  skill: "a skill",
};

const humanTool = (name: string): string => {
  const known = KNOWN_TOOLS[name];
  if (known) return known;
  const leaf = name.includes("__") ? (name.split("__").pop() ?? name) : (name.split("/").pop() ?? name);
  return leaf.replace(/[_-]+/g, " ");
};

const brief = (text: string, max = 100): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

const toolArgBrief = (args: string): string => {
  try {
    const value = JSON.parse(args) as Record<string, unknown>;
    for (const key of [
      "command_line",
      "command",
      "cmd",
      "file_path",
      "path",
      "AbsolutePath",
      "pattern",
      "query",
      "url",
      "task",
      "text",
    ]) {
      const item = value[key];
      if (typeof item === "string" && item.trim()) return brief(item);
    }
  } catch {
    /* args are not JSON */
  }
  return "";
};

const formatCapabilities = (cap: ReturnType<OrchestratorApi["capabilities"]>): string => {
  const lines = [`Default model: ${cap.model.name} (${cap.model.harness} / ${cap.model.id})`];
  for (const harness of cap.harnesses) {
    lines.push("", `${harness.name} (${harness.id})`);
    if (!harness.models.length) lines.push("  (no models)");
    for (const model of harness.models) lines.push(`  • ${model.name} — ${model.id}`);
  }
  return lines.join("\n");
};

const readThread = (thread: ThreadView, view: string): string => {
  const lines = [`Thread "${thread.title}" [${thread.status}] (id ${thread.id})`];
  for (const message of thread.messages) {
    if (view === "activity") {
      if (message.reasoning?.trim()) lines.push(`\n[reasoning] ${message.reasoning.trim().slice(0, 1500)}`);
      if (message.text.trim()) lines.push(`\n${message.role}: ${message.text.trim().slice(0, 2500)}`);
      for (const tool of message.tools) {
        const arg = toolArgBrief(tool.args);
        const state = tool.ok === false ? "failed" : tool.ok === true ? "ok" : "pending";
        lines.push(`  · ${humanTool(tool.tool)}${arg ? `: ${arg}` : ""} — ${state}`);
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
      return formatCapabilities(api.capabilities());

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
      const titles = new Map(threads.map((thread) => [thread.id, thread.title]));
      const rows = threads.slice(0, Math.max(0, limit)).map((thread) => {
        const parent = thread.parentId
          ? ` — child of "${titles.get(thread.parentId) ?? "another agent"}"`
          : "";
        return `${thread.title} [${thread.status}]${parent}\n  id: ${thread.id}`;
      });
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

    case "send_message": {
      const threadId = requireThreadId(args);
      const text = strArg(args, "text");
      if (!text) throw new Error("text is required");
      const view = api.threadView(threadId);
      if (!view) throw new Error(`thread ${threadId} not found`);
      await api.sendMessage(threadId, text);
      return `Sent instruction to thread ${threadId} (${view.title}).`;
    }

    case "memory_write": {
      const text = strArg(args, "text");
      if (!text) throw new Error("text is required");
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
        : [];
      return api.memoryWrite(text, tags);
    }

    case "memory_search": {
      const query = strArg(args, "query");
      if (!query) throw new Error("query is required");
      return api.memorySearch(query, numArg(args, "limit") ?? 10);
    }

    case "memory_list":
      return api.memoryList(numArg(args, "limit") ?? 40);

    case "agent_registry":
      return api.agentRegistry();

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
      const params = asRecord(message.params);
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
      const params = asRecord(message.params);
      const name = typeof params.name === "string" ? params.name : "";
      const args = asRecord(params.arguments);
      try {
        const text = await callOrchestratorTool(api, name, args);
        return ok(id, { content: [{ type: "text", text }] });
      } catch (error) {
        const text = `Error: ${errMessage(error)}`;
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
