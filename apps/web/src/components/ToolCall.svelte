<script lang="ts">
  import type { ToolView } from "@orchestrator/contracts";
  import { ChevronDown, ChevronRight, X, Plug, RotateCcw } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { fmtDuration } from "../lib/time";
  import {
    toolCategory,
    toolIcon,
    toolAction,
    toolSummary,
    toolLabel,
    matchMcpServer,
    mcpLeaf,
    parseToolResult,
  } from "../lib/tools";
  import MarkdownPreview from "./MarkdownPreview.svelte";

  let { tool, retried = false }: { tool: ToolView; retried?: boolean } = $props();
  let open = $state(false);

  const servers = $derived(session.config?.mcp ?? []);
  const server = $derived(matchMcpServer(tool.tool, servers));
  const Icon = $derived(server ? Plug : toolIcon(tool.tool));
  const cat = $derived(server ? "mcp" : toolCategory(tool.tool));
  const action = $derived(server ? toolLabel(mcpLeaf(tool.tool, server!)) : toolAction(tool.tool));
  const target = $derived(toolSummary(tool.tool, tool.args));

  const pending = $derived(tool.ok === undefined);
  const failed = $derived(tool.ok === false && !retried);

  const durationText = $derived(
    tool.startedAt && tool.endedAt ? fmtDuration(Math.max(0, tool.endedAt - tool.startedAt)) : "",
  );

  const result = $derived(parseToolResult(tool.result));
  const host = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
</script>

<div class="tool cat-{cat}" class:failed class:retried={retried && tool.ok === false} class:running={pending}>
  <button class="tool-head" onclick={() => (open = !open)}>
    <span class="tico"><Icon size={13} strokeWidth={2} /></span>
    {#if server}<span class="mpill">{server}</span>{/if}
    <span class="tname">{action}</span>
    {#if target}<span class="tsum">{target}</span>{/if}
    <span class="spacer"></span>
    {#if pending}
      <span class="spinner"></span>
    {:else if failed}
      <span class="stat bad"><X size={12} /></span>
    {:else if retried}
      <span class="stat retried"><RotateCcw size={12} /> retried</span>
    {:else if durationText}
      <span class="stat">{durationText}</span>
    {/if}
    {#if result.kind !== "empty"}
      <span class="chev">{#if open}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}</span>
    {/if}
  </button>
  {#if open && result.kind !== "empty"}
    <div class="tool-body" class:err={failed}>
      {#if result.kind === "records"}
        <div class="recs">
          {#each result.items as item, i (i)}
            <div class="rec">
              {#if item.url}
                <a class="rec-link" href={item.url} target="_blank" rel="noopener noreferrer">
                  <span class="rec-title">{item.title}</span>
                  <span class="rec-host">{host(item.url)}</span>
                </a>
              {:else}
                <span class="rec-title">{item.title}</span>
              {/if}
              {#if item.snippet}<p class="rec-snippet">{item.snippet}</p>{/if}
            </div>
          {/each}
        </div>
      {:else if result.kind === "fields"}
        <div class="fields">
          {#each result.entries as entry (entry.key)}
            <div class="field">
              <span class="fkey">{entry.key}</span>
              <span class="fval">{entry.value}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="out">
          <MarkdownPreview source={result.text} />
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    border-radius: 7px;
  }
  .tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    background: transparent;
    border: 0;
    text-align: left;
  }
  .tico {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    color: var(--muted);
    flex-shrink: 0;
  }
  .cat-run .tico { color: var(--green); }
  .cat-read .tico { color: #6aa9ff; }
  .cat-write .tico { color: var(--amber); }
  .cat-search .tico { color: var(--purple); }
  .cat-web .tico { color: #57c9d4; }
  .cat-agent .tico { color: var(--accent); }
  .cat-mcp .tico { color: var(--amber); }
  .tool.running .tico { color: var(--accent); }
  .tool.failed .tico { color: var(--red); }
  .tool.retried .tico { color: var(--muted); }
  .tname {
    font-size: 12.5px;
    color: var(--text);
    font-weight: 600;
    flex-shrink: 0;
  }
  .mpill {
    display: inline-flex;
    align-items: center;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--amber);
    background: color-mix(in srgb, var(--amber) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--amber) 30%, transparent);
    border-radius: 5px;
    padding: 1px 6px;
    flex-shrink: 0;
  }
  .tsum {
    color: var(--muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .stat.bad { color: var(--red); }
  .stat.retried { color: var(--muted); }
  .chev {
    display: grid;
    place-items: center;
    color: var(--faint);
    flex-shrink: 0;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--accent-soft);
    border-top-color: var(--accent);
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .tool-body {
    margin: 2px 0 6px 8px;
    padding-left: 14px;
    border-left: 1px solid var(--border-soft);
    min-width: 0;
  }
  .recs {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rec {
    padding: 5px 0;
  }
  .rec + .rec {
    border-top: 1px solid var(--border-soft);
  }
  .rec-link {
    display: flex;
    align-items: baseline;
    gap: 8px;
    text-decoration: none;
  }
  .rec-title {
    font-size: 12.5px;
    color: var(--text);
    font-weight: 560;
  }
  .rec-link:hover .rec-title {
    color: var(--accent);
  }
  .rec-host {
    font-size: 11px;
    color: var(--faint);
    flex-shrink: 0;
  }
  .rec-snippet {
    margin: 2px 0 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--muted);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px 0;
  }
  .field {
    display: grid;
    grid-template-columns: minmax(80px, 160px) 1fr;
    gap: 10px;
    font-size: 12px;
    align-items: baseline;
  }
  .fkey {
    color: var(--faint);
    font-family: var(--mono);
    font-size: 11px;
  }
  .fval {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .out {
    padding: 4px 0 2px;
    max-height: 420px;
    overflow: auto;
    font-size: 12.5px;
  }
  .out :global(.md) {
    max-width: none;
    font-size: 12.5px;
  }
  .tool-body.err .out :global(.md) {
    color: var(--red);
  }
</style>
