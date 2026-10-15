import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorktreeService } from "./WorktreeService.js";

const run = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const makeWritable = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name);
    if (lstatSync(entry).isDirectory()) makeWritable(entry);
    else chmodSync(entry, 0o666);
  }
};

const cleanup = (dir: string): void => {
  try {
    makeWritable(dir);
  } catch {
    /* best effort */
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* best effort */
  }
};

const makeRepo = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orch-wt-"));
  run(dir, ["-c", "init.defaultBranch=main", "init"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  run(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(path.join(dir, "a.txt"), "one\n");
  run(dir, ["add", "a.txt"]);
  run(dir, ["commit", "-m", "init"]);
  return dir;
};

test("checkpoint commits the worktree and log lists it", async () => {
  const dir = makeRepo();
  try {
    const wt = new WorktreeService(dir);
    writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
    const cp = await wt.checkpoint(dir, "before detour");
    assert.equal(cp.ok, true);
    assert.ok(cp.sha.length > 0);

    const list = await wt.log(dir);
    assert.equal(list[0]?.sha, cp.sha);
    assert.equal(list[0]?.label, "before detour");
    assert.equal(list.length, 2);
  } finally {
    cleanup(dir);
  }
});

test("restore resets tracked files and drops untracked ones", async () => {
  const dir = makeRepo();
  try {
    const wt = new WorktreeService(dir);
    writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
    const cp = await wt.checkpoint(dir, "checkpoint");
    assert.equal(cp.ok, true);

    writeFileSync(path.join(dir, "a.txt"), "changed\n");
    writeFileSync(path.join(dir, "untracked.txt"), "new\n");
    const res = await wt.restore(dir, cp.sha);
    assert.equal(res.ok, true);
    assert.equal(readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\n");
    assert.equal(existsSync(path.join(dir, "untracked.txt")), false);
  } finally {
    cleanup(dir);
  }
});
