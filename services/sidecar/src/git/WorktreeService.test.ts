import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("remove deletes the worktree directory and its branch", async () => {
  const repo = makeRepo();
  const root = mkdtempSync(path.join(os.tmpdir(), "orch-wt-root-"));
  try {
    const wt = new WorktreeService(repo, root);
    const handle = await wt.create("th_keep-0001");
    assert.ok(handle);
    assert.equal(existsSync(handle.dir), true);
    assert.deepEqual(wt.list(), ["th_keep-0001"]);

    await wt.remove(handle);
    assert.equal(existsSync(handle.dir), false);
    assert.equal(run(repo, ["branch", "--list", "orch/*"]).trim(), "");
  } finally {
    cleanup(root);
    cleanup(repo);
  }
});

test("sweep removes orphan worktrees and unregistered directories", async () => {
  const repo = makeRepo();
  const root = mkdtempSync(path.join(os.tmpdir(), "orch-wt-root-"));
  try {
    const wt = new WorktreeService(repo, root);
    const keep = await wt.create("th_keep-0001");
    const drop = await wt.create("th_drop-0002");
    assert.ok(keep?.dir && drop?.dir);
    const stale = path.join(root, "th_stale-0003");
    mkdirSync(stale);

    const removed = await wt.sweep(["th_keep-0001"]);
    assert.deepEqual(removed.sort(), ["th_drop-0002", "th_stale-0003"]);
    assert.equal(existsSync(keep.dir), true);
    assert.equal(existsSync(drop.dir), false);
    assert.equal(existsSync(stale), false);
    assert.deepEqual(wt.list(), ["th_keep-0001"]);

    await wt.remove(keep);
  } finally {
    cleanup(root);
    cleanup(repo);
  }
});
