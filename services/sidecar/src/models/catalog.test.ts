import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpenCodeModels, buildHarnessModels } from "./catalog.js";

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

test("splits opencode and antigravity models and expands variants", () => {
  const catalog = parseOpenCodeModels(
    ["opencode/a", "google/antigravity-gemini-3-pro"].join("\n"),
  );
  const { opencode, antigravity } = buildHarnessModels(catalog, {
    provider: {
      google: {
        models: {
          "antigravity-gemini-3-pro": {
            name: "Gemini 3 Pro",
            variants: { low: {}, high: {} },
          },
        },
      },
    },
  });
  assert.deepEqual(opencode.map((m) => m.id), ["opencode/a"]);
  assert.deepEqual(antigravity.map((m) => m.id), [
    "google/antigravity-gemini-3-pro#low",
    "google/antigravity-gemini-3-pro#high",
  ]);
  assert.equal(antigravity[0]?.name, "Gemini 3 Pro (low)");
});
