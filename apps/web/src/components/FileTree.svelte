<script lang="ts">
  import { session } from "../lib/session.svelte";
  import FileNodeView from "./FileNodeView.svelte";

  const git = $derived(session.git);

  type MenuTarget = { x: number; y: number; path: string; type: "file" | "dir" | "root" };
  let menu = $state<MenuTarget | null>(null);

  const dirname = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const basename = (p: string): string => (p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p);
  const join = (a: string, b: string): string => (a ? `${a}/${b}` : b);

  const baseDir = (target: MenuTarget): string =>
    target.type === "dir" ? target.path : target.type === "file" ? dirname(target.path) : "";

  const onContext = (event: MouseEvent): void => {
    event.preventDefault();
    const el = (event.target as HTMLElement | null)?.closest("[data-path]") as HTMLElement | null;
    menu = {
      x: event.clientX,
      y: event.clientY,
      path: el?.dataset.path ?? "",
      type: (el?.dataset.type as "file" | "dir") ?? (el ? "file" : "root"),
    };
  };

  const openAtRoot = (x: number, y: number): void => {
    menu = { x, y, path: "", type: "root" };
  };

  const newFile = (): void => {
    if (!menu) return;
    const name = prompt("New file name");
    if (name?.trim()) void session.createPath(join(baseDir(menu), name.trim()), "file");
    menu = null;
  };

  const newFolder = (): void => {
    if (!menu) return;
    const name = prompt("New folder name");
    if (name?.trim()) void session.createPath(join(baseDir(menu), name.trim()), "dir");
    menu = null;
  };

  const rename = (): void => {
    if (!menu || menu.type === "root") return;
    const name = prompt("Rename to", basename(menu.path));
    if (name?.trim()) void session.renamePath(menu.path, join(dirname(menu.path), name.trim()));
    menu = null;
  };

  const remove = (): void => {
    if (!menu || menu.type === "root") return;
    if (confirm(`Delete ${menu.path}?`)) void session.deletePath(menu.path);
    menu = null;
  };
</script>

<svelte:window onclick={() => (menu = null)} />

<aside class="sidebar-left">
  <div class="side-title-bar">
    FILES
    <span class="spacer"></span>
    <button class="icon-btn" title="New file" onclick={(e) => openAtRoot(e.clientX, e.clientY)}>＋</button>
    <button class="icon-btn" title="Refresh" onclick={() => void session.refreshTree()}>⟳</button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="tree" role="tree" tabindex="0" oncontextmenu={onContext}>
    {#if session.tree.length === 0}
      <div class="empty" style="padding:8px">No workspace files.</div>
    {:else}
      {#each session.tree as node (node.path)}
        <FileNodeView {node} />
      {/each}
    {/if}
  </div>

  <div class="git-panel">
    <div class="git-head">
      <span class="branch">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M8 6h6a4 4 0 0 1 4 4v0" /></svg>
        {git?.branch || "no git"}
      </span>
      <span class="spacer"></span>
      {#if git?.available}
        <span class="gcount" title="staged">{git.staged}↑</span>
        <span class="gcount" title="unstaged">{git.unstaged}↓</span>
      {/if}
    </div>
    {#if git?.available}
      <input class="search" bind:value={session.commitMessage} placeholder="Commit message…" />
      <div class="git-actions">
        <button class="btn ghost" onclick={() => void session.stageAll()}>Stage all</button>
        <button class="btn ghost" onclick={() => void session.push()}>Push</button>
        <button class="btn" disabled={!session.commitMessage.trim()} onclick={() => void session.commit()}>Commit</button>
      </div>
    {/if}
  </div>

  <div class="side-foot">
    <button class="foot-btn" class:active={session.settingsOpen} title="Settings" onclick={() => session.openSettings()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>
      Settings
    </button>
  </div>
</aside>

{#if menu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ctx-menu" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
    <button class="ctx-item" onclick={newFile}>New file</button>
    <button class="ctx-item" onclick={newFolder}>New folder</button>
    {#if menu.type !== "root"}
      <button class="ctx-item" onclick={rename}>Rename</button>
      <button class="ctx-item danger" onclick={remove}>Delete</button>
    {/if}
  </div>
{/if}

<style>
  .ctx-menu {
    position: fixed;
    z-index: 60;
    min-width: 140px;
    padding: 4px;
    border-radius: 8px;
    background: var(--panel, #1b1b1f);
    border: 1px solid var(--border, #2c2c33);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
  }
  .ctx-item {
    text-align: left;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: var(--text, #e6e6e6);
    font: inherit;
    border-radius: 6px;
    cursor: pointer;
  }
  .ctx-item:hover {
    background: var(--hover, #26262c);
  }
  .ctx-item.danger {
    color: #e57373;
  }
</style>
