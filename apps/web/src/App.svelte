<script lang="ts">
  import { onMount } from "svelte";
  import { session } from "./lib/session.svelte";
  import TopBar from "./components/TopBar.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import CenterTabs from "./components/CenterTabs.svelte";
  import ChatView from "./components/ChatView.svelte";
  import EditorView from "./components/EditorView.svelte";
  import RightPanel from "./components/RightPanel.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";

  onMount(() => {
    void session.init();
  });

  const showEditor = $derived(session.view === "editor" && !!session.activeFile);
</script>

<div id="app" data-view={session.view}>
  <TopBar />

  <div class="body">
    <Sidebar />

    <section class="center">
      <CenterTabs />
      {#if showEditor}
        <EditorView />
      {:else}
        <ChatView />
      {/if}
    </section>

    {#if session.showRight}
      <RightPanel />
    {/if}
  </div>

  {#if session.settingsOpen}
    <SettingsModal />
  {/if}

  {#if session.toast}
    <div class="toast">{session.toast}</div>
  {/if}
</div>
