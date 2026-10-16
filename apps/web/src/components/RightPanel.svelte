<script lang="ts">
  import { FolderTree, FileDiff } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import FileTree from "./FileTree.svelte";
  import ChangesView from "./ChangesView.svelte";

  const changed = $derived(session.git?.files.length ?? 0);
</script>

<aside class="right">
  <div class="right-tabs">
    <button class="rtab" class:active={session.rightTab === "files"} onclick={() => (session.rightTab = "files")}>
      <FolderTree size={14} />
      Files
    </button>
    <button class="rtab" class:active={session.rightTab === "changes"} onclick={() => (session.rightTab = "changes")}>
      <FileDiff size={14} />
      Changes
      {#if changed}<span class="count">{changed}</span>{/if}
    </button>
  </div>
  <div class="right-body">
    {#if session.rightTab === "files"}
      <FileTree />
    {:else}
      <ChangesView />
    {/if}
  </div>
</aside>
