<script lang="ts">
  import type { MessageView } from "@orchestrator/contracts";
  import { Brain, ChevronDown, ChevronRight, Activity, Plug, User } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { matchMcpServer } from "../lib/tools";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import ToolCall from "./ToolCall.svelte";
  import Logo from "./Logo.svelte";

  let { message, running = false }: { message: MessageView; running?: boolean } = $props();

  const hasReasoning = $derived(!!message.reasoning?.trim());
  const hasText = $derived(!!message.text.trim());
  const reasoningLive = $derived(running && hasReasoning && !hasText);

  const mcpServers = $derived(
    [...new Set(message.tools.map((t) => matchMcpServer(t.tool, session.config?.mcp ?? [])).filter((s): s is string => !!s))],
  );

  let showReasoning = $state(true);
  $effect(() => {
    if (reasoningLive) showReasoning = true;
    else if (hasText) showReasoning = false;
  });
</script>

{#if message.role === "system"}
  <div class="msg sys">{message.text}</div>
{:else if message.role === "user"}
  <div class="mrow user">
    <div class="msg user">{message.text}</div>
    <span class="av av-user" title="You"><User size={14} /></span>
  </div>
{:else}
  <div class="mrow asst">
    <span class="av av-asst" title="Orchestrator"><Logo flat size={18} /></span>
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
        <div class="steps">
          <div class="steps-head">
            <Activity size={12} />
            <span>Activity</span>
            <span class="tcount">{message.tools.length}</span>
            <span class="spacer"></span>
            {#each mcpServers as s (s)}
              <span class="mchtag" title="MCP server used"><Plug size={11} />{s}</span>
            {/each}
          </div>
          <div class="steps-list">
            {#each message.tools as tool (tool.callId)}
              <ToolCall {tool} />
            {/each}
          </div>
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
  .think-head:hover {
    color: var(--text);
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
  .steps {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .steps-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
    padding: 0 1px;
  }
  .steps-head .tcount {
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    padding: 0 6px;
    letter-spacing: 0;
    color: var(--muted);
  }
  .mchtag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
    font-size: 10.5px;
    color: var(--amber);
    background: color-mix(in srgb, var(--amber) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--amber) 28%, transparent);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .steps-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
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
</style>
