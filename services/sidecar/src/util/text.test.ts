import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanToolText, firstLine, normalizeText, stripAnsi } from "./text.js";

test("stripAnsi removes color codes and OSC hyperlinks", () => {
  assert.equal(stripAnsi("\u001b[31merror\u001b[0m"), "error");
  assert.equal(stripAnsi("a\u001b]8;;https://x.test\u0007link\u001b]8;;\u0007b"), "alinkb");
});

test("normalizeText converts CRLF and strips ANSI", () => {
  assert.equal(normalizeText("a\r\nb\rc"), "a\nb\nc");
  assert.equal(normalizeText("\u001b[32mok\u001b[0m"), "ok");
});

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine("\n  hello world  \nsecond"), "hello world");
  assert.equal(firstLine("x".repeat(200), 20).length, 20);
  assert.ok(firstLine("x".repeat(200), 20).endsWith("…"));
  assert.equal(firstLine("   "), "");
});

test("cleanToolText trims trailing whitespace and collapses blank runs", () => {
  assert.deepEqual(cleanToolText("a\n\n\n\nb\n\n"), { text: "a\n\nb", truncated: false });
  assert.deepEqual(cleanToolText("   "), { text: "", truncated: false });
});

test("cleanToolText omits binary output", () => {
  assert.deepEqual(cleanToolText("head\u0000tail"), {
    text: "Binary output omitted.",
    truncated: false,
  });
});

test("cleanToolText truncates past the limit with an explicit marker", () => {
  const result = cleanToolText("x".repeat(100), 10);
  assert.equal(result.truncated, true);
  assert.ok(result.text.startsWith("x".repeat(10)));
  assert.match(result.text, /output truncated \(100 chars\)/);
});
