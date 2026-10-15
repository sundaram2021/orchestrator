<script lang="ts">
  import { session, runningCount } from "../lib/session.svelte";

  const opencode = $derived(session.config?.harnesses.find((h) => h.id === "opencode"));
  const mcpCount = $derived(session.config?.mcp.filter((m) => m.enabled).length ?? 0);
  const skillCount = $derived(session.config?.skills.filter((s) => s.enabled).length ?? 0);
  const running = $derived(runningCount());
  const git = $derived(session.git);
  const lang = $derived(session.activeFile?.split(".").pop()?.toUpperCase() ?? "—");
</script>

<footer class="status">
  <span class={opencode?.status === "connected" ? "ok" : "err"}>
    ● OpenCode {opencode?.status === "connected" ? "connected" : (opencode?.status ?? "unknown")}
  </span>
  <span>{mcpCount} MCP{mcpCount === 1 ? "" : "s"}</span>
  <span>{skillCount} skill{skillCount === 1 ? "" : "s"}</span>
  <span
    class="warn clickable"
    role="button"
    tabindex="0"
    title="Launch Antigravity IDE"
    onclick={() => void session.launchAntigravity()}
    onkeydown={(e) => e.key === "Enter" && void session.launchAntigravity()}
  >
    Antigravity
  </span>
  {#if git?.available}
    <span class="branch">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M8 6h6a4 4 0 0 1 4 4v0" /></svg>
      {git.branch || "detached"} · {git.files.length} changed
    </span>
  {/if}
  <div class="spacer"></div>
  <span>{session.view === "chat" ? "Chat" : "Code"}</span>
  <span class={running > 0 ? "ok" : ""}>{running} running</span>
  <span class="mono">{lang}</span>
</footer>
