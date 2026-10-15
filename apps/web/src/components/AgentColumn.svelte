<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { session, harnessName } from "../lib/session.svelte";
  import Message from "./Message.svelte";

  let { thread }: { thread: ThreadView } = $props();
  let bodyEl = $state<HTMLDivElement | null>(null);

  const statusDot = $derived(
    thread.status === "running" ? "run" : thread.status === "stopped" ? "stop" : thread.status === "error" ? "err" : "",
  );
  const sig = $derived(thread.messages.reduce((n, m) => n + m.text.length, 0) + thread.messages.length);

  $effect(() => {
    void sig;
    if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
  });
</script>

<div class="acol" id="col-{thread.id}" class:active={thread.id === session.activeThreadId}>
  <div
    class="acol-head"
    role="button"
    tabindex="0"
    style="cursor:pointer"
    onclick={() => (session.activeThreadId = thread.id)}
    onkeydown={(e) => e.key === "Enter" && (session.activeThreadId = thread.id)}
  >
    <div class="acol-top">
      <span class="sdot {statusDot}"></span>
      <span class="acol-title" title={thread.title}>{thread.title}</span>
      <span class="acol-status">{thread.status}</span>
    </div>
    <div class="acol-meta">
      <span class="txt">{harnessName(thread.harness)} · {thread.model}</span>
      {#if thread.status === "running"}
        <button
          class="mini"
          onclick={(e) => {
            e.stopPropagation();
            void session.stop(thread.id);
          }}>Stop</button
        >
      {/if}
    </div>
  </div>
  <div class="acol-body" bind:this={bodyEl}>
    {#each thread.messages as message (message.id)}
      <Message {message} />
    {/each}
    {#if thread.messages.length === 0}
      <div class="empty">Waiting for the first event…</div>
    {/if}
  </div>
</div>
