import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ThreadView } from "@orchestrator/contracts";
import {
  ORCHESTRATOR_TOOLS,
  callOrchestratorTool,
  createMcpHandler,
  handleMcpMessage,
  type OrchestratorApi,
} from "./OrchestratorMcpServer.js";

const makeStub = (): { api: OrchestratorApi; threads: Map<string, ThreadView> } => {
  const threads = new Map<string, ThreadView>();
  let counter = 0;
  const api: OrchestratorApi = {
    capabilities: () => ({
      model: { harness: "opencode", id: "opencode/x", name: "x" },
      harnesses: [
        { id: "opencode", name: "OpenCode", models: [{ id: "opencode/x", name: "x" }] },
        { id: "antigravity", name: "Antigravity", models: [{ id: "antigravity/y", name: "y" }] },
      ],
    }),
    async spawnThread(opts) {
      const id = `th_${++counter}`;
      threads.set(id, {
        id,
        title: opts.prompt,
        harness: opts.harness ?? "opencode",
        model: opts.model ?? "opencode/x",
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        prompt: opts.prompt,
        ...(opts.parentId ? { parentId: opts.parentId } : {}),
      });
      return id;
    },
    threadView: (id) => threads.get(id),
    listThreadViews: () => [...threads.values()],
    async interrupt(id) {
      const thread = threads.get(id);
      if (thread) thread.status = "stopped";
    },
    async awaitThread(id) {
      const thread = threads.get(id);
      if (thread) {
        thread.status = "done";
        thread.messages.push({ id: "m1", role: "assistant", text: "PONG", tools: [] });
      }
      return thread;
    },
    async sendMessage(id, text) {
      const thread = threads.get(id);
      if (!thread) throw new Error(`thread ${id} not found`);
      thread.status = "running";
      thread.messages.push({ id: `m${thread.messages.length + 1}`, role: "user", text, tools: [] });
    },
    memoryWrite: (text) => `Saved memory note: ${text}`,
    memorySearch: (query) => `matches for ${query}`,
    memoryList: () => "note list",
    agentRegistry: () => "registry",
  };
  return { api, threads };
};

test("tools/list exposes the orchestrator toolset", () => {
  const names = ORCHESTRATOR_TOOLS.map((t) => t.name);
  for (const expected of [
    "capabilities",
    "create_thread",
    "delegate_task",
    "task_status",
    "task_cancel",
    "thread_list",
    "thread_read",
    "thread_wait",
    "thread_interrupt",
    "send_message",
    "memory_write",
    "memory_search",
    "memory_list",
    "agent_registry",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});

test("initialize echoes protocol version and identifies the server", async () => {
  const { api } = makeStub();
  const reply = await handleMcpMessage(api, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.ok(reply);
  const result = reply.result as { protocolVersion: string; serverInfo: { name: string } };
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.equal(result.serverInfo.name, "orchestrator");
});

test("notifications return no reply", async () => {
  const { api } = makeStub();
  const reply = await handleMcpMessage(api, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(reply, null);
});

test("unknown method returns JSON-RPC error", async () => {
  const { api } = makeStub();
  const reply = await handleMcpMessage(api, { jsonrpc: "2.0", id: 2, method: "does/not-exist" });
  assert.ok(reply?.error);
  assert.equal(reply.error.code, -32601);
});

test("tools/call capabilities returns harness/model catalog", async () => {
  const { api } = makeStub();
  const reply = await handleMcpMessage(api, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "capabilities", arguments: {} },
  });
  const content = (reply?.result as { content: { text: string }[] }).content;
  assert.match(content[0]!.text, /opencode/);
  assert.match(content[0]!.text, /antigravity/);
});

test("create_thread spawns a thread and returns its id", async () => {
  const { api, threads } = makeStub();
  const text = await callOrchestratorTool(api, "create_thread", { prompt: "do work" });
  assert.match(text, /th_1/);
  assert.equal(threads.size, 1);
});

test("delegate_task with wait blocks and returns the result", async () => {
  const { api } = makeStub();
  const text = await callOrchestratorTool(api, "delegate_task", { prompt: "say pong", wait: true, parent_id: "th_parent" });
  assert.match(text, /finished/);
  assert.match(text, /PONG/);
});

test("delegate_task without wait returns immediately", async () => {
  const { api } = makeStub();
  const text = await callOrchestratorTool(api, "delegate_task", { prompt: "background" });
  assert.match(text, /Delegated task/);
});

test("send_message delivers an instruction to an existing thread", async () => {
  const { api, threads } = makeStub();
  await callOrchestratorTool(api, "create_thread", { prompt: "child" });
  const text = await callOrchestratorTool(api, "send_message", { thread_id: "th_1", text: "do more" });
  assert.match(text, /Sent instruction to thread th_1/);
  const messages = threads.get("th_1")?.messages ?? [];
  assert.ok(messages.some((m) => m.role === "user" && m.text === "do more"));
});

test("send_message on a missing thread reports an error", async () => {
  const { api } = makeStub();
  const reply = await handleMcpMessage(api, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "send_message", arguments: { thread_id: "th_nope", text: "hi" } },
  });
  const result = reply?.result as { isError?: boolean };
  assert.equal(result.isError, true);
});

test("task_status on a missing thread reports an error", async () => {
  const { api } = makeStub();
  const reply = await handleMcpMessage(api, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "task_status", arguments: { thread_id: "th_nope" } },
  });
  const result = reply?.result as { isError?: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /not found/);
});

test("http handler serves initialize and tools/list over POST", async () => {
  const { api } = makeStub();
  const handler = createMcpHandler(api);
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(init.status, 200);
    assert.ok(init.headers.get("mcp-session-id"));
    const listed = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const body = (await listed.json()) as { result: { tools: unknown[] } };
    assert.equal(body.result.tools.length, ORCHESTRATOR_TOOLS.length);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
