import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Checkpoint } from "@orchestrator/contracts";
import { runCapture } from "../util/process.js";
import { createPullRequest, type PullRequestOptions } from "./gh.js";
import { worktreesDir } from "../config/paths.js";

export interface WorktreeHandle {
  dir: string;
  branch: string;
}

export class WorktreeService {
  constructor(
    private readonly workspace: string,
    private readonly root = worktreesDir,
  ) {}

  private dir(threadId: string): string {
    return path.join(this.root, threadId.replace(/[^A-Za-z0-9_-]/g, ""));
  }

  handle(threadId: string): WorktreeHandle {
    const short = threadId.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "agent";
    return { dir: this.dir(threadId), branch: `orch/${short}` };
  }

  list(): string[] {
    try {
      return readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("th_"))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  async create(threadId: string): Promise<WorktreeHandle | null> {
    const inside = await runCapture("git", ["rev-parse", "--is-inside-work-tree"], { cwd: this.workspace });
    if (inside.failed || inside.stdout.trim() !== "true") return null;
    const head = await runCapture("git", ["rev-parse", "--verify", "HEAD"], { cwd: this.workspace });
    if (head.failed) return null;

    const { branch, dir } = this.handle(threadId);
    try {
      mkdirSync(this.root, { recursive: true });
    } catch {
      /* directory may already exist */
    }
    const res = await runCapture("git", ["worktree", "add", "-b", branch, dir, "HEAD"], {
      cwd: this.workspace,
      timeoutMs: 30_000,
    });
    return res.failed ? null : { dir, branch };
  }

  async remove(handle: WorktreeHandle): Promise<void> {
    const res = await runCapture("git", ["worktree", "remove", "--force", handle.dir], {
      cwd: this.workspace,
    });
    if (res.failed) {
      try {
        rmSync(handle.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        /* best effort */
      }
    }
    await runCapture("git", ["branch", "-D", handle.branch], { cwd: this.workspace });
  }

  async sweep(activeThreadIds: Iterable<string>): Promise<string[]> {
    const alive = new Set([...activeThreadIds].map((id) => id.replace(/[^A-Za-z0-9_-]/g, "")));
    const removed: string[] = [];
    for (const name of this.list()) {
      if (alive.has(name)) continue;
      await this.remove(this.handle(name));
      removed.push(name);
    }
    await this.prune();
    return removed;
  }

  async prune(): Promise<void> {
    await runCapture("git", ["worktree", "prune"], { cwd: this.workspace });
  }

  async merge(branch: string): Promise<{ ok: boolean; output: string }> {
    const res = await runCapture("git", ["merge", "--no-edit", branch], {
      cwd: this.workspace,
      timeoutMs: 60_000,
    });
    return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
  }

  async log(dir: string, limit = 50): Promise<Checkpoint[]> {
    const res = await runCapture("git", ["log", "-n", String(limit), "--format=%h%x1f%s%x1f%ct"], {
      cwd: dir,
    });
    if (res.failed) return [];
    return res.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha = "", label = "", ts = "0"] = line.split("\x1f");
        return { sha, label, ts: Number(ts) * 1000 };
      });
  }

  async checkpoint(dir: string, message: string): Promise<{ ok: boolean; sha: string; output: string }> {
    const add = await runCapture("git", ["add", "-A"], { cwd: dir });
    if (add.failed) return { ok: false, sha: "", output: add.stderr.trim() };
    const commit = await runCapture("git", ["commit", "-m", message, "--allow-empty"], { cwd: dir });
    if (commit.failed) return { ok: false, sha: "", output: `${commit.stdout}${commit.stderr}`.trim() };
    const sha = await runCapture("git", ["rev-parse", "--short", "HEAD"], { cwd: dir });
    return { ok: true, sha: sha.stdout.trim(), output: commit.stdout.trim() };
  }

  async restore(dir: string, sha: string): Promise<{ ok: boolean; output: string }> {
    const reset = await runCapture("git", ["reset", "--hard", sha], { cwd: dir });
    if (reset.failed) return { ok: false, output: `${reset.stdout}${reset.stderr}`.trim() };
    await runCapture("git", ["clean", "-fd"], { cwd: dir });
    return { ok: true, output: reset.stdout.trim() };
  }

  async push(dir: string, branch: string): Promise<{ ok: boolean; output: string }> {
    const res = await runCapture("git", ["push", "-u", "origin", branch], { cwd: dir, timeoutMs: 60_000 });
    return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
  }

  async createPullRequest(
    dir: string,
    options: PullRequestOptions,
  ): Promise<{ ok: boolean; output: string }> {
    return createPullRequest(dir, options);
  }
}
