import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpenCodeModels, buildOpenCodeModels } from "./catalog.js";

test("parses provider/model lines and de-duplicates", () => {
  const stdout = [
    "opencode/deepseek-v4.1-flash-free",
    "opencode/big-pickle",
    "google/antigravity-gemini-3-pro",
    "opencode/deepseek-v4.1-flash-free",
    "",
    "not-a-model-line",
  ].join("\n");
  const models = parseOpenCodeModels(stdout);
  assert.deepEqual(
    models.map((m) => m.id),
    ["opencode/deepseek-v4.1-flash-free", "opencode/big-pickle", "google/antigravity-gemini-3-pro"],
  );
  assert.equal(models[0]?.provider, "opencode");
  assert.equal(models[0]?.short, "deepseek-v4.1-flash-free");
});

test("keeps only opencode-provider models for the OpenCode harness", () => {
  const catalog = parseOpenCodeModels(
    ["opencode/a", "google/antigravity-gemini-3-pro", "anthropic/claude-x"].join("\n"),
  );
  const models = buildOpenCodeModels(catalog);
  assert.deepEqual(models.map((m) => m.id), ["opencode/a"]);
  assert.equal(models[0]?.name, "a");
});
