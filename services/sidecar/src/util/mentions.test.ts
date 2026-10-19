import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentMentions, slugify, stripAgentMentions } from "./mentions.js";

test("slugify lowercases and dashes non-alphanumerics", () => {
  assert.equal(slugify("Fix Login Bug"), "fix-login-bug");
  assert.equal(slugify("  Refactor: the parser!  "), "refactor-the-parser");
});

test("slugify falls back for empty or symbol-only titles", () => {
  assert.equal(slugify("…"), "agent");
  assert.equal(slugify(""), "agent");
});

test("slugify caps length at 40 characters", () => {
  assert.equal(slugify("a".repeat(80)).length, 40);
});

test("parseAgentMentions extracts unique lowercased slugs", () => {
  assert.deepEqual(parseAgentMentions("$Builder please add tests, cc $builder"), ["builder"]);
  assert.deepEqual(parseAgentMentions("ask $fix-login-bug and $docs"), ["fix-login-bug", "docs"]);
  assert.deepEqual(parseAgentMentions("no mentions here"), []);
});

test("stripAgentMentions removes tokens and collapses whitespace", () => {
  assert.equal(stripAgentMentions("$builder please add tests"), "please add tests");
  assert.equal(stripAgentMentions("$a $b do the thing"), "do the thing");
  assert.equal(stripAgentMentions("$builder"), "");
});
