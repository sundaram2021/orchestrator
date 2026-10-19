<script lang="ts">
  import { session } from "../lib/session.svelte";
  import { MessagesSquare, X } from "@lucide/svelte";
  import { fileIcon } from "../lib/icons";
  import { baseName } from "../lib/paths";

  const editing = $derived(session.view === "editor" && !!session.activeFile);
  const convActive = (id: string): boolean => !editing && session.activeThreadId === id;
</script>

<div class="ctabs">
  {#each session.chatTabs as id (id)}
    {@const thread = session.threads.find((t) => t.id === id)}
    {#if thread}
      <div
        class="ctab"
        class:active={convActive(id)}
        role="button"
        tabindex="0"
        onclick={() => session.openConversation(id)}
        onkeydown={(e) => e.key === "Enter" && session.openConversation(id)}
      >
        <span class="cticon"><MessagesSquare size={13} /></span>
        <span class="ctname" title={thread.title}>{thread.title}</span>
        {#if thread.status === "running"}<span class="run"></span>{/if}
        {#if thread.unread}<span class="unread" title="Unread output"></span>{/if}
        {#if thread.kind !== "orchestrator"}
          <span
            class="x"
            role="button"
            tabindex="0"
            title="Close tab"
            onclick={(e) => {
              e.stopPropagation();
              session.closeConversation(id);
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                session.closeConversation(id);
              }
            }}><X size={13} /></span
          >
        {/if}
      </div>
    {/if}
  {/each}

  {#each session.openTabs as tab (tab)}
    <div
      class="ctab"
      class:active={editing && tab === session.activeFile}
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
