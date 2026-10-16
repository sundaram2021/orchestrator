<script lang="ts">
  import { Save, GitCompare, Eye, ArrowLeftRight, FileDiff } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import DiffView from "./DiffView.svelte";

  const active = $derived(session.activeFile);
  const content = $derived(active ? (session.fileContents[active] ?? "") : "");
  const isMarkdown = $derived(!!active && /\.(md|markdown)$/i.test(active));
  const view = $derived(session.editorView);

  const toggle = (target: "diff" | "markdown"): void => {
    if (target === "markdown" && !isMarkdown) return;
    session.editorView = session.editorView === target ? "code" : target;
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
    <button class="iconbtn" class:active={view === "diff"} disabled={!active} title="Toggle diff" onclick={() => toggle("diff")}>
      <GitCompare size={15} />
    </button>
    <button class="iconbtn" class:active={view === "markdown"} disabled={!isMarkdown} title="Markdown preview" onclick={() => toggle("markdown")}>
      <Eye size={15} />
    </button>
    <button class="iconbtn" disabled={!active || !session.dirty[active ?? ""]} title="Save (⌘S)" onclick={() => void session.saveActive()}>
      <Save size={15} />
    </button>
  </div>

  <div class="editor" class:mono={view === "code" && !!active}>
    {#if !active}
      <div class="empty">Open a file to start editing.</div>
    {:else if view === "diff"}
      <DiffView />
    {:else if view === "markdown"}
      <MarkdownPreview source={content} />
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
</style>
