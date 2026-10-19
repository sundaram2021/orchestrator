<script lang="ts">
  import { Save, GitCompare, Columns2, Search, ArrowLeftRight, FileDiff } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import DiffView from "./DiffView.svelte";

  const active = $derived(session.activeFile);
  const content = $derived(active ? (session.fileContents[active] ?? "") : "");
  const isMarkdown = $derived(!!active && /\.(md|markdown)$/i.test(active));
  const view = $derived(session.editorView);
  const hasChanges = $derived(!!active && !!session.git?.files.some((f) => f.path === active));

  const toggleDiff = (): void => {
    session.editorView = session.editorView === "diff" ? "code" : "diff";
    if (session.editorView === "diff") void session.loadDiff(active ?? undefined);
  };
</script>

<div class="editor-pane">
  <div class="editor-bar">
    <FileDiff size={14} />
    <span class="path">{active ?? "select a file"}</span>
    <div class="spacer"></div>
    {#if view === "diff"}
      <button class="iconbtn" title={session.diffStaged ? "Showing staged" : "Showing unstaged"} onclick={() => void session.setDiffStaged(!session.diffStaged)}>
        <ArrowLeftRight size={15} />
      </button>
    {/if}
    {#if hasChanges}
      <button class="iconbtn" class:active={view === "diff"} title="Toggle diff" onclick={toggleDiff}>
        <GitCompare size={15} />
      </button>
    {/if}
    {#if isMarkdown}
      <button
        class="iconbtn"
        class:active={session.mdPreview}
        title={session.mdPreview ? "Hide markdown preview" : "Markdown preview"}
        onclick={() => {
          session.editorView = "code";
          session.mdPreview = !session.mdPreview;
        }}
      >
        <span class="mdicon">
          <Columns2 size={15} />
          <span class="mag"><Search size={8} /></span>
        </span>
      </button>
    {/if}
    <button class="iconbtn" disabled={!active || !session.dirty[active ?? ""]} title="Save (⌘S)" onclick={() => void session.saveActive()}>
      <Save size={15} />
    </button>
  </div>

  <div class="editor" class:mono={view === "code" && !!active}>
    {#if !active}
      <div class="empty">Open a file to start editing.</div>
    {:else if view === "diff"}
      <DiffView />
    {:else if isMarkdown && session.mdPreview}
      <div class="md-split">
        <div class="md-src">
          {#key active}
            <CodeEditor {content} path={active} onChange={(value) => session.updateContent(active, value)} />
          {/key}
        </div>
        <div class="md-prev">
          <MarkdownPreview source={content} />
        </div>
      </div>
    {:else}
      {#key active}
        <CodeEditor {content} path={active} onChange={(value) => session.updateContent(active, value)} />
      {/key}
    {/if}
  </div>
</div>

<style>
  .editor-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .mdicon {
    position: relative;
    display: grid;
    place-items: center;
  }
  .mag {
    position: absolute;
    right: -4px;
    bottom: -3px;
    display: grid;
    place-items: center;
    padding: 1px;
    border-radius: 50%;
    background: var(--canvas);
  }
</style>
