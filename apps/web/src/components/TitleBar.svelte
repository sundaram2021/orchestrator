<script lang="ts">
  import { session, harnessOf } from "../lib/session.svelte";

  const connLabel = $derived(
    session.connection === "open"
      ? "connected"
      : session.connection === "connecting"
        ? "connecting"
        : "offline",
  );
  const model = $derived(session.config?.model);
  const dotColor = $derived(harnessOf(model?.harness ?? "")?.color ?? "var(--muted)");
  const mcpCount = $derived(session.config?.mcp.filter((m) => m.enabled).length ?? 0);
</script>

<div class="titlebar">
  <div class="tl">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
  <strong style="margin-left:6px">orchestrator</strong>
  <span style="color:var(--muted)">— {session.config?.workspace ?? "no workspace"}</span>
  <div class="spacer"></div>
  {#if model}
    <span class="pill" title="Active model">
      <span class="hdot" style="background:{dotColor}"></span>
      {model.name}
    </span>
  {/if}
  <span class="pill" title="Enabled MCP servers">{mcpCount} MCP</span>
  <span class="conn {session.connection}">
    <span class="pulse"></span>{connLabel}
  </span>
  <div class="seg">
    <button class:active={session.mode === "agent"} onclick={() => session.setMode("agent")}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M9 13h.01M15 13h.01" /></svg>Agent
    </button>
    <button class:active={session.mode === "ide"} onclick={() => session.setMode("ide")}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" /></svg>IDE
    </button>
  </div>
</div>
