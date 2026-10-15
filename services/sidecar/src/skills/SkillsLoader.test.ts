import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkillFile } from "./SkillsLoader.js";

test("parses yaml frontmatter with quoted values", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "skills-"));
  const file = path.join(dir, "SKILL.md");
  writeFileSync(file, `---\nname: demo\ndescription: "When to use demo"\n---\n# Body\ncontent\n`);
  const { meta, body } = parseSkillFile(file);
  assert.equal(meta.name, "demo");
  assert.equal(meta.description, "When to use demo");
  assert.match(body, /# Body/);
  rmSync(dir, { recursive: true, force: true });
});

test("falls back to the whole body when there is no frontmatter", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "skills-"));
  const file = path.join(dir, "s.md");
  writeFileSync(file, "# No frontmatter\n");
  const { meta, body } = parseSkillFile(file);
  assert.deepEqual(meta, {});
  assert.match(body, /No frontmatter/);
  rmSync(dir, { recursive: true, force: true });
});
