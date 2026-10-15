import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

export const homeDir = os.homedir();

export const configPaths = {
  opencode: path.join(homeDir, ".config", "opencode", "opencode.json"),
  antigravityMcp: path.join(homeDir, ".gemini", "antigravity", "mcp_config.json"),
  antigravityIdeMcp: path.join(homeDir, ".gemini", "antigravity-ide", "mcp_config.json"),
};

export const skillDirs = [
  path.join(homeDir, ".agents", "skills"),
  path.join(homeDir, ".config", "opencode", "skills"),
  path.join(homeDir, ".claude", "skills"),
];

export const runtimeDir = path.join(homeDir, ".orchestrator");

export const openCodeBridgeConfig = path.join(runtimeDir, "opencode.merged.json");

export const eventsDir = path.join(runtimeDir, "events");

export function journalPath(workspace: string): string {
  const key = createHash("sha1").update(workspace).digest("hex").slice(0, 16);
  return path.join(eventsDir, `${key}.jsonl`);
}
