<script lang="ts">
  import { session, harnessOf } from "../lib/session.svelte";

  let open = $state(false);
  let level = $state<string | null>(null);
  let search = $state("");

  const enabled = $derived(session.config?.harnesses.filter((h) => h.enabled) ?? []);
  const current = $derived(session.config?.model);
  const dotColor = $derived(harnessOf(current?.harness ?? "")?.color ?? "var(--muted)");

  const levelHarness = $derived(level ? harnessOf(level) : undefined);

  const openMenu = () => {
    level = null;
    search = "";
    open = true;
  };
  const close = () => {
    open = false;
  };

  const pickHarness = (id: string) => {
    level = id;
    search = "";
  };

  const pickModel = async (harnessId: string, id: string, name: string) => {
    await session.selectModel({ harness: harnessId, id, name });
    close();
  };

  const filteredModels = $derived(
    (levelHarness?.models ?? []).filter((m) => {
      const q = search.trim().toLowerCase();
      return !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    }),
  );
</script>

<svelte:window onclick={close} />

<div class="model-wrap">
  <button
    class="model-btn"
    aria-haspopup="true"
    onclick={(e) => {
      e.stopPropagation();
      open ? close() : openMenu();
    }}
  >
    <span class="hdot" style="background:{dotColor}"></span>
    <span class="lbl">{current?.name ?? "select model"}</span>
    <span style="color:var(--muted)">▾</span>
  </button>

  {#if open}
    <div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      {#if !level}
        <div class="menu-head">Select harness</div>
        <div class="menu-list">
          {#each enabled as h (h.id)}
            <div class="mi" role="button" tabindex="0" onclick={() => pickHarness(h.id)} onkeydown={(e) => e.key === "Enter" && pickHarness(h.id)}>
              <span class="hdot" style="background:{h.color}"></span>
              <div style="flex:1;min-width:0">
                <div>{h.name}</div>
                <div class="sub2">{h.status} · {h.models.length} models</div>
              </div>
              <span class="chev">›</span>
            </div>
          {/each}
        </div>
      {:else if levelHarness}
        <div class="menu-head">
          <button class="back" title="Back" onclick={() => (level = null)}>‹</button>
          <span class="hdot" style="background:{levelHarness.color}"></span>
          <span style="color:var(--text)">{levelHarness.name}</span>
        </div>
        <div class="menu-search">
          <input class="search" bind:value={search} placeholder="Search models…" />
        </div>
        <div class="menu-list">
          {#if filteredModels.length === 0}
            <div class="menu-empty">No models match "{search}"</div>
          {:else}
            {#each filteredModels as m (m.id)}
              <div
                class="mi"
                class:sel={current?.harness === levelHarness.id && current?.id === m.id}
                role="button"
                tabindex="0"
                onclick={() => void pickModel(levelHarness.id, m.id, m.name)}
                onkeydown={(e) => e.key === "Enter" && void pickModel(levelHarness.id, m.id, m.name)}
              >
                <div style="flex:1;min-width:0">
                  <div>{m.name}</div>
                  <div class="sub2">{m.id}</div>
                </div>
                {#if current?.harness === levelHarness.id && current?.id === m.id}
                  <span class="check">✓</span>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
