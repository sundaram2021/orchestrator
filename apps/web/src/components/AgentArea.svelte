<script lang="ts">
  import { session, runningCount } from "../lib/session.svelte";
  import AgentColumn from "./AgentColumn.svelte";

  const running = $derived(runningCount());
</script>

<div class="agent-area">
  <div class="agent-head">
    <h2>Agents</h2>
    <span class="badge" class:ok={running > 0}>{running} running · {session.threads.length} total</span>
    <div class="spacer"></div>
    <button class="btn ghost" onclick={() => void session.clearFinished()}>Clear finished</button>
  </div>
  <div class="agent-cols">
    {#if session.threads.length === 0}
      <div class="agent-empty">
        No agents yet. Type an instruction in the chat below and press Enter. Each instruction starts its own agent here.
      </div>
    {:else}
      {#each session.threads as thread (thread.id)}
        <AgentColumn {thread} />
      {/each}
    {/if}
  </div>
</div>
