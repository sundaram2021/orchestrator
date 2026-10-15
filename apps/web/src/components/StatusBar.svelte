<script lang="ts">
  import { session, runningCount } from "../lib/session.svelte";

  const opencode = $derived(session.config?.harnesses.find((h) => h.id === "opencode"));
  const antigravity = $derived(session.config?.harnesses.find((h) => h.id === "antigravity"));
  const mcpCount = $derived(session.config?.mcp.filter((m) => m.enabled).length ?? 0);
  const skillCount = $derived(session.config?.skills.filter((s) => s.enabled).length ?? 0);
  const running = $derived(runningCount());
  const model = $derived(session.config?.model);
  const git = $derived(session.git);
</script>

<div class="status">
  <span class={opencode?.status === "connected" ? "ok" : "err"}>
    ● OpenCode {opencode?.status === "connected" ? "connected" : (opencode?.status ?? "unknown")}
  </span>
  <span class="ok">{mcpCount} MCP{mcpCount === 1 ? "" : "s"}</span>
  <span>{skillCount} skills</span>
  {#if git?.available}
    <span class="branch">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M8 6h6a4 4 0 0 1 4 4v0" /></svg>
      {git.branch || "detached"} · {git.staged}↑ {git.unstaged}↓
    </span>
  {/if}
  <span
    class="warn clickable"
    role="button"
    tabindex="0"
    title="Launch Antigravity IDE"
    onclick={() => void session.launchAntigravity()}
    onkeydown={(e) => e.key === "Enter" && void session.launchAntigravity()}
  >
    ● Antigravity: {antigravity?.status ?? "model source only"}
  </span>
  <div class="spacer"></div>
  <span>{session.mode === "agent" ? "Agent mode" : "IDE mode"}</span>
  <span>{model ? `model: ${model.id}` : ""}</span>
  <span>{running} agent{running === 1 ? "" : "s"} running</span>
  <span>UTF-8 · {session.activeFile?.split(".").pop() ?? "TS"}</span>
</div>
