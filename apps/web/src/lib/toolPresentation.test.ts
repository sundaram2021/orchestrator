import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServerConfig, ThreadView, ToolView } from "@orchestrator/contracts";
import { describeTool } from "./toolPresentation";

const tool = (over: Partial<ToolView>): ToolView => ({
  callId: "call_1",
  tool: "bash",
  args: "{}",
  ...over,
});

const server: McpServerConfig = {
  name: "github",
  transport: "http",
  source: "user",
  detail: "connected",
  tools: ["search_issues"],
  status: "connected",
  enabled: true,
  route: false,
};

const thread: ThreadView = {
  id: "th_1",
  title: "Builder",
  harness: "opencode",
  model: "x",
  status: "running",
  createdAt: 0,
  updatedAt: 0,
  messages: [],
};

test("bash command shows the command and output size", () => {
  const p = describeTool(
    tool({
      tool: "bash",
      args: JSON.stringify({ command: "pnpm test" }),
      result: "line one\nline two",
      ok: true,
    }),
  );
  assert.equal(p.category, "run");
  assert.equal(p.action, "Ran command");
  assert.equal(p.target, "pnpm test");
  assert.equal(p.preview, "2 lines");
  assert.deepEqual(p.body, { kind: "text", text: "line one\nline two" });
});

test("read with metadata only collapses the body", () => {
  const p = describeTool(
    tool({
      tool: "read",
      args: JSON.stringify({ file_path: "C:\\repo\\apps\\web\\src\\main.ts" }),
      result: JSON.stringify({ filePath: "main.ts", lines: 1200, bytes: 2048 }),
      ok: true,
    }),
  );
  assert.equal(p.action, "Read file");
  assert.equal(p.target, "src/main.ts");
  assert.equal(p.preview, "1200 lines · 2.0 KB");
  assert.deepEqual(p.body, { kind: "none" });
});

test("orchestrator thread ids are replaced with the agent title", () => {
  const p = describeTool(
    tool({
      tool: "orchestrator_task_status",
      args: JSON.stringify({ thread_id: "th_1" }),
      result: '"Builder" finished. All tests pass.',
      ok: true,
    }),
    { threads: [thread] },
  );
  assert.equal(p.category, "agent");
  assert.equal(p.action, "Checked agent status");
  assert.equal(p.target, "“Builder”");
  assert.equal(p.preview, "done");
});

test("mcp tools show the server leaf name", () => {
  const p = describeTool(
    tool({
      tool: "github_search_issues",
      args: JSON.stringify({ query: "login bug" }),
      result: "[]",
      ok: true,
    }),
    { servers: [server] },
  );
  assert.equal(p.category, "mcp");
  assert.equal(p.action, "Search Issues");
  assert.equal(p.target, "login bug");
});

test("edits report added and removed lines", () => {
  const p = describeTool(
    tool({
      tool: "edit",
      args: JSON.stringify({ file_path: "src/a.ts" }),
      result: "--- a.ts\n+++ b.ts\n+one\n+two\n-old",
      ok: true,
    }),
  );
  assert.equal(p.category, "write");
  assert.equal(p.preview, "+2 −1");
});

test("searches report a match count and truncation", () => {
  const p = describeTool(
    tool({
      tool: "grep",
      args: JSON.stringify({ pattern: "TODO" }),
      result: "src/a.ts:3:TODO\nsrc/b.ts:9:TODO",
      ok: true,
      truncated: true,
    }),
  );
  assert.equal(p.category, "search");
  assert.equal(p.preview, "2 matches");
  assert.equal(p.truncated, true);
});

test("failed tools show a failure preview", () => {
  const p = describeTool(tool({ result: "boom", ok: false }));
  assert.equal(p.preview, "failed");
});
