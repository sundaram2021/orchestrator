<script lang="ts">
  import { onMount } from "svelte";
  import { session } from "./lib/session.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import FileTree from "./components/FileTree.svelte";
  import EditorPane from "./components/EditorPane.svelte";
  import AgentArea from "./components/AgentArea.svelte";
  import HistorySidebar from "./components/HistorySidebar.svelte";
  import ChatDock from "./components/ChatDock.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";
  import StatusBar from "./components/StatusBar.svelte";

  onMount(() => {
    void session.init();
  });
</script>

<div id="app" data-mode={session.mode}>
  <TitleBar />

  <div class="body">
    <FileTree />

    <section class="main">
      <div class="workspace">
        <EditorPane />
        <AgentArea />
      </div>
      <ChatDock />
    </section>

    <HistorySidebar />
  </div>

  {#if session.settingsOpen}
    <SettingsModal />
  {/if}

  {#if session.toast}
    <div class="toast">{session.toast}</div>
  {/if}

  <StatusBar />
</div>
