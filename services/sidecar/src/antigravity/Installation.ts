import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { runtimeDir } from "../config/paths.js";
import { runCapture } from "../util/process.js";
import { logger } from "../util/logger.js";
import { resolveAntigravityReleaseAsset, type AntigravityReleaseAsset } from "./release.js";

const log = logger("antigravity:install");

export interface AntigravityRuntime {
  executablePath: string;
  harnessPath: string;
  version: string | null;
  source: "managed" | "override";
}

export interface InstallProgress {
  phase: "downloading" | "extracting" | "verifying" | "done" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  detail?: string;
}

export interface InstallState {
  installed: boolean;
  version: string | null;
  executablePath: string | null;
  managedRoot: string;
  release: { version: string; archiveBytes: number } | null;
}

const RELEASE_RECORD = "active.json";

export function antigravityPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export function antigravityManagedRoot(): string {
  return path.join(runtimeDir, "tools", "antigravity-acp", antigravityPlatformKey());
}

function versionsDir(): string {
  return path.join(antigravityManagedRoot(), "versions");
}

function activeRecordPath(): string {
  return path.join(antigravityManagedRoot(), RELEASE_RECORD);
}

function releaseDir(asset: AntigravityReleaseAsset): string {
  return path.join(versionsDir(), asset.sha256);
}

function executableNames(platform: NodeJS.Platform): { executable: string; harness: string } {
  return platform === "win32"
    ? { executable: "agy_acp_server.exe", harness: "localharness_external.exe" }
    : { executable: "agy_acp_server.par", harness: "localharness_external" };
}

export function resolveRuntime(binaryPath?: string): AntigravityRuntime | null {
  if (binaryPath && binaryPath.trim()) {
    const executablePath = binaryPath.trim();
    if (!existsSync(executablePath)) return null;
    const harness = path.join(path.dirname(executablePath), executableNames(process.platform).harness);
    return {
      executablePath,
      harnessPath: harness,
      version: null,
      source: "override",
    };
  }
  const asset = resolveAntigravityReleaseAsset();
  if (!asset) return null;
  const dir = releaseDir(asset);
  const names = executableNames(process.platform);
  const executablePath = path.join(dir, names.executable);
  const harnessPath = path.join(dir, names.harness);
  if (!existsSync(executablePath) || !existsSync(harnessPath)) return null;
  return { executablePath, harnessPath, version: asset.version, source: "managed" };
}

export function installState(): InstallState {
  const asset = resolveAntigravityReleaseAsset();
  const runtime = resolveRuntime();
  return {
    installed: runtime !== null && runtime.source === "managed",
    version: runtime?.version ?? null,
    executablePath: runtime?.executablePath ?? null,
    managedRoot: antigravityManagedRoot(),
    release: asset ? { version: asset.version, archiveBytes: asset.archiveBytes } : null,
  };
}

async function downloadArchive(
  asset: AntigravityReleaseAsset,
  destination: string,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const res = await fetch(asset.url);
  if (!res.ok || !res.body) {
    throw new Error(`Antigravity runtime download failed (HTTP ${res.status}).`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const hash = createHash("sha256");
  let downloaded = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    downloaded += chunk.length;
    onProgress({
      phase: "downloading",
      downloadedBytes: downloaded,
      totalBytes: asset.archiveBytes,
    });
  });
  await pipeline(body, createWriteStream(destination));
  onProgress({ phase: "verifying", downloadedBytes: downloaded, totalBytes: asset.archiveBytes });
  const digest = hash.digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(
      `Antigravity runtime failed checksum verification (expected ${asset.sha256}, got ${digest}).`,
    );
  }
}

async function extractArchive(
  archivePath: string,
  destination: string,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  onProgress({ phase: "extracting", downloadedBytes: 0, totalBytes: null });
  const result =
    process.platform === "win32"
      ? await runCapture(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
          ],
          { timeoutMs: 600_000 },
        )
      : await runCapture("unzip", ["-o", "-q", archivePath, "-d", destination], {
          timeoutMs: 600_000,
        });
  if (result.failed) {
    throw new Error(`Antigravity runtime extraction failed: ${result.stderr.trim() || result.code}`);
  }
}

export async function installRuntime(
  onProgress: (p: InstallProgress) => void = () => undefined,
): Promise<InstallState> {
  const asset = resolveAntigravityReleaseAsset();
  if (!asset) {
    throw new Error(`No Antigravity runtime release for ${antigravityPlatformKey()}.`);
  }
  const destination = releaseDir(asset);
  const names = executableNames(process.platform);
  if (existsSync(path.join(destination, names.executable))) {
    log.info(`antigravity runtime already installed (${asset.version})`);
    return installState();
  }
  const archivePath = path.join(antigravityManagedRoot(), `agy-acp-server-${asset.version}.zip`);
  try {
    await downloadArchive(asset, archivePath, onProgress);
    await extractArchive(archivePath, destination, onProgress);
    if (!existsSync(path.join(destination, names.executable))) {
      throw new Error(`Antigravity runtime archive did not contain ${names.executable}.`);
    }
    mkdirSync(antigravityManagedRoot(), { recursive: true });
    const record = {
      version: asset.version,
      sha256: asset.sha256,
      executable: names.executable,
      installedAt: Date.now(),
    };
    const fs = await import("node:fs");
    fs.writeFileSync(activeRecordPath(), `${JSON.stringify(record)}\n`);
    onProgress({ phase: "done", downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes });
    log.info(`antigravity runtime installed (${asset.version})`);
    return installState();
  } catch (err) {
    onProgress({
      phase: "error",
      downloadedBytes: 0,
      totalBytes: asset.archiveBytes,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    rmSync(archivePath, { force: true });
  }
}

export function removeRuntime(): void {
  const root = antigravityManagedRoot();
  if (!existsSync(root)) return;
  rmSync(path.join(root, "versions"), { recursive: true, force: true });
  rmSync(activeRecordPath(), { force: true });
  log.info("antigravity runtime removed");
}

export function installedRecord(): { version: string; sha256: string } | null {
  try {
    const raw = readFileSync(activeRecordPath(), "utf8");
    const parsed = JSON.parse(raw) as { version?: string; sha256?: string };
    if (typeof parsed.version === "string" && typeof parsed.sha256 === "string") {
      return { version: parsed.version, sha256: parsed.sha256 };
    }
  } catch {
    /* no record */
  }
  return null;
}

export function runtimeDiskUsage(): number {
  const asset = resolveAntigravityReleaseAsset();
  if (!asset) return 0;
  const dir = releaseDir(asset);
  if (!existsSync(dir)) return 0;
  try {
    return statSync(dir).size;
  } catch {
    return 0;
  }
}
