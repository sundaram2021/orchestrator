<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { languageOf } from "../lib/icons";

  let {
    content,
    path,
    onChange,
  }: { content: string; path: string; onChange: (value: string) => void } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
  let disposeChange: { dispose: () => void } | null = null;

  onMount(() => {
    let cancelled = false;
    void (async () => {
      const mod = await import("../lib/monaco");
      if (cancelled || !host) return;
      const monaco = mod.default;
      const ed = monaco.editor.create(host, {
        value: content,
        language: languageOf(path),
        theme: "orchestrator-dark",
        automaticLayout: true,
        fontSize: 12.5,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        tabSize: 2,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      });
      editor = ed;
      disposeChange = ed.onDidChangeModelContent(() => onChange(ed.getValue()));
    })();
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    disposeChange?.dispose();
    editor?.dispose();
    editor = null;
  });
</script>

<div class="mono-host" bind:this={host}></div>
