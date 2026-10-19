import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitService } from "./GitService.js";

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
  const dir = mkdtempSync(path.join(os.tmpdir(), "orch-git-"));
  run(dir, ["-c", "init.defaultBranch=main", "init"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  run(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(path.join(dir, "a.txt"), "one\n");
  run(dir, ["add", "a.txt"]);
  run(dir, ["commit", "-m", "init"]);
  return dir;
};

test("git status lists changed files with staged/unstaged flags", async () => {
  const dir = makeRepo();
  try {
    const git = new GitService(dir);
    let status = await git.status();
    assert.equal(status.available, true);
    assert.equal(status.branch, "main");
    assert.equal(status.changed, 0);
    assert.deepEqual(status.files, []);

    writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
    writeFileSync(path.join(dir, "b.txt"), "new\n");
    status = await git.status();
    assert.equal(status.changed, 2);
    assert.equal(status.staged, 0);
    assert.equal(status.unstaged, 2);
    const a = status.files.find((f) => f.path === "a.txt");
    const b = status.files.find((f) => f.path === "b.txt");
    assert.equal(a?.worktree, "M");
    assert.equal(b?.index, "?");

    await git.stage("a.txt");
    status = await git.status();
    assert.equal(status.staged, 1);
    assert.equal(status.unstaged, 1);
    assert.equal(status.files.find((f) => f.path === "a.txt")?.index, "M");
  } finally {
    cleanup(dir);
  }
});

test("git diff renders untracked files as an all-additions new-file diff", async () => {
  const dir = makeRepo();
  try {
    const git = new GitService(dir);
    writeFileSync(path.join(dir, "b.txt"), "new\nfile\n");
    const diff = await git.diff({ path: "b.txt" });
    assert.ok(diff.includes("new file mode 100644"));
    assert.ok(diff.includes("--- /dev/null"));
    assert.ok(diff.includes("@@ -0,0 +1,2 @@"));
    assert.ok(diff.includes("+new"));
    assert.ok(diff.includes("+file"));

    writeFileSync(path.join(dir, "a.txt"), "ONE\n");
    const tracked = await git.diff({ path: "a.txt" });
    assert.ok(tracked.includes("+ONE"));
    assert.ok(tracked.includes("-one"));
    assert.ok(!tracked.includes("new file mode"));
  } finally {
    cleanup(dir);
  }
});

test("git status reports paths relative to the workspace subdirectory", async () => {
  const dir = makeRepo();
  try {
    const sub = path.join(dir, "pkg");
    mkdirSync(sub);
    writeFileSync(path.join(dir, "a.txt"), "changed\n");
    writeFileSync(path.join(sub, "c.txt"), "new\n");
    const git = new GitService(sub);
    const status = await git.status();
    assert.deepEqual(
      status.files.map((f) => f.path),
      ["c.txt"],
    );
    const diff = await git.diff({ path: "c.txt" });
    assert.ok(diff.includes("new file mode 100644"));
    assert.ok(diff.includes("+++ b/c.txt"));
  } finally {
    cleanup(dir);
  }
});

test("git branches and checkout switch the working tree", async () => {
  const dir = makeRepo();
  try {
    run(dir, ["branch", "feature"]);
    const git = new GitService(dir);
    const branches = await git.branches();
    assert.equal(branches.current, "main");
    assert.ok(branches.local.includes("main"));
    assert.ok(branches.local.includes("feature"));

    const res = await git.checkout("feature");
    assert.equal(res.ok, true);
    assert.equal(await git.branch(), "feature");
  } finally {
    cleanup(dir);
  }
});
