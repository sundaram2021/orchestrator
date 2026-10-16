<script lang="ts">
  import type { FileNode } from "@orchestrator/contracts";
  import { FilePlus, RefreshCw, Search } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import FileNodeView from "./FileNodeView.svelte";

  let q = $state("");
  type MenuTarget = { x: number; y: number; path: string; type: "file" | "dir" | "root" };
  let menu = $state<MenuTarget | null>(null);

  const filterNodes = (nodes: FileNode[], needle: string): FileNode[] => {
    const out: FileNode[] = [];
    for (const node of nodes) {
      if (node.type === "dir") {
        const children = filterNodes(node.children ?? [], needle);
        if (children.length || node.name.toLowerCase().includes(needle)) out.push({ ...node, children });
      } else if (node.name.toLowerCase().includes(needle)) {
        out.push(node);
      }
    }
    return out;
  };
  const filtered = $derived(q.trim() ? filterNodes(session.tree, q.trim().toLowerCase()) : session.tree);

  const dirname = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const basename = (p: string): string => (p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p);
  const join = (a: string, b: string): string => (a ? `${a}/${b}` : b);
  const baseDir = (t: MenuTarget): string => (t.type === "dir" ? t.path : t.type === "file" ? dirname(t.path) : "");

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

<div class="right-head">
  Files
  <span class="spacer"></span>
  <button class="iconbtn" title="New file" onclick={() => { const name = prompt("New file name"); if (name?.trim()) void session.createPath(name.trim(), "file"); }}><FilePlus size={15} /></button>
  <button class="iconbtn" title="Refresh" onclick={() => void session.refreshTree()}><RefreshCw size={14} /></button>
</div>

<div class="ft-search">
  <span class="search-ic"><Search size={13} /></span>
  <input class="search has-ic" bind:value={q} placeholder="Search files…" />
</div>

<style>
  .ft-search {
    position: relative;
    padding: 0 12px 8px;
  }
  .search-ic {
    position: absolute;
    left: 20px;
    top: 9px;
    color: var(--faint);
    pointer-events: none;
  }
  .search.has-ic {
    padding-left: 30px;
  }
</style>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="tree" role="tree" tabindex="0" oncontextmenu={onContext}>
  {#if filtered.length === 0}
    <div class="empty" style="padding:8px">{q ? "No matches." : "No workspace files."}</div>
  {:else}
    {#each filtered as node (node.path)}
      <FileNodeView {node} />
    {/each}
  {/if}
</div>

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
