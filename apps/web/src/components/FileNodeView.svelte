<script lang="ts">
  import type { FileNode } from "@orchestrator/contracts";
  import { ChevronRight, ChevronDown, Folder, FolderOpen } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { fileGlyph } from "../lib/icons";
  import type { FileChange } from "../lib/git";
  import Self from "./FileNodeView.svelte";

  let {
    node,
    depth = 0,
    changes = new Map<string, FileChange>(),
  }: { node: FileNode; depth?: number; changes?: Map<string, FileChange> } = $props();

  const collapsed = $derived(node.type === "dir" && !!session.collapsed[node.path]);
  const Glyph = $derived(fileGlyph(node.name));
  const change = $derived(node.type === "file" ? (changes.get(node.path) ?? null) : null);
</script>

{#if node.type === "dir"}
  <div
    class="node folder"
    data-path={node.path}
    data-type="dir"
    style="padding-left:{depth * 12 + 6}px"
    role="button"
    tabindex="0"
    onclick={() => session.toggleDir(node.path)}
    onkeydown={(e) => e.key === "Enter" && session.toggleDir(node.path)}
  >
    <span class="chev">{#if collapsed}<ChevronRight size={13} />{:else}<ChevronDown size={13} />{/if}</span>
    <span class="fico">{#if collapsed}<Folder size={14} />{:else}<FolderOpen size={14} />{/if}</span>
    <span class="nm">{node.name}</span>
  </div>
  {#if !collapsed}
    {#each node.children ?? [] as child (child.path)}
      <Self node={child} depth={depth + 1} {changes} />
    {/each}
  {/if}
{:else}
  <div
    class="node"
    data-path={node.path}
    data-type="file"
    class:active={session.activeFile === node.path}
    style="padding-left:{depth * 12 + 22}px"
    role="button"
    tabindex="0"
    onclick={() => void session.openFile(node.path)}
    onkeydown={(e) => e.key === "Enter" && void session.openFile(node.path)}
  >
    <span class="fico"><Glyph size={14} /></span>
    <span class="nm">{node.name}</span>
    {#if change}
      <span class="chg-badge {change.kind}" title={change.label}>{change.code}</span>
    {/if}
  </div>
{/if}

<style>
  .node .fico {
    display: grid;
    place-items: center;
    color: var(--faint);
    flex-shrink: 0;
  }
  .node.folder .fico {
    color: var(--accent);
    opacity: 0.8;
  }
  .node .chev {
    display: grid;
    place-items: center;
    width: 14px;
  }
</style>
