import spawn from "cross-spawn";
import { spawnSync } from "node:child_process";
import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type StreamedChild = ChildProcessByStdio<null, Readable, Readable>;

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
  failed: boolean;
}

export function runCapture(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }) as StreamedChild;

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (code: number, failed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, failed });
    };

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        killTree(child);
        finish(-1, true);
      }, options.timeoutMs);
    }

    child.on("error", (err) => {
      stderr += String(err);
      finish(-1, true);
    });
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => finish(code ?? -1, code !== 0));
  });
}

export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || child.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export function spawnStream(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): StreamedChild {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }) as StreamedChild;
}

export function spawnDetached(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      windowsHide: false,
      stdio: "ignore",
    });
    const timer = setTimeout(() => reject(new Error(`timed out launching ${command}`)), 8000);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("spawn", () => {
      clearTimeout(timer);
      child.unref();
      resolve();
    });
  });
}
