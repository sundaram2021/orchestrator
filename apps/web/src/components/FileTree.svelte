<script lang="ts">
  import type { FileNode } from "@orchestrator/contracts";
  import { session } from "../lib/session.svelte";
  import FileNodeView from "./FileNodeView.svelte";

  const git = $derived(session.git);
  const branches = $derived(session.branches);

  let q = $state("");
  type MenuTarget = { x: number; y: number; path: string; type: "file" | "dir" | "root" };
  let menu = $state<MenuTarget | null>(null);

  const filterNodes = (nodes: FileNode[], needle: string): FileNode[] => {
    const out: FileNode[] = [];
    for (const node of nodes) {
      if (node.type === "dir") {
        const children = filterNodes(node.children ?? [], needle);
        if (children.length || node.name.toLowerCase().includes(needle)) {
          out.push({ ...node, children });
        }
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
  const baseDir = (t: MenuTarget): string =>
    t.type === "dir" ? t.path : t.type === "file" ? dirname(t.path) : "";

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

<aside class="explorer">
  <div class="panel-head">
    Explorer
    <span class="spacer"></span>
    <button class="icon-btn" title="New file" onclick={(e) => openAtRoot(e.clientX, e.clientY)}>＋</button>
    <button class="icon-btn" title="Refresh" onclick={() => void session.refreshTree()}>⟳</button>
  </div>

  <div class="pad">
    <input class="search" bind:value={q} placeholder="Search files…" />
  </div>

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

  {#if git?.available}
    <div class="changes">
      <div class="changes-head">
        Changes
        <span class="count">{git.files.length}</span>
        <span class="spacer"></span>
        {#if branches && branches.local.length > 1}
          <select
            class="mini-select"
            style="max-width:130px"
            value={branches.current}
            onchange={(e) => void session.checkout(e.currentTarget.value)}
          >
            {#each branches.local as b (b)}
              <option value={b}>{b}</option>
            {/each}
          </select>
        {/if}
      </div>
      <div class="changes-list">
        {#each git.files as f (f.path)}
          <div class="chg" class:sel={session.diffPath === f.path}>
            <button class="chg-name" title={f.path} onclick={() => void session.openDiff(f.path)}>
              <span class="chg-st" class:add={f.index === "A"} class:del={f.index === "D"}>{f.index !== " " && f.index !== "?" ? f.index : "U"}</span>
              <span class="txt" style="overflow:hidden;text-overflow:ellipsis">{f.path.split("/").pop()}</span>
            </button>
            {#if f.worktree !== " "}
              <button class="chg-stage" title="Stage file" onclick={() => void session.stageFile(f.path)}>＋</button>
            {/if}
          </div>
        {/each}
        {#if git.files.length === 0}
          <div class="empty" style="padding:6px 8px">Working tree clean.</div>
        {/if}
      </div>
      <div class="git-form">
        <input class="search" bind:value={session.commitMessage} placeholder="Commit message…" />
        <div class="row">
          <button class="foot-btn" onclick={() => void session.stageAll()}>Stage all</button>
          <button class="foot-btn" onclick={() => void session.push()}>Push</button>
          <button class="foot-btn" disabled={!session.commitMessage.trim()} onclick={() => void session.commit()}>Commit</button>
        </div>
        <input class="search" bind:value={session.prTitle} placeholder="PR title…" />
        <button class="foot-btn" disabled={!session.prTitle.trim()} onclick={() => void session.createPr()}>Open PR</button>
      </div>
    </div>
  {/if}

  <div class="explorer-foot">
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
