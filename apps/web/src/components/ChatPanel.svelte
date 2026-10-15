<script lang="ts">
  import { session, harnessOf, harnessName } from "../lib/session.svelte";
  import Message from "./Message.svelte";
  import ModelSelector from "./ModelSelector.svelte";
  import ThreadActions from "./ThreadActions.svelte";

  let text = $state("");
  let scrollEl = $state<HTMLDivElement | null>(null);

  const thread = $derived(session.activeThread);

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (!value) return;
    text = "";
    await session.send(value);
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const sig = $derived(
    thread ? thread.messages.reduce((n, m) => n + m.text.length, 0) + thread.messages.length : 0,
  );

  $effect(() => {
    void sig;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
</script>

<div class="chat">
  {#if thread}
    <div class="chat-head">
      <span
        class="sdot"
        class:run={thread.status === "running"}
        class:stop={thread.status === "stopped"}
        class:err={thread.status === "error"}
      ></span>
      <span class="title" title={thread.title}>{thread.title}</span>
      <span class="meta">
        <span class="pill">
          <span class="hdot" style="background:{harnessOf(thread.harness)?.color ?? 'var(--muted)'}"></span>
          <span class="txt">{harnessName(thread.harness)}</span>
        </span>
        <span class="pill"><span class="txt">{thread.model}</span></span>
        {#if thread.branch}
          <span class="pill" title="Isolated worktree branch"><span class="txt">{thread.branch}</span></span>
        {/if}
      </span>
    </div>
    <div style="padding:10px 18px 0;flex-shrink:0">
      <ThreadActions {thread} />
    </div>
    <div class="chat-scroll" bind:this={scrollEl}>
      <div class="chat-col">
        {#if thread.messages.length === 0}
          <div class="empty-state">
            <div class="big">Working…</div>
            Waiting for the first event from {harnessName(thread.harness)}.
          </div>
        {:else}
          {#each thread.messages as message (message.id)}
            <Message {message} />
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <div class="chat-scroll">
      <div class="empty-state">
        <div class="big">Start a new agent</div>
        Describe a task below. Each message spins up an isolated agent in its own git worktree, so parallel
        agents never collide. <kbd>Enter</kbd> to send, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line.
      </div>
    </div>
  {/if}

  <div class="composer">
    <div class="compose-box">
      <textarea
        bind:value={text}
        onkeydown={onKeydown}
        placeholder="Give an instruction… (Enter to send, Shift+Enter for new line)"
      ></textarea>
      <div class="compose-bar">
        <ModelSelector />
        <span class="hint">@file · /skill · /mcp</span>
        <button class="send" disabled={session.connection !== "open"} onclick={() => void send()}>
          Send
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  </div>
</div>
