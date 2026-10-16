<script lang="ts">
  import { FolderOpen, Settings, PanelRight, GitBranch, Minus, Square, X } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import Logo from "./Logo.svelte";

  const connLabel = $derived(
    session.connection === "open" ? "Connected" : session.connection === "connecting" ? "Connecting" : "Offline",
  );
  const wsName = $derived(
    session.config?.workspace
      ? (session.config.workspace.split(/[\\/]/).filter(Boolean).pop() ?? "")
      : "no workspace",
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

<header class="topbar" data-tauri-drag-region>
  <Logo wordmark />

  <div class="crumbbar" data-tauri-drag-region>
    <span class="sep">/</span>
    <span class="ws" title={session.config?.workspace ?? ""}>{wsName}</span>
    {#if session.git?.available && session.git.branch}
      <span class="branchchip" title="Current branch">
        <GitBranch size={11} />
        {session.git.branch}
      </span>
    {/if}
  </div>

  <div class="spacer" data-tauri-drag-region></div>

  <span class="conn {session.connection}"><span class="pulse"></span>{connLabel}</span>

  <button class="iconbtn" class:active={session.showRight} title="Toggle panel" onclick={() => session.toggleRight()}>
    <PanelRight size={16} />
  </button>
  <button class="iconbtn" title="Open a folder as workspace" onclick={() => void session.openWorkspace()}>
    <FolderOpen size={16} />
  </button>
  <button class="iconbtn" title="Settings" onclick={() => session.openSettings()}>
    <Settings size={16} />
  </button>

  {#if isTauri}
    <div class="wctl">
      <button title="Minimize" aria-label="Minimize window" onclick={() => void control("minimize")}><Minus size={14} /></button>
      <button title="Maximize" aria-label="Maximize window" onclick={() => void control("maximize")}><Square size={12} /></button>
      <button class="close" title="Close" aria-label="Close window" onclick={() => void control("close")}><X size={15} /></button>
    </div>
  {/if}
</header>
