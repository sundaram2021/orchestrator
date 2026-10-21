import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SettingsStore } from "./SettingsStore.js";

test("falls back to provided defaults when no overrides exist", () => {
  const store = new SettingsStore();
  assert.equal(store.harnessEnabled("opencode", true), true);
  assert.equal(store.mcpEnabled("resend", true), true);
  assert.equal(store.mcpRouted("resend", false), false);
  assert.equal(store.skillEnabled("factory-fleet", true), true);
  assert.equal(store.model, undefined);
  assert.equal(store.autoUpdate, true);
  assert.equal(store.includeMajor, true);
});

test("persists overrides and the selected model across instances", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "orch-settings-")), "config.json");

  const first = new SettingsStore(file);
  first.setHarness("antigravity", false);
  first.setMcp("engram", true);
  first.setMcpRoute("resend", true);
  first.setSkill("factory-fleet", false);
  first.setModel({ harness: "opencode", id: "opencode/x", name: "X" });

  const second = new SettingsStore(file);
  assert.equal(second.harnessEnabled("antigravity", true), false);
  assert.equal(second.harnessEnabled("opencode", true), true);
  assert.equal(second.mcpEnabled("engram", false), true);
  assert.equal(second.mcpRouted("resend", false), true);
  assert.equal(second.mcpRouted("other", false), false);
  assert.equal(second.skillEnabled("factory-fleet", true), false);
  assert.deepEqual(second.model, { harness: "opencode", id: "opencode/x", name: "X" });
});

test("update settings default on and persist across instances", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "orch-settings-")), "config.json");

  const first = new SettingsStore(file);
  assert.equal(first.autoUpdate, true);
  assert.equal(first.includeMajor, true);
  first.setAutoUpdate(false);
  first.setIncludeMajor(false);

  const second = new SettingsStore(file);
  assert.equal(second.autoUpdate, false);
  assert.equal(second.includeMajor, false);
});
