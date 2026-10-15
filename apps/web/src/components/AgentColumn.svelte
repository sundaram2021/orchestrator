<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { session, harnessName, allModels } from "../lib/session.svelte";
  import Message from "./Message.svelte";

  let { thread }: { thread: ThreadView } = $props();
  let bodyEl = $state<HTMLDivElement | null>(null);
  let retryModel = $state("");
  const effectiveModel = $derived(retryModel || thread.model);

  const statusDot = $derived(
    thread.status === "running" ? "run" : thread.status === "stopped" ? "stop" : thread.status === "error" ? "err" : "",
  );
  const sig = $derived(thread.messages.reduce((n, m) => n + m.text.length, 0) + thread.messages.length);
  const models = $derived(allModels());

  $effect(() => {
    void sig;
    if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
  });

  const discard = () => {
    if (confirm("Discard this agent, its branch and worktree?")) void session.discardThread(thread.id);
  };

  const checkpoints = $derived(session.checkpoints[thread.id] ?? []);

  $effect(() => {
    if (thread.branch) void session.loadCheckpoints(thread.id);
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
      {#if thread.parentId}
        <span class="branch-pill" title="Forked thread">↳</span>
      {/if}
      {#if thread.branch}
        <span class="branch-pill" title="Isolated branch">{thread.branch}</span>
      {/if}
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
  <div class="acol-actions">
    {#if thread.status !== "running"}
      <select class="mini-select" bind:value={retryModel} title="Model for retry">
        <option value="">{thread.model} (current)</option>
        {#each models as m (m.id)}
          <option value={m.id}>{m.name}</option>
        {/each}
      </select>
      <button class="mini" onclick={() => void session.retryThread(thread.id, effectiveModel)}>Retry</button>
      <button class="mini" onclick={() => void session.forkThread(thread.id)}>Fork</button>
    {/if}
    {#if thread.branch}
      {#if thread.status !== "running"}
        <button class="mini primary" title="Commit, push and open a PR" onclick={() => void session.landThread(thread.id)}>
          Commit & PR
        </button>
        <button class="mini" title="Snapshot the worktree as a restore point" onclick={() => void session.createCheckpoint(thread.id)}>
          Checkpoint
        </button>
      {/if}
      <button class="mini" onclick={() => void session.mergeThread(thread.id)}>Merge</button>
      <button class="mini danger" onclick={discard}>Discard</button>
    {/if}
  </div>
  {#if checkpoints.length > 1}
    <div class="acol-checkpoints">
      {#each checkpoints as cp (cp.sha)}
        <div class="cp">
          <code>{cp.sha}</code>
          <span class="cp-label" title={cp.label}>{cp.label}</span>
          <button class="mini" onclick={() => void session.restoreCheckpoint(thread.id, cp.sha)}>Restore</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .branch-pill {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--panel-2, #16161a);
    border: 1px solid var(--border, #2c2c33);
    color: var(--muted, #999);
  }
  .acol-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 8px;
    border-top: 1px solid var(--border, #2c2c33);
    flex-wrap: wrap;
  }
  .mini-select {
    flex: 1;
    min-width: 0;
    max-width: 160px;
    font-size: 11px;
    background: var(--panel-2, #16161a);
    color: var(--text, #e6e6e6);
    border: 1px solid var(--border, #2c2c33);
    border-radius: 6px;
    padding: 3px 6px;
  }
  .mini.danger {
    color: #e57373;
  }
  .mini.primary {
    background: var(--accent, #4f8cff);
    color: #fff;
    border-color: transparent;
  }
  .acol-checkpoints {
    max-height: 96px;
    overflow: auto;
    border-top: 1px solid var(--border, #2c2c33);
    padding: 4px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cp {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .cp code {
    color: var(--muted, #999);
  }
  .cp-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
