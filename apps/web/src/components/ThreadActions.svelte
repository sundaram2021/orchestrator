<script lang="ts">
  import type { ThreadView } from "@orchestrator/contracts";
  import { Square, Play, RotateCcw, GitFork, GitPullRequest, GitMerge, Trash2 } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";

  let { thread, onaction }: { thread: ThreadView; onaction?: () => void } = $props();
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

  const run = (fn: () => void): void => {
    fn();
    onaction?.();
  };

  const discard = (): void => {
    const sub = descendants > 0 ? ` and its ${descendants} sub-agent${descendants === 1 ? "" : "s"}` : "";
    const detail = thread.branch ? " Branches and worktrees will be removed." : "";
    if (confirm(`Delete this chat${sub}?${detail}`)) run(() => void session.discardThread(thread.id));
  };
</script>

{#if thread.kind === "orchestrator"}
  <div class="subhead" style="padding:8px 10px">The orchestrator is always available.</div>
{:else}
  {#if thread.status === "running"}
    <button class="aitem" title="Stop this agent" onclick={() => run(() => void session.stop(thread.id))}>
      <Square size={14} /> Stop
    </button>
  {:else}
    {#if thread.status === "stopped"}
      <button class="aitem" title="Continue this agent" onclick={() => run(() => void session.continueThread(thread.id))}>
        <Play size={14} /> Continue
      </button>
    {/if}
    <button class="aitem" onclick={() => run(() => void session.retryThread(thread.id))}><RotateCcw size={14} /> Retry</button>
    <button class="aitem" onclick={() => run(() => void session.forkThread(thread.id))}><GitFork size={14} /> Fork</button>
  {/if}
{/if}

{#if thread.branch}
  <div class="asep"></div>
  {#if thread.status !== "running"}
    <button class="aitem" onclick={() => run(() => void session.landThread(thread.id))}><GitPullRequest size={14} /> Commit &amp; PR</button>
    <button class="aitem" onclick={() => run(() => void session.mergeThread(thread.id))}><GitMerge size={14} /> Merge</button>
  {/if}
{/if}

{#if thread.kind !== "orchestrator"}
  <div class="asep"></div>
  <button class="aitem danger" onclick={discard}><Trash2 size={14} /> Delete chat</button>
{/if}
