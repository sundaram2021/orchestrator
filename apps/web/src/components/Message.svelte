<script lang="ts">
  import type { MessageView } from "@orchestrator/contracts";

  let { message }: { message: MessageView } = $props();
</script>

{#if message.role === "system"}
  <div class="msg sys">{message.text}</div>
{:else}
  <div class="msg {message.role === 'user' ? 'user' : 'asst'}">
    {message.text}
    {#each message.tools as tool (tool.callId)}
      <div class="tool">
        <span class="tag" class:err={tool.ok === false}>{tool.tool}</span>
        {tool.args}
        {#if tool.result}
          <div style="margin-top:4px;color:var(--muted)">{tool.result}</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
