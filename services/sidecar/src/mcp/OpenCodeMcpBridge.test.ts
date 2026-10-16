import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServerConfig } from "@orchestrator/contracts";
import { buildBridgeConfig } from "./OpenCodeMcpBridge.js";
import type { LoadedMcpServer } from "./mcpConfig.js";

const server = (
  name: string,
  enabled: boolean,
  transport: LoadedMcpServer["transport"],
  source = "test",
): LoadedMcpServer => ({
  config: {
    name,
    transport: transport?.kind === "stdio" ? "stdio" : transport?.kind === "http" ? "http" : "http",
    source,
    detail: "",
    tools: [],
    status: "disabled",
    enabled,
  } satisfies McpServerConfig,
  transport,
});

test("maps stdio servers to local OpenCode entries", () => {
  const bridge = buildBridgeConfig([
    server("localtools", true, { kind: "stdio", command: "localtools", args: ["mcp"], env: {} }),
  ]);
  assert.deepEqual(bridge.mcp.localtools, {
    type: "local",
    command: ["localtools", "mcp"],
    enabled: true,
  });
});

test("maps http servers to remote OpenCode entries with headers", () => {
  const bridge = buildBridgeConfig([
    server("resend", true, {
      kind: "http",
      url: "https://mcp.resend.com/mcp",
      headers: { Authorization: "Bearer x" },
    }),
  ]);
  assert.deepEqual(bridge.mcp.resend, {
    type: "remote",
    url: "https://mcp.resend.com/mcp",
    headers: { Authorization: "Bearer x" },
    enabled: true,
  });
});

test("keeps disabled servers marked disabled so global config cannot re-enable them", () => {
  const bridge = buildBridgeConfig([
    server("engram", false, { kind: "http", url: "https://www.engram-memory.com/mcp", headers: {} }),
  ]);
  assert.deepEqual(bridge.mcp.engram, { type: "remote", url: "https://www.engram-memory.com/mcp", enabled: false });
});

test("skips servers without a transport that are already disabled", () => {
  const bridge = buildBridgeConfig([server("broken", false, null)]);
  assert.deepEqual(bridge.mcp, {});
});

test("merges builtin servers and lets them win over discovered ones", () => {
  const bridge = buildBridgeConfig(
    [server("orchestrator", false, { kind: "http", url: "https://stale.example/mcp", headers: {} })],
    { orchestrator: { type: "remote", url: "http://127.0.0.1:4123/mcp", enabled: true } },
  );
  assert.deepEqual(bridge.mcp.orchestrator, {
    type: "remote",
    url: "http://127.0.0.1:4123/mcp",
    enabled: true,
  });
});
