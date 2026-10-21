import { test } from "node:test";
import assert from "node:assert/strict";
import { explainError, firstLine } from "./errorHints";

test("explains the tool-count limit", () => {
  const result = explainError("Upstream request failed: [invalid_value] Invalid value for 'tools': maximum number of items is 128.");
  assert.equal(result.title, "This model can't load that many tools");
  assert.match(result.hint, /MCP/);
});

test("explains authentication failures", () => {
  assert.equal(explainError("401 Unauthorized").title, "Authentication failed");
  assert.equal(explainError("MCP server needs authentication").title, "Authentication failed");
});

test("explains network failures", () => {
  assert.equal(explainError("TypeError: fetch failed").title, "Can't reach the service");
  assert.equal(explainError("connect ECONNREFUSED 127.0.0.1:4123").title, "Can't reach the service");
});

test("explains rate limits and context limits", () => {
  assert.equal(explainError("429 too many requests").title, "Rate limited");
  assert.equal(explainError("This model's maximum context length is 128000 tokens").title, "The conversation is too long");
});

test("falls back for unknown and empty errors", () => {
  assert.equal(explainError("something odd happened").title, "Something went wrong");
  assert.equal(explainError("   ").title, "Something went wrong");
});

test("firstLine strips ANSI, picks the first line and clips", () => {
  assert.equal(firstLine("\u001b[31mboom\u001b[0m\nstack"), "boom");
  assert.equal(firstLine("a\nb"), "a");
  assert.ok(firstLine("x".repeat(200), 20).endsWith("…"));
});
