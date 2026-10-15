import { runCapture } from "../util/process.js";

export interface PullRequestOptions {
  title: string;
  body?: string;
  base?: string;
}

export async function createPullRequest(
  cwd: string,
  options: PullRequestOptions,
): Promise<{ ok: boolean; output: string }> {
  const args = ["pr", "create", "--title", options.title, "--body", options.body ?? ""];
  if (options.base) args.push("--base", options.base);
  const res = await runCapture("gh", args, { cwd, timeoutMs: 60_000 });
  if (res.failed && /ENOENT|not recognized|not found/i.test(res.stderr)) {
    return { ok: false, output: "GitHub CLI (gh) not found. Install it to open pull requests." };
  }
  return { ok: !res.failed, output: `${res.stdout}${res.stderr}`.trim() };
}
