import { test } from "node:test";
import assert from "node:assert/strict";
import { AdapterManager } from "./AdapterManager.js";
import type { HarnessAdapter } from "./HarnessAdapter.js";

const base = (id: string): HarnessAdapter => ({
  id,
  name: id,
  color: "#000",
  status: "connected",
  canExecute: true,
  detect: async () => true,
  start: async () => undefined,
  stop: async () => undefined,
  models: async () => [],
  startSession: async (cwd) => ({ id: `ses_${id}`, cwd }),
  sendTurn: () => (async function* () {})(),
  interrupt: async () => undefined,
});

test("releaseWorkspace calls disposeWorkspace on capable adapters only", async () => {
  const seen: string[] = [];
  const withCap: HarnessAdapter = { ...base("a"), disposeWorkspace: async (dir) => void seen.push(`${dir}:a`) };
  const without: HarnessAdapter = base("b");
  const manager = new AdapterManager();
  manager.register(withCap);
  manager.register(without);
  await manager.releaseWorkspace("/wt/1");
  assert.deepEqual(seen, ["/wt/1:a"]);
});

test("releaseWorkspace swallows adapter errors", async () => {
  const manager = new AdapterManager();
  manager.register({
    ...base("a"),
    disposeWorkspace: async () => {
      throw new Error("boom");
    },
  });
  await assert.doesNotReject(() => manager.releaseWorkspace("/wt/1"));
});

test("executorFor prefers a connected adapter and falls back", () => {
  const manager = new AdapterManager();
  const primary = base("opencode");
  const fallback = { ...base("fallback"), status: "error" as const };
  manager.register(fallback, { fallback: true });
  manager.register(primary);
  assert.equal(manager.executorFor("opencode")?.id, "opencode");
  assert.equal(manager.executorFor("missing")?.id, "fallback");
});
