<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { Folder, Plus, Search, MoreHorizontal, Trash2 } from "@lucide/svelte";
  import { session, harnessOf, harnessName, runningCount } from "../lib/session.svelte";
  import { relTime, statusLabel } from "../lib/time";
  import ProviderIcon from "./ProviderIcon.svelte";
  import ThreadActions from "./ThreadActions.svelte";

  let q = $state("");
  const clearAll = async (): Promise<void> => {
    if (!session.threads.length) return;
    if (!confirm("Remove all chats from the sidebar? Running agents will be stopped.")) return;
    await session.clearAll();
  };
  const filtered = $derived(
    session.threads.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())),
  );
  const running = $derived(filtered.filter((t) => t.status === "running"));
  const done = $derived(filtered.filter((t) => t.status !== "running"));
  const wsName = $derived(
    session.config?.workspace
      ? (session.config.workspace.split(/[\\/]/).filter(Boolean).pop() ?? "")
      : "no workspace",
  );
  const dotClass = (s: string): string =>
    s === "running" ? "run" : s === "stopped" ? "stop" : s === "error" ? "err" : "";

  const snippet = (t: ThreadView): string => {
    const last = t.messages[t.messages.length - 1];
    if (!last) return t.prompt ?? "Waiting for events…";
    return last.text || last.reasoning || (last.tools.length ? `${last.tools.length} tool calls` : "");
  };

  let menuFor = $state<string | null>(null);
  let menuStyle = $state("");
  const menuThread = $derived(session.threads.find((t) => t.id === menuFor) ?? null);

  const openMenu = (e: MouseEvent, id: string): void => {
    e.stopPropagation();
    if (menuFor === id) {
      menuFor = null;
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const below = r.bottom + 340 < window.innerHeight;
    const y = below ? `top:${r.bottom + 4}px` : `bottom:${window.innerHeight - r.top + 4}px`;
    menuStyle = `${y};left:${r.right - 4}px;`;
    menuFor = id;
  };
</script>

<svelte:window onclick={() => (menuFor = null)} />

<aside class="sidebar">
  <div class="sb-head">
    <div class="sb-ws">
      <span class="glyph"><Folder size={14} /></span>
      <div class="info">
        <div class="name" title={session.config?.workspace ?? ""}>{wsName}</div>
        <div class="sub">
          {#if session.git?.available && session.git.branch}{session.git.branch} · {/if}{runningCount()} running
        </div>
      </div>
    </div>
    <button class="newbtn" onclick={() => session.newAgent()}>
      <Plus size={15} />
      New agent
    </button>
  </div>

  <div class="sb-search">
    <span class="search-ic"><Search size={13} /></span>
    <input class="search has-ic" bind:value={q} placeholder="Search agents…" />
    {#if session.threads.length}
      <button class="clearbtn" title="Clear all chats" aria-label="Clear all chats" onclick={clearAll}>
        <Trash2 size={13} />
      </button>
    {/if}
  </div>

  <div class="sb-body">
    {#if filtered.length === 0}
      <div class="empty" style="padding:8px">{q ? "No matches." : "No agents yet."}</div>
    {:else}
      {#if running.length}
        <div class="hgroup">Running</div>
        {#each running as t (t.id)}{@render card(t)}{/each}
      {/if}
      {#if done.length}
        <div class="hgroup">History</div>
        {#each done as t (t.id)}{@render card(t)}{/each}
      {/if}
    {/if}
  </div>
</aside>

{#if menuThread}
  <div
    class="actions-menu card-menu"
    style={menuStyle}
    role="presentation"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <ThreadActions thread={menuThread} onaction={() => (menuFor = null)} />
  </div>
{/if}

{#snippet card(t: ThreadView)}
  <div
    class="tcard"
    class:active={t.id === session.activeThreadId}
    class:menuing={t.id === menuFor}
    role="button"
    tabindex="0"
    onclick={() => session.selectThread(t.id)}
    onkeydown={(e) => e.key === "Enter" && session.selectThread(t.id)}
  >
    <span class="trow">
      <span class="t" title={t.title}>{t.title}</span>
      <span class="tstat {dotClass(t.status)}">{statusLabel(t.status)}</span>
      <button class="tmenu" title="Session options" onclick={(e) => openMenu(e, t.id)}>
        <MoreHorizontal size={15} />
      </button>
    </span>
    {#if snippet(t)}<span class="tsnip">{snippet(t)}</span>{/if}
    <span class="m">
      <span class="sdot {dotClass(t.status)}"></span>
      <ProviderIcon id={t.harness} color={harnessOf(t.harness)?.color} size={13} />
      <span class="txt">{harnessName(t.harness)}</span>
      <span class="mdot">·</span>
      <span class="txt">{relTime(t.updatedAt)}</span>
    </span>
  </div>
{/snippet}

<style>
  .search-ic {
    position: absolute;
    left: 20px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--faint);
    pointer-events: none;
  }
  .sb-search {
    position: relative;
  }
  .search.has-ic {
    padding-left: 30px;
    padding-right: 32px;
  }
  .clearbtn {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--faint);
  }
  .clearbtn:hover {
    background: var(--surface-2);
    color: var(--red);
  }
  .trow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .trow .t {
    flex: 1;
    min-width: 0;
  }
  .tstat {
    font-size: 10px;
    color: var(--faint);
    flex-shrink: 0;
  }
  .tstat.run {
    color: var(--green);
  }
  .tstat.err {
    color: var(--red);
  }
  .tmenu {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--faint);
    flex-shrink: 0;
    opacity: 0;
  }
  .tcard:hover .tmenu,
  .tcard.active .tmenu,
  .tmenu:focus-visible {
    opacity: 1;
  }
  .tmenu:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .tcard.menuing .tmenu {
    opacity: 1;
  }
  .tsnip {
    font-size: 11.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .mdot {
    color: var(--faint);
  }
  .card-menu {
    position: fixed;
    top: auto;
    right: auto;
    bottom: auto;
    transform: translateX(-100%);
    z-index: 900;
  }
</style>
