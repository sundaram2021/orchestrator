<script lang="ts">
  import { session } from "../lib/session.svelte";
  import { fileIcon } from "../lib/icons";
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

<div class="ide-area">
  <div class="tabs">
    {#each session.openTabs as tab (tab)}
      <div
        class="tab"
        class:active={tab === active}
        role="button"
        tabindex="0"
        onclick={() => void session.openFile(tab)}
        onkeydown={(e) => e.key === "Enter" && void session.openFile(tab)}
      >
        <span class="ic">{fileIcon(tab)}</span>
        {tab.split("/").pop()}{#if session.dirty[tab]}<span class="dirty">●</span>{/if}
        <span
          class="close"
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
          }}>×</span
        >
      </div>
    {/each}
    {#if session.openTabs.length === 0}
      <div class="tab active">No file open</div>
    {/if}
  </div>
  <div class="editor-bar">
    <span>{active ?? "select a file from the tree"}</span>
    <div class="spacer"></div>
    <button class="tbtn" disabled={!active} onclick={() => void session.saveActive()} title="Save (writes to disk)">
      Save
    </button>
    <button class="tbtn" class:active={view === "diff"} title="Show git diff" onclick={() => toggle("diff")}>
      Git diff
    </button>
    {#if view === "diff"}
      <button
        class="tbtn"
        class:active={session.diffStaged}
        title="Toggle staged vs unstaged diff"
        onclick={() => void session.setDiffStaged(!session.diffStaged)}
      >
        {session.diffStaged ? "Staged" : "Unstaged"}
      </button>
    {/if}
    <button
      class="tbtn"
      class:active={view === "markdown"}
      disabled={!isMarkdown}
      title="Markdown preview"
      onclick={() => toggle("markdown")}
    >
      Markdown
    </button>
  </div>
  <div class="editor" class:mono={view === "code" && !!active}>
    {#if !active}
      <div class="empty">Open a file from the tree to start editing.</div>
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
