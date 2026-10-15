import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventStore } from "./EventStore.js";

test("append assigns monotonically increasing seq", () => {
  const store = new EventStore();
  const a = store.append({ type: "turn.completed", threadId: "t1" });
  const b = store.append({ type: "turn.completed", threadId: "t1" });
  assert.equal(a.seq, 0);
  assert.equal(b.seq, 1);
  assert.equal(store.lastSeq, 1);
  assert.ok(a.ts <= b.ts);
});

test("since returns events from an inclusive sequence", () => {
  const store = new EventStore();
  store.append({ type: "turn.completed", threadId: "t1" });
  store.append({ type: "turn.completed", threadId: "t1" });
  store.append({ type: "turn.completed", threadId: "t1" });
  assert.deepEqual(store.since(1).map((e) => e.seq), [1, 2]);
  assert.deepEqual(store.since(5), []);
});

test("persists events to a journal and replays them on load", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "orchestrator-")), "events.jsonl");
  const first = new EventStore(file);
  first.append({ type: "thread.started", threadId: "t1", title: "a", harness: "opencode", model: "m" });
  first.append({ type: "turn.completed", threadId: "t1" });
  first.close();

  const second = new EventStore(file);
  const replayed = second.load();
  assert.equal(replayed.length, 2);
  assert.equal(second.lastSeq, 1);
  const next = second.append({ type: "thread.removed", threadId: "t1" });
  assert.equal(next.seq, 2);
});
