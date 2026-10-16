<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ThreadView } from "@orchestrator/contracts";
  import { Square } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { toolActivity, toolSummary, matchMcpServer, mcpLeaf } from "../lib/tools";

  let { thread }: { thread: ThreadView } = $props();

  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const servers = $derived(session.config?.mcp ?? []);
  const lastAssistant = $derived(
    [...thread.messages].reverse().find((m) => m.role === "assistant"),
  );
  const pendingTool = $derived(lastAssistant?.tools.find((t) => t.ok === undefined));
  const toolCount = $derived(thread.messages.reduce((n, m) => n + m.tools.length, 0));

  const activity = $derived(
    pendingTool
      ? toolActivity(pendingTool.tool)
      : lastAssistant?.text?.trim()
        ? "Composing response"
        : "Thinking",
  );

  const detail = $derived.by(() => {
    if (pendingTool) {
      const s = matchMcpServer(pendingTool.tool, servers);
      const target = toolSummary(pendingTool.tool, pendingTool.args);
      const leaf = s ? mcpLeaf(pendingTool.tool, s) : "";
      return [s, leaf, target].filter(Boolean).join(" · ");
    }
    const r = lastAssistant?.reasoning?.trim();
    if (!r || lastAssistant?.text?.trim()) return "";
    const oneLine = r.replace(/\s+/g, " ");
    return oneLine.length > 180 ? `…${oneLine.slice(-180)}` : oneLine;
  });

  const elapsed = $derived.by(() => {
    const ms = Math.max(0, now - thread.createdAt);
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
</script>

<div class="live-wrap" class:err={thread.status === "error"}>
  <div class="live">
    <span class="ring"></span>
    <span class="what">{activity}</span>
    <span class="dots"><i></i><i></i><i></i></span>
    <span class="spacer"></span>
    <span class="stat">{toolCount} tool{toolCount === 1 ? "" : "s"} · {elapsed}</span>
    <button class="stop" title="Stop agent" onclick={() => void session.stop(thread.id)}>
      <Square size={12} fill="currentColor" />
      Stop
    </button>
  </div>
  {#if detail}
    <div class="detail">{detail}</div>
  {/if}
</div>

<style>
  .live-wrap {
    background: linear-gradient(90deg, rgba(61, 110, 245, 0.1), rgba(61, 110, 245, 0.02));
    border-bottom: 1px solid var(--border-soft);
    flex-shrink: 0;
  }
  .live-wrap.err {
    background: linear-gradient(90deg, rgba(242, 109, 109, 0.12), transparent);
  }
  .live {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 16px;
    font-size: 12px;
    color: var(--text);
  }
  .detail {
    padding: 0 16px 8px 37px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ring {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--accent-soft);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .live-wrap.err .ring {
    border-top-color: var(--red);
    animation: none;
    background: var(--red);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .what {
    font-weight: 500;
  }
  .stat {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .stop {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .stop:hover {
    color: var(--red);
    border-color: rgba(242, 109, 109, 0.4);
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
    animation: blink 1.2s infinite ease-in-out both;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }
</style>
