<script lang="ts">
  import type { ToolView } from "@orchestrator/contracts";
  import { ChevronDown, ChevronRight, X, Plug, RotateCcw, Copy, Check } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { fmtDuration } from "../lib/time";
  import { toolIcon, matchMcpServer, humanizeKey } from "../lib/tools";
  import { describeTool } from "../lib/toolPresentation";

  let { tool, retried = false }: { tool: ToolView; retried?: boolean } = $props();
  let open = $state(false);
  let copied = $state(false);

  const servers = $derived(session.config?.mcp ?? []);
  const server = $derived(matchMcpServer(tool.tool, servers));
  const presentation = $derived(describeTool(tool, { threads: session.threads, servers }));
  const Icon = $derived(server ? Plug : toolIcon(tool.tool));

  const pending = $derived(tool.ok === undefined);
  const failed = $derived(tool.ok === false && !retried);
  const hasBody = $derived(presentation.body.kind !== "none");

  const durationText = $derived(
    tool.startedAt && tool.endedAt ? fmtDuration(Math.max(0, tool.endedAt - tool.startedAt)) : "",
  );

  const argsText = $derived.by(() => {
    try {
      return JSON.stringify(JSON.parse(tool.args), null, 2);
    } catch {
      return tool.args;
    }
  });

  const bodyText = $derived.by(() => {
    const body = presentation.body;
    if (body.kind === "text") return body.text;
    if (body.kind === "list") return body.items.join("\n");
    if (body.kind === "fields") {
      return body.entries.map((entry) => `${humanizeKey(entry.key)}: ${entry.value}`).join("\n");
    }
    if (body.kind === "records") {
      return body.items
        .map((item) =>
          [item.title, item.url, item.snippet].filter(Boolean).join("\n"),
        )
        .join("\n\n");
    }
    return "";
  });

  const host = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  const copy = (): void => {
    void navigator.clipboard?.writeText(bodyText).then(() => {
      copied = true;
      setTimeout(() => (copied = false), 1200);
    });
  };
</script>

<div class="tool cat-{presentation.category}" class:failed class:retried={retried && tool.ok === false} class:running={pending}>
  <button class="tool-head" onclick={() => (open = !open)}>
    <span class="tico"><Icon size={13} strokeWidth={2} /></span>
    {#if server}<span class="mpill">{server}</span>{/if}
    <span class="tname">{presentation.action}</span>
    {#if presentation.target}<span class="tsum" title={presentation.target}>{presentation.target}</span>{/if}
    <span class="spacer"></span>
    {#if presentation.truncated}<span class="trunc">truncated</span>{/if}
    {#if pending}
      <span class="spinner"></span>
    {:else if failed}
      <span class="stat bad"><X size={12} /></span>
    {:else if retried}
      <span class="stat retried"><RotateCcw size={12} /> retried</span>
    {:else if presentation.preview}
      <span class="tprev">{presentation.preview}</span>
    {/if}
    {#if durationText}<span class="stat">{durationText}</span>{/if}
    {#if hasBody}
      <span class="chev">{#if open}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}</span>
    {/if}
  </button>
  {#if open && hasBody}
    <div class="tool-body" class:err={failed}>
      <div class="bodyhead">
        <span class="blabel">{presentation.truncated ? "Output (truncated)" : "Output"}</span>
        <button class="copy" onclick={copy}>
          {#if copied}<Check size={11} /> Copied{:else}<Copy size={11} /> Copy{/if}
        </button>
      </div>
      {#if presentation.body.kind === "records"}
        <div class="recs">
          {#each presentation.body.items as item, i (i)}
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
      {:else if presentation.body.kind === "fields"}
        <div class="fields">
          {#each presentation.body.entries as entry (entry.key)}
            <div class="field">
              <span class="fkey">{humanizeKey(entry.key)}</span>
              <span class="fval">{entry.value}</span>
            </div>
          {/each}
        </div>
      {:else if presentation.body.kind === "list"}
        <ul class="items">
          {#each presentation.body.items as item, i (i)}
            <li>{item}</li>
          {/each}
        </ul>
      {:else if presentation.body.kind === "text"}
        <pre class="raw">{presentation.body.text}</pre>
      {/if}
      {#if tool.args && tool.args !== "{}"}
        <details class="args">
          <summary>Arguments</summary>
          <pre>{argsText}</pre>
        </details>
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
  .tprev {
    font-size: 11px;
    color: var(--faint);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .trunc {
    font-size: 10px;
    font-weight: 600;
    color: var(--amber);
    border: 1px solid color-mix(in srgb, var(--amber) 30%, transparent);
    border-radius: 5px;
    padding: 1px 5px;
    flex-shrink: 0;
  }
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
  .bodyhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0 2px;
  }
  .blabel {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--faint);
  }
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 0;
    color: var(--faint);
    font-size: 11px;
    padding: 2px 4px;
  }
  .copy:hover {
    color: var(--text);
  }
  .raw {
    margin: 0;
    padding: 4px 0 2px;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--muted);
  }
  .tool-body.err .raw {
    color: color-mix(in srgb, var(--red) 78%, var(--muted));
  }
  .items {
    margin: 0;
    padding: 4px 0 2px 18px;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--muted);
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
    font-size: 11px;
  }
  .fval {
    color: var(--muted);
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .args {
    margin-top: 6px;
  }
  .args summary {
    cursor: pointer;
    font-size: 11px;
    color: var(--faint);
    user-select: none;
  }
  .args summary:hover {
    color: var(--muted);
  }
  .args pre {
    margin: 4px 0 0;
    max-height: 240px;
    overflow: auto;
    padding: 6px 8px;
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
