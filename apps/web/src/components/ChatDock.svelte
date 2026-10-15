<script lang="ts">
  import { session } from "../lib/session.svelte";
  import ModelSelector from "./ModelSelector.svelte";

  let text = $state("");
  let logEl = $state<HTMLDivElement | null>(null);

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    text = "";
    await session.send(value);
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  $effect(() => {
    void session.dock.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
</script>

<div class="bottom">
  <div class="dock-head">
    <strong>Orchestrator</strong>
    <span>Each message starts a new agent</span>
  </div>
  <div class="dock-log" bind:this={logEl}>
    {#each session.dock as entry (entry.id)}
      <div class="msg {entry.role === 'user' ? 'user' : 'sys'}">{entry.text}</div>
    {/each}
  </div>
  <div class="composer">
    <div class="box">
      <textarea bind:value={text} onkeydown={onKeydown} placeholder="Give an instruction… (Enter to send, Shift+Enter for new line)"></textarea>
      <div class="toolbar">
        <ModelSelector />
        <span class="hint">@file · /skill · /mcp</span>
        <button class="send" disabled={session.connection !== "open"} onclick={() => void send()}>Send</button>
      </div>
    </div>
  </div>
</div>
