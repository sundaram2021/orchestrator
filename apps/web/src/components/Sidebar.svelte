<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { Plus, Search, MoreHorizontal, Trash2, CornerDownRight } from "@lucide/svelte";
  import { session, harnessOf, harnessName } from "../lib/session.svelte";
  import { relTime, statusLabel } from "../lib/time";
  import ProviderIcon from "./ProviderIcon.svelte";
  import ThreadActions from "./ThreadActions.svelte";

  let q = $state("");
  const clearAll = async (): Promise<void> => {
    if (!session.threads.some((t) => t.kind !== "orchestrator")) return;
    if (!confirm("Remove all chats from the sidebar? Running agents will be stopped.")) return;
    await session.clearAll();
  };
  const filtered = $derived(
    session.threads.filter(
      (t) => t.kind !== "orchestrator" && (!q || t.title.toLowerCase().includes(q.toLowerCase())),
    ),
  );
  const known = $derived(new Set(filtered.map((t) => t.id)));
  const childrenOf = $derived.by(() => {
    const map = new Map<string, ThreadView[]>();
    for (const t of filtered) {
      if (!t.parentId || !known.has(t.parentId)) continue;
      const list = map.get(t.parentId) ?? [];
      list.push(t);
      map.set(t.parentId, list);
    }
    return map;
  });
  const roots = $derived(filtered.filter((t) => !t.parentId || !known.has(t.parentId)));
  const subtreeRunning = (t: ThreadView): boolean =>
    t.status === "running" || (childrenOf.get(t.id) ?? []).some(subtreeRunning);
  const groups = $derived.by(() => {
    const running: ThreadView[] = [];
    const done: ThreadView[] = [];
    for (const root of roots) (subtreeRunning(root) ? running : done).push(root);
    return { running, done };
  });
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
    const below = r.bottom + 280 < window.innerHeight;
    const y = below
      ? `top:${r.bottom + 4}px;bottom:auto`
      : `top:auto;bottom:${window.innerHeight - r.top + 4}px`;
    menuStyle = `${y};right:${Math.max(8, window.innerWidth - r.right)}px;`;
    menuFor = id;
  };
</script>

<svelte:window onclick={() => (menuFor = null)} />

<aside class="sidebar">
  <div class="sb-head">
    <button class="newbtn" onclick={() => session.newAgent()}>
      <Plus size={15} />
      New agent
    </button>
  </div>

  <div class="sb-search">
    <div class="search-wrap">
      <span class="search-ic"><Search size={13} /></span>
      <input class="search has-ic" bind:value={q} placeholder="Search agents…" />
      {#if session.threads.some((t) => t.kind !== "orchestrator")}
        <button class="clearbtn" title="Clear all chats" aria-label="Clear all chats" onclick={clearAll}>
          <Trash2 size={13} />
        </button>
      {/if}
    </div>
  </div>

  <div class="sb-body">
    {#if filtered.length === 0}
      <div class="empty" style="padding:8px">{q ? "No matches." : "No agents yet."}</div>
    {:else}
      {#if groups.running.length}
        <div class="hgroup">Running</div>
        {#each groups.running as t (t.id)}{@render node(t, 0)}{/each}
      {/if}
      {#if groups.done.length}
        <div class="hgroup">History</div>
        {#each groups.done as t (t.id)}{@render node(t, 0)}{/each}
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

{#snippet node(t: ThreadView, depth: number)}
  {@render card(t, depth)}
  {#each childrenOf.get(t.id) ?? [] as child (child.id)}
    {@render node(child, depth + 1)}
  {/each}
{/snippet}

{#snippet card(t: ThreadView, depth: number)}
  <div
    class="tcard"
    class:sub={depth > 0}
    class:active={t.id === session.activeThreadId}
    class:menuing={t.id === menuFor}
    style={depth > 0 ? `margin-left:${depth * 14}px;width:calc(100% - ${depth * 14}px)` : ""}
    role="button"
    tabindex="0"
    onclick={() => session.selectThread(t.id)}
    onkeydown={(e) => e.key === "Enter" && session.selectThread(t.id)}
  >
    <span class="trow">
      {#if depth > 0}
        <span class="kicon" title="Sub-agent"><CornerDownRight size={13} /></span>
      {/if}
      <span class="t" title={t.title}>{t.title}</span>
      {#if t.unread}<span class="tunread" title="Unread output"></span>{/if}
      <span class="tstat {dotClass(t.status)}">{statusLabel(t.status)}</span>
      {#if t.kind !== "orchestrator"}
        <button class="tmenu" title="Session options" onclick={(e) => openMenu(e, t.id)}>
          <MoreHorizontal size={15} />
        </button>
      {/if}
    </span>
    {#if snippet(t)}<span class="tsnip">{snippet(t)}</span>{/if}
    <span class="m">
      <span class="sdot {dotClass(t.status)}"></span>
      <ProviderIcon id={t.harness} color={harnessOf(t.harness)?.color} size={13} />
      <span class="txt">{harnessName(t.harness)}</span>
      <span class="mdot">·</span>
      <span class="txt">{relTime(t.updatedAt)}</span>
      {#if t.parentId}<span class="mdot">·</span><span class="txt">sub-agent</span>{/if}
    </span>
  </div>
{/snippet}

<style>
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-ic {
    position: absolute;
    left: 10px;
    display: grid;
    place-items: center;
    color: var(--faint);
    pointer-events: none;
  }
  .search.has-ic {
    padding-left: 31px;
    padding-right: 34px;
  }
  .clearbtn {
    position: absolute;
    right: 6px;
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
  .kicon {
    display: grid;
    place-items: center;
    color: var(--faint);
    flex-shrink: 0;
  }
  .tunread {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .tcard.sub {
    border-left-color: var(--border-soft);
    border-top-left-radius: 4px;
    border-bottom-left-radius: 4px;
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
</style>
