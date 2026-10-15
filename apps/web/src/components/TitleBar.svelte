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

  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const control = async (action: "minimize" | "maximize" | "close"): Promise<void> => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (action === "minimize") await win.minimize();
    else if (action === "maximize") await win.toggleMaximize();
    else await win.close();
  };
</script>

<div class="titlebar" data-tauri-drag-region>
  <div class="tl">
    <button class="dot" title="Close" aria-label="Close window" onclick={() => void control("close")}></button>
    <button class="dot" title="Minimize" aria-label="Minimize window" onclick={() => void control("minimize")}></button>
    <button class="dot" title="Maximize" aria-label="Maximize window" onclick={() => void control("maximize")}></button>
  </div>
  <strong style="margin-left:6px" data-tauri-drag-region>orchestrator</strong>
  <span style="color:var(--muted)" data-tauri-drag-region>— {session.config?.workspace ?? "no workspace"}</span>
  <button class="pill" title="Open a folder as workspace" onclick={() => void session.openWorkspace()}>Open folder</button>
  <div class="spacer" data-tauri-drag-region></div>
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

<style>
  .dot {
    border: none;
    padding: 0;
    cursor: pointer;
  }
</style>
