<script lang="ts">
  import type { MessageView } from "@orchestrator/contracts";
  import MarkdownPreview from "./MarkdownPreview.svelte";

  let { message }: { message: MessageView } = $props();
</script>

{#if message.role === "system"}
  <div class="msg sys">{message.text}</div>
{:else}
  <div class="msg {message.role === 'user' ? 'user' : 'asst'}">
    {#if message.role === "assistant"}
      <MarkdownPreview source={message.text} />
    {:else}
      {message.text}
    {/if}
    {#each message.tools as tool (tool.callId)}
      <div class="tool">
        <span class="tag" class:err={tool.ok === false}>{tool.tool}</span>
        {tool.args}
        {#if tool.result}
          <div class="out">{tool.result}</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
