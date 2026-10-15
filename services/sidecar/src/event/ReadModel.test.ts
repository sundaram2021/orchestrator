import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "@orchestrator/contracts";
import { ReadModel } from "./ReadModel.js";

const config: AppConfig = {
  workspace: "/tmp/ws",
  model: { harness: "opencode", id: "opencode/x", name: "x" },
  harnesses: [],
  mcp: [],
  skills: [],
  version: "0.1.0",
};

test("projects a full thread lifecycle into the read model", () => {
  const rm = new ReadModel(config);
  const apply = (seq: number, event: Parameters<ReadModel["apply"]>[0]["event"]): void =>
    rm.apply({ seq, ts: seq, event });

  apply(0, { type: "thread.started", threadId: "t1", title: "hello", harness: "opencode", model: "m" });
  apply(1, { type: "message.appended", threadId: "t1", messageId: "m1", role: "assistant", text: "he" });
  apply(2, { type: "message.delta", threadId: "t1", messageId: "m1", delta: "llo" });
  apply(3, { type: "tool.called", threadId: "t1", callId: "c1", tool: "read", args: "{}" });
  apply(4, { type: "tool.result", threadId: "t1", callId: "c1", ok: true, result: "ok" });
  apply(5, { type: "turn.completed", threadId: "t1" });
  apply(6, { type: "agent.status", threadId: "t1", status: "done" });

  const snapshot = rm.snapshot();
  const thread = snapshot.threads[0];
  assert.ok(thread);
  assert.equal(thread.status, "done");
  assert.equal(thread.title, "hello");
  assert.equal(thread.messages[0]?.text, "hello");
  assert.equal(thread.messages[0]?.tools[0]?.ok, true);
  assert.equal(snapshot.lastSeq, 6);
});

test("removes finished threads", () => {
  const rm = new ReadModel(config);
  rm.apply({ seq: 0, ts: 0, event: { type: "thread.started", threadId: "t1", title: "a", harness: "opencode", model: "m" } });
  rm.apply({ seq: 1, ts: 1, event: { type: "thread.removed", threadId: "t1" } });
  assert.equal(rm.snapshot().threads.length, 0);
});
