<script lang="ts">
  import type { MessageView, ThreadView } from "@orchestrator/contracts";
  import { Brain, ChevronDown, ChevronRight, User, AlertTriangle, AlertCircle } from "@lucide/svelte";
  import { fmtDuration } from "../lib/time";
  import { harnessOf, harnessName } from "../lib/session.svelte";
  import { explainError } from "../lib/errorHints";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import ToolCall from "./ToolCall.svelte";
  import Logo from "./Logo.svelte";
  import ProviderIcon from "./ProviderIcon.svelte";

  let {
    message,
    thread,
    running = false,
    showAvatar = true,
  }: { message: MessageView; thread?: ThreadView; running?: boolean; showAvatar?: boolean } = $props();

  const subagent = $derived(!!thread && thread.kind !== "orchestrator");

  const hasReasoning = $derived(!!message.reasoning?.trim());
  const hasText = $derived(!!message.text.trim());
  const reasoningLive = $derived(running && hasReasoning && !hasText);

  const retried = $derived.by(() => {
    const out = new Set<string>();
    message.tools.forEach((t, i) => {
      if (t.ok !== false) return;
      if (message.tools.slice(i + 1).some((n) => n.tool === t.tool && n.ok === true)) {
        out.add(t.callId);
      }
    });
    return out;
  });

  const workedMs = $derived.by(() => {
    const starts = message.tools.map((t) => t.startedAt).filter((v): v is number => typeof v === "number");
    const ends = message.tools.map((t) => t.endedAt).filter((v): v is number => typeof v === "number");
    if (!starts.length || !ends.length) return null;
    return Math.max(0, Math.max(...ends) - Math.min(...starts));
  });
  const activityLabel = $derived(
    running && workedMs === null
      ? "Working…"
      : workedMs === null
        ? `${message.tools.length} steps`
        : `Worked for ${fmtDuration(workedMs)}`,
  );

  let showActivity = $state(false);
  $effect(() => {
    showActivity = running;
  });

  let showReasoning = $state(false);
  $effect(() => {
    showReasoning = reasoningLive;
  });
</script>

