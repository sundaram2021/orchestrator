import { mkdirSync } from "node:fs";
import path from "node:path";
import { runCapture } from "../util/process.js";
import { worktreesDir } from "../config/paths.js";

export interface WorktreeHandle {
  dir: string;
  branch: string;
}

export class WorktreeService {
  constructor(private readonly workspace: string) {}

  private dir(threadId: string): string {
    return path.join(worktreesDir, threadId.replace(/[^A-Za-z0-9_-]/g, ""));
  }

  async create(threadId: string): Promise<WorktreeHandle | null> {
    const inside = await runCapture("git", ["rev-parse", "--is-inside-work-tree"], { cwd: this.workspace });
    if (inside.failed || inside.stdout.trim() !== "true") return null;
    const head = await runCapture("git", ["rev-parse", "--verify", "HEAD"], { cwd: this.workspace });
    if (head.failed) return null;

    const short = threadId.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "agent";
    const branch = `orch/${short}`;
    const dir = this.dir(threadId);
    try {
      mkdirSync(worktreesDir, { recursive: true });
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
    await runCapture("git", ["worktree", "remove", "--force", handle.dir], { cwd: this.workspace });
    await runCapture("git", ["branch", "-D", handle.branch], { cwd: this.workspace });
  }

  async merge(branch: string): Promise<{ ok: boolean; output: string }> {
    const res = await runCapture("git", ["merge", "--no-edit", branch], {
      cwd: this.workspace,
      timeoutMs: 60_000,
    });
    return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
  }
}
