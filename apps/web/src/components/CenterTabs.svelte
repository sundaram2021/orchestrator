<script lang="ts">
  import { session } from "../lib/session.svelte";
  import { MessageSquare, X } from "@lucide/svelte";
  import { fileIcon } from "../lib/icons";
  import { baseName } from "../lib/paths";

  const showChat = $derived(session.view === "chat" || !session.activeFile);
</script>

<div class="ctabs">
  <button class="ctab" class:active={showChat} onclick={() => session.setView("chat")}>
    <MessageSquare size={13} />
    Chat
  </button>
  {#each session.openTabs as tab (tab)}
    <div
      class="ctab"
      class:active={!showChat && tab === session.activeFile}
      role="button"
      tabindex="0"
      onclick={() => void session.openFile(tab)}
      onkeydown={(e) => e.key === "Enter" && void session.openFile(tab)}
    >
      <span class="fx">{fileIcon(tab)}</span>
      <span>{baseName(tab)}</span>
      {#if session.dirty[tab]}<span class="dirty">●</span>{/if}
      <span
        class="x"
        role="button"
        tabindex="0"
        onclick={(e) => {
          e.stopPropagation();
          session.closeTab(tab);
        }}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            session.closeTab(tab);
          }
        }}><X size={13} /></span
      >
    </div>
  {/each}
  <span class="tabspacer"></span>
</div>
