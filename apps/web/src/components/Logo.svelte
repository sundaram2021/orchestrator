<script lang="ts">
  interface Props {
    size?: number;
    wordmark?: boolean;
    flat?: boolean;
  }
  let { size = 22, wordmark = false, flat = false }: Props = $props();

  const gid = `orch-${Math.random().toString(36).slice(2, 8)}`;
</script>

<span class="logo" style="--s:{size}px">
  {#if flat}
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stop-color="var(--accent)" />
          <stop offset="1" stop-color="var(--purple)" />
        </linearGradient>
      </defs>
      <path d="M3 17.2c2.6-7.2 6-10.4 9-10.4s6.4 3.2 9 10.4" stroke="url(#{gid})" stroke-width="2.1" stroke-linecap="round" />
      <circle cx="4.6" cy="14.4" r="1.8" fill="url(#{gid})" />
      <circle cx="12" cy="7" r="1.8" fill="url(#{gid})" />
      <circle cx="19.4" cy="14.4" r="1.8" fill="url(#{gid})" />
      <path d="M12 2.6v2.2" stroke="url(#{gid})" stroke-width="2.1" stroke-linecap="round" />
    </svg>
  {:else}
    <span class="tile">
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 17.2c2.6-7.2 6-10.4 9-10.4s6.4 3.2 9 10.4" stroke="#fff" stroke-width="2.1" stroke-linecap="round" />
        <circle cx="4.6" cy="14.4" r="1.8" fill="#fff" />
        <circle cx="12" cy="7" r="1.8" fill="#fff" />
        <circle cx="19.4" cy="14.4" r="1.8" fill="#fff" />
        <path d="M12 2.6v2.2" stroke="#fff" stroke-width="2.1" stroke-linecap="round" />
      </svg>
    </span>
  {/if}
  {#if wordmark}<span class="wm">orchestrator</span>{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .tile {
    width: var(--s);
    height: var(--s);
    border-radius: calc(var(--s) * 0.28);
    background: linear-gradient(135deg, var(--accent), var(--purple));
    display: grid;
    place-items: center;
    box-shadow: 0 2px 8px rgba(61, 110, 245, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
    flex-shrink: 0;
  }
  .wm {
    font-weight: 650;
    font-size: 12.5px;
    letter-spacing: 0.2px;
    color: var(--text);
  }
</style>
