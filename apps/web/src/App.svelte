<script lang="ts">
  import { onMount } from "svelte";
  import { session } from "./lib/session.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import FileTree from "./components/FileTree.svelte";
  import EditorPane from "./components/EditorPane.svelte";
  import ChatPanel from "./components/ChatPanel.svelte";
  import ThreadsPanel from "./components/ThreadsPanel.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";
  import StatusBar from "./components/StatusBar.svelte";

  onMount(() => {
    void session.init();
  });
</script>

<div id="app" data-view={session.view}>
  <TitleBar />

  <div class="body">
    <FileTree />

    <section class="main">
      {#if session.view === "code"}
        <EditorPane />
      {:else}
        <ChatPanel />
      {/if}
    </section>

    {#if session.showThreads}
      <ThreadsPanel />
    {/if}
  </div>

  {#if session.settingsOpen}
    <SettingsModal />
  {/if}

  {#if session.toast}
    <div class="toast">{session.toast}</div>
  {/if}

  <StatusBar />
</div>
