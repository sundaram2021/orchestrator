<script lang="ts">
  import { onMount } from "svelte";
  import { session, runningCount } from "../lib/session.svelte";
  import AgentColumn from "./AgentColumn.svelte";

  const running = $derived(runningCount());

  const COL_W = 340;
  const GAP = 12;
  const SLOT = COL_W + GAP;
  const OVERSCAN = 2;

  let scroller = $state<HTMLDivElement | null>(null);
  let scrollLeft = $state(0);
  let viewport = $state(0);

  const count = $derived(session.threads.length);
  const start = $derived(Math.max(0, Math.floor(scrollLeft / SLOT) - OVERSCAN));
  const end = $derived(Math.min(count, Math.ceil((scrollLeft + viewport) / SLOT) + OVERSCAN));
  const visible = $derived(session.threads.slice(start, end));
  const before = $derived(start > 0 ? start * SLOT - GAP : 0);
  const after = $derived(end < count ? (count - end) * SLOT - GAP : 0);

  onMount(() => {
    const el = scroller;
    if (!el) return;
    const measure = (): void => {
      viewport = el.clientWidth;
      scrollLeft = el.scrollLeft;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  });
</script>

<div class="agent-area">
  <div class="agent-head">
    <h2>Agents</h2>
    <span class="badge" class:ok={running > 0}>{running} running · {count} total</span>
    <div class="spacer"></div>
    <button class="btn ghost" onclick={() => void session.clearFinished()}>Clear finished</button>
  </div>
  <div class="agent-cols" bind:this={scroller}>
    {#if count === 0}
      <div class="agent-empty">
        No agents yet. Type an instruction in the chat below and press Enter. Each instruction starts its own agent here.
      </div>
    {:else}
      {#if before > 0}<div class="vpad" style="flex:0 0 {before}px"></div>{/if}
      {#each visible as thread (thread.id)}
        <AgentColumn {thread} />
      {/each}
      {#if after > 0}<div class="vpad" style="flex:0 0 {after}px"></div>{/if}
    {/if}
  </div>
</div>

<style>
  .vpad {
    flex-shrink: 0;
  }
</style>
