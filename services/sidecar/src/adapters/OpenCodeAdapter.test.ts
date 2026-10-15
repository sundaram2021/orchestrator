import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunLine } from "./OpenCodeAdapter.js";

test("parses streamed text parts", () => {
  const line = JSON.stringify({
    type: "text",
    timestamp: 1,
    sessionID: "ses_1",
    part: { type: "text", text: "pong" },
  });
  assert.deepEqual(parseRunLine(line), [{ kind: "assistant", text: "pong", delta: true }]);
});

test("parses tool calls with completed state", () => {
  const line = JSON.stringify({
    type: "tool",
    part: {
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: { status: "completed", input: { cmd: "ls" }, output: "file.ts" },
    },
  });
  const events = parseRunLine(line);
  assert.equal(events[0]?.kind, "tool");
  assert.equal(events[1]?.kind, "toolResult");
  assert.equal(events[1] && "result" in events[1] ? events[1].result : "", "file.ts");
});

test("ignores step lifecycle lines and non-json", () => {
  assert.deepEqual(parseRunLine(JSON.stringify({ type: "step_start", part: {} })), []);
  assert.deepEqual(parseRunLine(JSON.stringify({ type: "step_finish", part: {} })), []);
  assert.deepEqual(parseRunLine("not json"), []);
});

test("surfaces error lines", () => {
  const events = parseRunLine(JSON.stringify({ type: "error", error: { message: "boom" } }));
  assert.deepEqual(events, [{ kind: "error", message: "boom" }]);
});
