<script lang="ts">
  import { GitBranch, Paperclip, Gauge, User } from "@lucide/svelte";
  import { session, harnessOf, harnessName } from "../lib/session.svelte";
  import { fmtTokens, contextUsed, contextPct, usageTooltip } from "../lib/usage";
  import Message from "./Message.svelte";
  import Composer from "./Composer.svelte";
  import ProviderIcon from "./ProviderIcon.svelte";
  import LiveStatus from "./LiveStatus.svelte";
  import Logo from "./Logo.svelte";

  let scrollEl = $state<HTMLDivElement | null>(null);

  const thread = $derived(session.activeThread);
  const running = $derived(thread?.status === "running");
  const sig = $derived(
    thread ? thread.messages.reduce((n, m) => n + m.text.length + m.tools.length * 4, 0) : 0,
  );

  const suggestions = [
    "Explain this codebase",
    "Find and fix a bug",
    "Add a feature",
    "Write tests",
  ];

  $effect(() => {
    void sig;
    const el = scrollEl;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  });
</script>

<div class="chat">
  {#if thread}
    <div class="chat-head">
      <span
        class="sdot"
        class:run={thread.status === "running"}
        class:stop={thread.status === "stopped"}
        class:err={thread.status === "error"}
      ></span>
      <span class="title" title={thread.title}>{thread.title}</span>
      <span class="meta">
        <span class="pill">
          <ProviderIcon id={thread.harness} color={harnessOf(thread.harness)?.color} size={12} />
          <span class="txt">{harnessName(thread.harness)}</span>
          <span class="msep">·</span>
          <span class="txt">{thread.model}</span>
        </span>
        {#if thread.branch}
          <span class="pill" title="Isolated worktree branch">
            <GitBranch size={11} />
            <span class="txt">{thread.branch}</span>
          </span>
        {/if}
        {#if thread.usage}
          <span class="pill usage" title={usageTooltip(thread.usage)}>
            <Gauge size={11} />
            <span class="txt">
              {fmtTokens(contextUsed(thread.usage))}{thread.usage.contextLimit
                ? `/${fmtTokens(thread.usage.contextLimit)}`
                : " tok"}{contextPct(thread.usage) !== null ? ` · ${contextPct(thread.usage)}%` : ""}
            </span>
          </span>
        {/if}
      </span>
    </div>
    {#if running}
      <LiveStatus {thread} />
    {/if}
  {/if}

  <div class="chat-scroll" bind:this={scrollEl}>
    {#if !thread}
      <div class="chat-col" style="justify-content:center">
        <div class="center-hero">
          <Logo flat size={44} />
          <div class="h1">What should we build?</div>
          <div class="sub">
            Describe a task and an agent runs it in its own git worktree, so parallel agents never collide.
          </div>
          <div class="hero-chips">
            {#each suggestions as s (s)}
              <button class="hero-chip" onclick={() => session.suggest(s)}>{s}</button>
            {/each}
          </div>
        </div>
      </div>
    {:else if thread.messages.length === 0}
      <div class="chat-col" style="justify-content:center">
        <div class="center-hero">
          <div class="h1">Working…</div>
          <div class="sub">Waiting for the first event from {harnessName(thread.harness)}.</div>
        </div>
      </div>
    {:else}
      <div class="chat-col">
        {#if thread.prompt && !thread.messages.some((m) => m.role === "user")}
          <div class="mrow user">
            <div class="user-req">
              <div class="ububble">{thread.prompt}</div>
              {#if thread.attachments?.length}
                <div class="req-atts">
                  {#each thread.attachments as a (a.name)}
                    <span class="req-att" title={`${a.name} · ${a.mime}`}>
                      <Paperclip size={11} />
                      <span class="rat">{a.name}</span>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
            <span class="av av-user" title="You"><User size={14} /></span>
          </div>
        {/if}
        {#each thread.messages as message, i (message.id)}
          <Message
            {message}
            {running}
            showAvatar={i === 0 || thread.messages[i - 1]?.role !== message.role}
          />
        {/each}
      </div>
    {/if}
  </div>

  <Composer />
</div>
