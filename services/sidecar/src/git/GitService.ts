import type { GitBranches, GitFile, GitStatus } from "@orchestrator/contracts";
import { runCapture } from "../util/process.js";
import { createPullRequest } from "./gh.js";

export type { GitStatus };

export class GitService {
  constructor(private readonly cwd: string) {}

  async branch(): Promise<string> {
    const symbolic = await runCapture("git", ["symbolic-ref", "--short", "HEAD"], { cwd: this.cwd });
    if (!symbolic.failed && symbolic.stdout.trim()) return symbolic.stdout.trim();
    const res = await runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: this.cwd });
    return res.failed ? "" : res.stdout.trim();
  }

  async status(): Promise<GitStatus> {
    const porcelain = await runCapture("git", ["status", "--porcelain"], { cwd: this.cwd });
    if (porcelain.failed) {
      return { available: false, branch: "", changed: 0, staged: 0, unstaged: 0, files: [] };
    }
    const lines = porcelain.stdout.split(/\r?\n/).filter(Boolean);
    let staged = 0;
    let unstaged = 0;
    const files: GitFile[] = [];
    for (const line of lines) {
      const x = line[0] ?? " ";
      const y = line[1] ?? " ";
      let p = line.slice(3).trim();
      if (p.includes(" -> ")) p = p.split(" -> ").pop()?.trim() ?? p;
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (x !== " " && x !== "?") staged++;
      if (y !== " ") unstaged++;
      files.push({ path: p, index: x, worktree: y });
    }
    return {
      available: true,
      branch: await this.branch(),
      changed: lines.length,
      staged,
      unstaged,
      files,
    };
  }

  async branches(): Promise<GitBranches> {
    const res = await runCapture("git", ["branch", "--format=%(refname:short)"], { cwd: this.cwd });
    const local = res.failed
      ? []
      : res.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
    return { current: await this.branch(), local };
  }

  async checkout(branch: string, force = false): Promise<{ ok: boolean; output: string }> {
    const args = ["checkout"];
    if (force) args.push("--force");
    args.push(branch);
    const res = await runCapture("git", args, { cwd: this.cwd, timeoutMs: 30_000 });
    return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
  }

  async createPullRequest(options: {
    title: string;
    body?: string;
    base?: string;
  }): Promise<{ ok: boolean; output: string }> {
    return createPullRequest(this.cwd, options);
  }

  async diff(options: { path?: string; staged?: boolean } = {}): Promise<string> {
    const args = ["diff", "--no-color"];
    if (options.staged) args.push("--cached");
    if (options.path) args.push("--", options.path);
    const res = await runCapture("git", args, { cwd: this.cwd });
    return res.stdout;
  }

  async stage(relative?: string): Promise<void> {
    const args = relative ? ["add", "--", relative] : ["add", "-A"];
    await runCapture("git", args, { cwd: this.cwd });
  }

  async commit(message: string): Promise<{ ok: boolean; output: string }> {
    const res = await runCapture("git", ["commit", "-m", message], { cwd: this.cwd });
    return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
  }

  async push(): Promise<{ ok: boolean; output: string }> {
    const res = await runCapture("git", ["push"], { cwd: this.cwd });
    return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
  }
}
