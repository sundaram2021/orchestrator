<script lang="ts">
  import type { FileNode } from "@orchestrator/contracts";
  import { session } from "../lib/session.svelte";
  import { fileIcon } from "../lib/icons";
  import Self from "./FileNodeView.svelte";

  let { node, depth = 0 }: { node: FileNode; depth?: number } = $props();

  const collapsed = $derived(node.type === "dir" && !!session.collapsed[node.path]);
</script>

{#if node.type === "dir"}
  <div
    class="folder"
    data-path={node.path}
    data-type="dir"
    style="padding-left:{depth * 12 + 8}px"
    role="button"
    tabindex="0"
    onclick={() => session.toggleDir(node.path)}
    onkeydown={(e) => e.key === "Enter" && session.toggleDir(node.path)}
  >
    <span class="chev">{collapsed ? "▸" : "▾"}</span>
    {node.name}
  </div>
  {#if !collapsed}
    {#each node.children ?? [] as child (child.path)}
      <Self node={child} depth={depth + 1} />
    {/each}
  {/if}
{:else}
  <div
    class="file"
    data-path={node.path}
    data-type="file"
    class:active={session.activeFile === node.path}
    style="padding-left:{depth * 12 + 22}px"
    role="button"
    tabindex="0"
    onclick={() => void session.openFile(node.path)}
    onkeydown={(e) => e.key === "Enter" && void session.openFile(node.path)}
  >
    <span class="ic">{fileIcon(node.name)}</span>
    {node.name}
  </div>
{/if}
