<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { Square, RotateCcw, GitFork, GitPullRequest, Flag, GitMerge, Trash2, History } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";

  let { thread, onaction }: { thread: ThreadView; onaction?: () => void } = $props();
  const checkpoints = $derived(session.checkpoints[thread.id] ?? []);
  const descendants = $derived.by(() => {
    const ids = new Set([thread.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const other of session.threads) {
        if (other.parentId && ids.has(other.parentId) && !ids.has(other.id)) {
          ids.add(other.id);
          changed = true;
        }
      }
    }
    return ids.size - 1;
  });

  $effect(() => {
    if (thread.branch) void session.loadCheckpoints(thread.id);
  });

  const run = (fn: () => void): void => {
    fn();
    onaction?.();
  };

  const discard = (): void => {
    const sub = descendants > 0 ? ` and its ${descendants} sub-agent${descendants === 1 ? "" : "s"}` : "";
    const detail = thread.branch ? " Branches and worktrees will be removed." : "";
    if (confirm(`Delete this chat${sub}?${detail}`)) run(() => void session.discardThread(thread.id));
  };
  const restore = (sha: string): void => {
    void session.restoreCheckpoint(thread.id, sha);
  };
</script>

{#if thread.kind === "orchestrator"}
  <div class="subhead" style="padding:8px 10px">The orchestrator is always available.</div>
{:else if thread.status === "running"}
  <button class="aitem" onclick={() => run(() => void session.stop(thread.id))}><Square size={14} /> Stop</button>
{:else}
  <button class="aitem" onclick={() => run(() => void session.retryThread(thread.id))}><RotateCcw size={14} /> Retry</button>
  <button class="aitem" onclick={() => run(() => void session.forkThread(thread.id))}><GitFork size={14} /> Fork</button>
{/if}

{#if thread.branch}
  <div class="asep"></div>
  {#if thread.status !== "running"}
    <button class="aitem" onclick={() => run(() => void session.landThread(thread.id))}><GitPullRequest size={14} /> Commit &amp; PR</button>
    <button class="aitem" onclick={() => run(() => void session.createCheckpoint(thread.id))}><Flag size={14} /> Checkpoint</button>
    <button class="aitem" onclick={() => run(() => void session.mergeThread(thread.id))}><GitMerge size={14} /> Merge</button>
  {/if}
  {#if checkpoints.length > 1}
    <div class="asep"></div>
    <div class="subhead" style="padding:6px 10px 2px"><History size={11} /> Checkpoints</div>
    {#each checkpoints as cp (cp.sha)}
      <button class="aitem" title={cp.label} onclick={() => restore(cp.sha)}>
        <code class="mono" style="color:var(--faint);font-size:11px">{cp.sha}</code>
        Restore
      </button>
    {/each}
  {/if}
{/if}

{#if thread.kind !== "orchestrator"}
  <div class="asep"></div>
  <button class="aitem danger" onclick={discard}><Trash2 size={14} /> Delete chat</button>
{/if}
