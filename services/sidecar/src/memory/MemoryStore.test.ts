import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageView, ThreadView } from "@orchestrator/contracts";
import { MemoryStore } from "./MemoryStore.js";

const message = (id: string, role: MessageView["role"], text: string): MessageView => ({
  id,
  role,
  text,
  tools: [],
});

const thread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  id: "th_1",
  title: "Fix login",
  harness: "opencode",
  model: "opencode/x",
  status: "done",
  createdAt: 0,
  updatedAt: 0,
  messages: [],
  ...overrides,
});

test("writes, searches and forgets notes", () => {
  const memory = new MemoryStore();
  const note = memory.writeNote("Prefer pnpm over npm", ["tooling"], "user");
  assert.match(note.id, /^note_/);
  assert.equal(memory.search("pnpm").length, 1);
  assert.equal(memory.search("tooling").length, 1);
  assert.equal(memory.search("missing").length, 0);
  assert.equal(memory.forgetNote(note.id), true);
  assert.equal(memory.forgetNote(note.id), false);
  assert.equal(memory.snapshot().notes.length, 0);
});

test("persists notes across instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-memory-"));
  const file = join(dir, "memory.json");
  try {
    new MemoryStore(file).writeNote("Deploys use the release branch", ["release"]);
    const reloaded = new MemoryStore(file);
    assert.equal(reloaded.snapshot().notes.length, 1);
    assert.match(reloaded.search("release")[0]!.text, /Deploys/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compact summarizes only un-compacted older messages", () => {
  const memory = new MemoryStore();
  const messages = Array.from({ length: 20 }, (_, i) =>
    message(`m${i}`, i % 2 === 0 ? "user" : "assistant", `line ${i}`),
  );
  memory.compact(messages, 12);
  const first = memory.snapshot().summary;
  assert.match(first, /line 0/);
  assert.match(first, /line 7/);
  assert.doesNotMatch(first, /line 8\b/);
  memory.compact(messages, 12);
  assert.equal(memory.snapshot().summary, first);
  messages.push(message("m20", "user", "line 20"), message("m21", "assistant", "line 21"));
  memory.compact(messages, 12);
  assert.match(memory.snapshot().summary, /line 8/);
  assert.match(memory.snapshot().summary, /line 9/);
});

test("syncAgents records the latest assistant summary and skips the orchestrator", () => {
  const memory = new MemoryStore();
  memory.syncAgents([
    thread({ kind: "orchestrator", id: "th_orchestrator", title: "Orchestrator" }),
    thread({ id: "th_agent", messages: [message("m1", "assistant", "Implemented the parser")] }),
  ]);
  const agents = memory.snapshot().agents;
  assert.equal(agents.length, 1);
  assert.equal(agents[0]!.id, "th_agent");
  assert.match(agents[0]!.summary, /Implemented/);
});

test("render includes notes, agents, summary and recent conversation", () => {
  const memory = new MemoryStore();
  memory.writeNote("Use the T3 palette", ["ui"]);
  const orchestrator = thread({
    kind: "orchestrator",
    id: "th_orchestrator",
    title: "Orchestrator",
    messages: [
      message("u1", "user", "older request"),
      message("a1", "assistant", "older answer"),
      message("u2", "user", "current request"),
    ],
  });
  const text = memory.render(orchestrator, [
    orchestrator,
    thread({ id: "th_agent", title: "Parser work" }),
  ]);
  assert.match(text, /### Notes/);
  assert.match(text, /T3 palette/);
  assert.match(text, /### Agents/);
  assert.match(text, /Parser work/);
  assert.match(text, /### Recent conversation/);
  assert.match(text, /older request/);
  assert.doesNotMatch(text, /current request/);
});

test("render caps notes, agents and total size", () => {
  const memory = new MemoryStore();
  for (let i = 0; i < 50; i++) memory.writeNote(`note ${i} ${"x".repeat(400)}`, ["tag"]);
  const orchestrator = thread({
    kind: "orchestrator",
    id: "th_orchestrator",
    title: "Orchestrator",
    messages: [message("u1", "user", "current request")],
  });
  const agents = Array.from({ length: 30 }, (_, i) =>
    thread({
      id: `th_${i}`,
      title: `agent ${i} ${"y".repeat(200)}`,
      updatedAt: i,
      status: "running",
      messages: [message(`m${i}`, "assistant", "z".repeat(500))],
    }),
  );
  const text = memory.render(orchestrator, [orchestrator, ...agents]);
  assert.ok(text.length <= 6000, `render was ${text.length} chars`);
  assert.match(text, /memory trimmed/);
});
