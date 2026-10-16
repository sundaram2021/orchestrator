<script lang="ts">
  import { session, harnessOf, allModels } from "../lib/session.svelte";
  import { ChevronDown, Star, Check } from "@lucide/svelte";
  import ProviderIcon from "./ProviderIcon.svelte";

  let open = $state(false);
  let level = $state<string>("");
  let search = $state("");

  const enabled = $derived(session.config?.harnesses.filter((h) => h.enabled) ?? []);
  const current = $derived(session.config?.model);
  const currentColor = $derived(harnessOf(current?.harness ?? "")?.color);

  const key = (harness: string, id: string): string => `${harness}::${id}`;
  const isFav = (harness: string, id: string): boolean => session.favorites.includes(key(harness, id));

  const levelHarness = $derived(harnessOf(level || current?.harness || "") ?? enabled[0]);
  const models = $derived(
    (levelHarness?.models ?? []).filter((m) => {
      const q = search.trim().toLowerCase();
      return !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    }),
  );
  const favModels = $derived(allModels().filter((m) => isFav(m.harness, m.id)));

  const toggleOpen = (): void => {
    if (!open) {
      level = current?.harness ?? enabled[0]?.id ?? "";
      search = "";
    }
    open = !open;
  };
  const close = (): void => {
    open = false;
  };
  const pick = async (harness: string, id: string, name: string): Promise<void> => {
    await session.selectModel({ harness, id, name });
    close();
  };
</script>

<svelte:window onclick={close} />

<div class="model-wrap">
  <button
    class="model-btn"
    aria-haspopup="true"
    onclick={(e) => {
      e.stopPropagation();
      toggleOpen();
    }}
  >
    <ProviderIcon id={current?.harness ?? ""} color={currentColor} size={16} />
    <span class="lbl">{current?.name ?? "select model"}</span>
    <ChevronDown size={13} class="caret" />
  </button>

  {#if open}
    <div class="mpop" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <div class="mpop-rail">
        {#each enabled as h (h.id)}
          <button class="rail-item" class:active={levelHarness?.id === h.id} title={h.name} onclick={() => (level = h.id)}>
            <ProviderIcon id={h.id} color={h.color} size={22} />
          </button>
        {/each}
      </div>

      <div class="mpop-main">
        <div class="mpop-head">
          <ProviderIcon id={levelHarness?.id ?? ""} color={levelHarness?.color} size={14} />
          {levelHarness?.name ?? "models"}
          <span class="spacer"></span>
          <span style="text-transform:none;letter-spacing:0">{levelHarness?.status}</span>
        </div>
        <div class="mpop-search">
          <input class="search" bind:value={search} placeholder="Search models…" />
        </div>
        <div class="mpop-list">
          {#if !search && favModels.length}
            <div class="subhead">Favorites</div>
            {#each favModels as m (m.harness + m.id)}
              {@render row(m.harness, m.id, m.name)}
            {/each}
            <div class="subhead">{levelHarness?.name ?? "Models"}</div>
          {/if}
          {#if models.length === 0}
            <div class="mpop-empty">No models match "{search}"</div>
          {:else}
            {#each models as m (m.id)}
              {@render row(levelHarness?.id ?? "", m.id, m.name)}
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#snippet row(harness: string, id: string, name: string)}
  <div
    class="mrow"
    role="button"
    tabindex="0"
    onclick={() => void pick(harness, id, name)}
    onkeydown={(e) => e.key === "Enter" && void pick(harness, id, name)}
  >
    <div class="col">
      <div class="nm">{name}</div>
      <div class="sub">{id}</div>
    </div>
    <button
      class="star"
      class:on={isFav(harness, id)}
      title={isFav(harness, id) ? "Unfavorite" : "Favorite"}
      onclick={(e) => {
        e.stopPropagation();
        session.toggleFavorite(key(harness, id));
      }}><Star size={14} fill={isFav(harness, id) ? "currentColor" : "none"} /></button
    >
    {#if current?.harness === harness && current?.id === id}
      <span class="check"><Check size={14} /></span>
    {/if}
  </div>
{/snippet}
