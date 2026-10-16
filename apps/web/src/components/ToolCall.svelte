<script lang="ts">
  import type { ToolView } from "@orchestrator/contracts";
  import { ChevronDown, ChevronRight, Check, X, Plug } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { toolCategory, toolIcon, toolAction, toolSummary, toolLabel, matchMcpServer, mcpLeaf } from "../lib/tools";

  let { tool }: { tool: ToolView } = $props();
  let open = $state(false);

  const servers = $derived(session.config?.mcp ?? []);
  const server = $derived(matchMcpServer(tool.tool, servers));
  const Icon = $derived(server ? Plug : toolIcon(tool.tool));
  const cat = $derived(server ? "mcp" : toolCategory(tool.tool));
  const action = $derived(server ? toolLabel(mcpLeaf(tool.tool, server!)) : toolAction(tool.tool));
  const target = $derived(toolSummary(tool.tool, tool.args));

  const pending = $derived(tool.ok === undefined);
  const failed = $derived(tool.ok === false);

  const duration = $derived(tool.startedAt && tool.endedAt ? Math.max(0, tool.endedAt - tool.startedAt) : null);
  const durationText = $derived(duration === null ? "" : duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`);

  const argsText = $derived(
    (() => {
      try {
        return JSON.stringify(JSON.parse(tool.args) as unknown, null, 2);
      } catch {
        return tool.args;
      }
    })(),
  );
</script>

<div class="tool cat-{cat}" class:failed class:running={pending}>
  <button class="tool-head" onclick={() => (open = !open)}>
    <span class="tico"><Icon size={13} strokeWidth={2} /></span>
    {#if server}
      <span class="mpill">{server}</span>
      <span class="tname">{action}</span>
    {:else}
      <span class="tname">{action}</span>
    {/if}
    {#if target}<span class="tsum">{target}</span>{/if}
    <span class="spacer"></span>
    {#if pending}
      <span class="spinner"></span>
    {:else if failed}
      <span class="stat bad"><X size={12} /> {durationText || "failed"}</span>
    {:else}
      <span class="stat ok"><Check size={12} /> {durationText}</span>
    {/if}
    <span class="chev">{#if open}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}</span>
  </button>
  {#if open}
    <div class="tool-body">
      <div class="lbl">{server ? "mcp tool" : "arguments"}</div>
      <pre>{argsText}</pre>
      {#if tool.result !== undefined}
        <div class="lbl">result</div>
        <pre class:err={failed}>{tool.result}</pre>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    border: 1px solid var(--border-soft);
    border-radius: 9px;
    background: var(--surface);
    overflow: hidden;
  }
  .tool.running {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-soft));
  }
  .tool.failed {
    border-color: color-mix(in srgb, var(--red) 45%, var(--border-soft));
  }
  .tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    background: transparent;
    border: 0;
    text-align: left;
  }
  .tool-head:hover {
    background: var(--surface-2);
  }
  .tico {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border-soft);
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
  .tname {
    font-size: 12.5px;
    color: var(--text);
    font-weight: 500;
    flex-shrink: 0;
  }
  .mpill {
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
    color: var(--faint);
    font-family: var(--mono);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .stat.ok { color: var(--green); }
  .stat.bad { color: var(--red); }
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
    border-top: 1px solid var(--border-soft);
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .tool-body .lbl {
    font-size: 10px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--faint);
  }
  .tool-body pre {
    margin: 0;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--muted);
    background: var(--canvas);
    border: 1px solid var(--border-soft);
    border-radius: 7px;
    padding: 8px 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 240px;
    overflow: auto;
  }
  .tool-body pre.err {
    color: var(--red);
  }
</style>