{#if message.role === "system"}
  {#if message.level === "error"}
    {@const explanation = explainError(message.text)}
    <div class="notice error">
      <div class="notice-head"><AlertTriangle size={13} /><span>{explanation.title}</span></div>
      <p class="notice-hint">{explanation.hint}</p>
      <details class="notice-details">
        <summary>Details</summary>
        <pre>{message.text}</pre>
      </details>
    </div>
  {:else if message.level === "warning"}
    <div class="notice warn">
      <div class="notice-head"><AlertCircle size={13} /><span>{message.text}</span></div>
      {#if message.details}
        <details class="notice-details">
          <summary>Details</summary>
          <pre>{message.details}</pre>
        </details>
      {/if}
    </div>
  {:else}
    <div class="msg sys">
      {message.text}
      {#if message.details}
        <details class="notice-details">
          <summary>Details</summary>
          <pre>{message.details}</pre>
        </details>
      {/if}
    </div>
  {/if}
{:else if message.role === "user"}
  <div class="mrow user">
    <div class="msg user">{message.text}</div>
    {#if showAvatar}
      {#if subagent && thread}
        <span class="av av-user" title="Orchestrator"><Logo flat size={18} /></span>
      {:else}
        <span class="av av-user" title="You"><User size={14} /></span>
      {/if}
    {:else}
      <span class="av-spacer"></span>
    {/if}
  </div>
{:else}
  <div class="mrow asst">
    {#if showAvatar}
      {#if subagent && thread}
        <span class="av av-asst" title={harnessName(thread.harness)}>
          <ProviderIcon id={thread.harness} color={harnessOf(thread.harness)?.color} size={16} />
        </span>
      {:else}
        <span class="av av-asst" title="Orchestrator"><Logo flat size={18} /></span>
      {/if}
    {:else}
      <span class="av-spacer"></span>
    {/if}
    <div class="msg asst">
      {#if hasReasoning}
        <div class="think" class:live={reasoningLive}>
          <button class="think-head" onclick={() => (showReasoning = !showReasoning)}>
            <span class="chev">{#if showReasoning}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}</span>
            <Brain size={13} />
            <span class="tlabel">{reasoningLive ? "Thinking" : "Thought process"}</span>
            {#if reasoningLive}<span class="dots"><i></i><i></i><i></i></span>{/if}
          </button>
          {#if showReasoning}
            <div class="think-body">
              <span class="prose">{message.reasoning}</span>{#if reasoningLive}<span class="caret"></span>{/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if message.tools.length}
        <div class="act">
          <button class="act-head" onclick={() => (showActivity = !showActivity)}>
            <span class="chev">{#if showActivity}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}</span>
            <span class="alabel">{activityLabel}</span>
            {#if running && workedMs === null}<span class="dots"><i></i><i></i><i></i></span>{/if}
          </button>
          {#if showActivity}
            <div class="act-list">
              {#each message.tools as tool (tool.callId)}
                <ToolCall {tool} retried={retried.has(tool.callId)} />
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if hasText}
        <MarkdownPreview source={message.text} />
      {:else if reasoningLive && !hasReasoning}
        <div class="thinking-line"><span class="dots"><i></i><i></i><i></i></span> working…</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .av-spacer {
    flex-shrink: 0;
    width: 26px;
  }
  .think {
    border: 1px solid var(--border-soft);
    border-left: 2px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface) 60%, transparent);
    overflow: hidden;
    transition: border-color 0.2s;
  }
  .think.live {
    border-left-color: var(--accent);
  }
  .think-head {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 7px 11px;
    background: transparent;
    border: 0;
    color: var(--muted);
    font-size: 12px;
    text-align: left;
  }
  .think-head .chev {
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .think-head .tlabel {
    font-weight: 500;
  }
  .think-body {
    padding: 2px 13px 10px 30px;
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 260px;
    overflow: auto;
  }
  .caret {
    display: inline-block;
    width: 6px;
    height: 13px;
    margin-left: 1px;
    vertical-align: -2px;
    background: var(--accent);
    animation: caret 1s steps(2) infinite;
  }
  @keyframes caret {
    50% {
      opacity: 0;
    }
  }
  .act {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .act-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: transparent;
    border: 0;
    padding: 2px 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    text-align: left;
  }
  .act-head .chev {
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .act-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 0 2px 4px;
    margin-left: 5px;
    border-left: 1px solid var(--border-soft);
  }
  .thinking-line {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--faint);
    font-size: 12.5px;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
    align-items: center;
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
  .notice {
    border-radius: 10px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    font-size: 12.5px;
  }
  .notice.error {
    border-color: color-mix(in srgb, var(--red) 34%, transparent);
    background: color-mix(in srgb, var(--red) 7%, transparent);
  }
  .notice.warn {
    border-color: color-mix(in srgb, var(--amber) 34%, transparent);
    background: color-mix(in srgb, var(--amber) 7%, transparent);
  }
  .notice-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--text);
  }
  .notice.error .notice-head {
    color: color-mix(in srgb, var(--red) 82%, var(--text));
  }
  .notice.warn .notice-head {
    color: color-mix(in srgb, var(--amber) 82%, var(--text));
  }
  .notice-hint {
    margin: 4px 0 0 20px;
    color: var(--muted);
    line-height: 1.55;
  }
  .notice-details {
    margin: 6px 0 0 20px;
  }
  .msg.sys .notice-details {
    margin-left: 0;
  }
  .notice-details summary {
    cursor: pointer;
    font-size: 11px;
    color: var(--faint);
    user-select: none;
  }
  .notice-details summary:hover {
    color: var(--muted);
  }
  .notice-details pre {
    margin: 4px 0 0;
    max-height: 220px;
    overflow: auto;
    padding: 7px 9px;
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
