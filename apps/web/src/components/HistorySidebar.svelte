<script lang="ts">
  import { session, harnessName } from "../lib/session.svelte";

  let q = $state("");

  const filtered = $derived(
    session.threads.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())),
  );
  const running = $derived(filtered.filter((t) => t.status === "running"));
  const done = $derived(filtered.filter((t) => t.status !== "running"));

  const dot = (status: string) =>
    status === "running" ? "run" : status === "stopped" ? "stop" : status === "error" ? "err" : "";

  const select = (id: string) => {
    session.activeThreadId = id;
    document.getElementById(`col-${id}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };
</script>

<aside class="sidebar-right">
  <div class="side-head">
    <div class="row">
      <span class="side-title">History</span>
      <div class="spacer"></div>
    </div>
    <input class="search" bind:value={q} placeholder="Search agents…" />
  </div>
  <div class="list">
    {#if filtered.length === 0}
      <div class="empty" style="padding:8px">No agents found.</div>
    {:else}
      {#if running.length}
        <div class="hgroup">Running</div>
        {#each running as t (t.id)}
          <div class="hist" class:active={t.id === session.activeThreadId} role="button" tabindex="0" onclick={() => select(t.id)} onkeydown={(e) => e.key === "Enter" && select(t.id)}>
            <div class="t">{t.title}</div>
            <div class="m"><span class="sdot {dot(t.status)}"></span>{harnessName(t.harness)} · {t.model} · {t.status}</div>
          </div>
        {/each}
      {/if}
      {#if done.length}
        <div class="hgroup">History</div>
        {#each done as t (t.id)}
          <div class="hist" class:active={t.id === session.activeThreadId} role="button" tabindex="0" onclick={() => select(t.id)} onkeydown={(e) => e.key === "Enter" && select(t.id)}>
            <div class="t">{t.title}</div>
            <div class="m"><span class="sdot {dot(t.status)}"></span>{harnessName(t.harness)} · {t.model} · {t.status}</div>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</aside>
