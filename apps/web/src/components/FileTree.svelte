<script lang="ts">
  import { session } from "../lib/session.svelte";
  import FileNodeView from "./FileNodeView.svelte";

  const git = $derived(session.git);
</script>

<aside class="sidebar-left">
  <div class="side-title-bar">
    FILES
    <span class="spacer"></span>
    <button class="icon-btn" title="Refresh" onclick={() => void session.refreshTree()}>⟳</button>
  </div>
  <div class="tree">
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
