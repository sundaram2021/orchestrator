<script lang="ts">
  import { session } from "../lib/session.svelte";

  interface Line {
    text: string;
    kind: "hunk" | "add" | "del" | "meta" | "ctx";
  }

  const classify = (text: string): Line["kind"] => {
    if (text.startsWith("diff --git") || text.startsWith("index ") || text.startsWith("--- ") || text.startsWith("+++ "))
      return "meta";
    if (text.startsWith("@@")) return "hunk";
    if (text.startsWith("+")) return "add";
    if (text.startsWith("-")) return "del";
    return "ctx";
  };

  const lines = $derived(
    session.diff
      .split(/\r?\n/)
      .filter((_, i, arr) => i < arr.length - 1 || arr[i] !== "")
      .map((text) => ({ text, kind: classify(text) } satisfies Line)),
  );
</script>

{#if lines.length === 0}
  <div class="empty">No unstaged changes. Edit a file to see its diff.</div>
{:else}
  <div class="diff">
    {#each lines as line, i (i)}
      <div class="dl {line.kind}">{line.text || " "}</div>
    {/each}
  </div>
{/if}
