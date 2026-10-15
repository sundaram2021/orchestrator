<script lang="ts">
  import { session, harnessOf, harnessName } from "../lib/session.svelte";

  let q = $state("");
  const filtered = $derived(
    session.threads.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())),
  );
  const running = $derived(filtered.filter((t) => t.status === "running"));
  const done = $derived(filtered.filter((t) => t.status !== "running"));

  const dotClass = (s: string): string =>
    s === "running" ? "run" : s === "stopped" ? "stop" : s === "error" ? "err" : "";
</script>

<aside class="threads">
  <div class="panel-head">
    Threads
    <span class="spacer"></span>
    <button class="icon-btn" title="Clear finished agents" onclick={() => void session.clearFinished()}>⌫</button>
  </div>
  <div class="pad">
    <input class="search" bind:value={q} placeholder="Search agents…" />
  </div>
  <div class="thread-list">
    {#if filtered.length === 0}
      <div class="empty" style="padding:8px">{q ? "No matches." : "No agents yet."}</div>
    {:else}
      {#if running.length}
        <div class="hgroup">Running</div>
        {#each running as t (t.id)}
          <button class="tcard" class:active={t.id === session.activeThreadId} onclick={() => session.selectThread(t.id)}>
            <span class="t" title={t.title}>{t.title}</span>
            <span class="m">
              <span class="sdot {dotClass(t.status)}"></span>
              <span class="hdot" style="background:{harnessOf(t.harness)?.color ?? 'var(--muted)'}"></span>
              <span class="txt">{harnessName(t.harness)} · {t.model}</span>
            </span>
            {#if t.branch}
              <span class="m"><span class="pill"><span class="txt">{t.branch}</span></span></span>
            {/if}
          </button>
        {/each}
      {/if}
      {#if done.length}
        <div class="hgroup">History</div>
        {#each done as t (t.id)}
          <button class="tcard" class:active={t.id === session.activeThreadId} onclick={() => session.selectThread(t.id)}>
            <span class="t" title={t.title}>{t.title}</span>
            <span class="m">
              <span class="sdot {dotClass(t.status)}"></span>
              <span class="hdot" style="background:{harnessOf(t.harness)?.color ?? 'var(--muted)'}"></span>
              <span class="txt">{harnessName(t.harness)} · {t.model}</span>
            </span>
            {#if t.branch}
              <span class="m"><span class="pill"><span class="txt">{t.branch}</span></span></span>
            {/if}
          </button>
        {/each}
      {/if}
    {/if}
  </div>
</aside>
