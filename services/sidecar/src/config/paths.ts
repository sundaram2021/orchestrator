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
export const openCodeAgentConfig = path.join(runtimeDir, "opencode.agents.json");
export const openCodeOrchestratorConfig = path.join(runtimeDir, "opencode.orchestrator.json");
export const openCodeBridgeConfigs = {
  agents: openCodeAgentConfig,
  orchestrator: openCodeOrchestratorConfig,
} as const;

export const eventsDir = path.join(runtimeDir, "events");

export const userConfigPath = path.join(runtimeDir, "config.json");

export const worktreesDir = path.join(runtimeDir, "worktrees");

export const memoryDir = path.join(runtimeDir, "memory");

const workspaceKey = (workspace: string): string =>
  createHash("sha1").update(workspace).digest("hex").slice(0, 16);

export function journalPath(workspace: string): string {
  return path.join(eventsDir, `${workspaceKey(workspace)}.jsonl`);
}

export function memoryPath(workspace: string): string {
  return path.join(memoryDir, `${workspaceKey(workspace)}.json`);
}
