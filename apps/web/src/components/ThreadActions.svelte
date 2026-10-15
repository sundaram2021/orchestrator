<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { session, allModels } from "../lib/session.svelte";

  let { thread }: { thread: ThreadView } = $props();
  let retryModel = $state("");
  const effectiveModel = $derived(retryModel || thread.model);
  const models = $derived(allModels());
  const checkpoints = $derived(session.checkpoints[thread.id] ?? []);

  $effect(() => {
    if (thread.branch) void session.loadCheckpoints(thread.id);
  });

  const discard = (): void => {
    if (confirm("Discard this agent, its branch and worktree?")) void session.discardThread(thread.id);
  };
</script>

<div class="thread-actions">
  {#if thread.status === "running"}
    <button class="mini" onclick={() => void session.stop(thread.id)}>Stop</button>
  {:else}
    <select class="mini-select" bind:value={retryModel} title="Model for retry">
      <option value="">{thread.model} (current)</option>
      {#each models as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
    </select>
    <button class="mini" onclick={() => void session.retryThread(thread.id, effectiveModel)}>Retry</button>
    <button class="mini" onclick={() => void session.forkThread(thread.id)}>Fork</button>
  {/if}
  {#if thread.branch}
    {#if thread.status !== "running"}
      <button class="mini primary" title="Commit, push and open a PR" onclick={() => void session.landThread(thread.id)}>
        Commit &amp; PR
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
  <div class="cp-wrap">
    {#each checkpoints as cp (cp.sha)}
      <div class="checkpoint">
        <code>{cp.sha}</code>
        <span class="lbl" title={cp.label}>{cp.label}</span>
        <button class="mini" onclick={() => void session.restoreCheckpoint(thread.id, cp.sha)}>Restore</button>
      </div>
    {/each}
  </div>
{/if}
