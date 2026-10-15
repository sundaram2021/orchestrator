<script lang="ts">
  import { session } from "../lib/session.svelte";

  const connLabel = $derived(
    session.connection === "open"
      ? "Connected"
      : session.connection === "connecting"
        ? "Connecting"
        : "Offline",
  );
  const wsName = $derived(
    session.config?.workspace ? session.config.workspace.split(/[\\/]/).filter(Boolean).pop() ?? "" : "no workspace",
  );
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

<header class="titlebar" data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <span class="mark"></span>orchestrator
  </div>
  <div class="crumb" data-tauri-drag-region>
    <span class="path" title={session.config?.workspace ?? ""}>{wsName}</span>
    {#if session.git?.available && session.git.branch}
      <span class="branch" title="Current branch">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M8 6h6a4 4 0 0 1 4 4v0" /></svg>
        {session.git.branch}
      </span>
    {/if}
  </div>
  <button class="tb-btn" title="Open a folder as workspace" onclick={() => void session.openWorkspace()}>
    Open folder
  </button>
  <div class="spacer" data-tauri-drag-region></div>
  <div class="seg">
    <button class:active={session.view === "chat"} onclick={() => session.setView("chat")}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>Chat
    </button>
    <button class:active={session.view === "code"} onclick={() => session.setView("code")}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" /></svg>Code
    </button>
  </div>
  <button class="tb-btn" class:active={session.showThreads} title="Toggle threads panel" onclick={() => session.toggleThreads()}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>Threads
  </button>
  <span class="conn {session.connection}"><span class="pulse"></span>{connLabel}</span>
  {#if isTauri}
    <div class="wctl">
      <button title="Minimize" aria-label="Minimize window" onclick={() => void control("minimize")}>–</button>
      <button title="Maximize" aria-label="Maximize window" onclick={() => void control("maximize")}>▢</button>
      <button class="close" title="Close" aria-label="Close window" onclick={() => void control("close")}>×</button>
    </div>
  {/if}
</header>
