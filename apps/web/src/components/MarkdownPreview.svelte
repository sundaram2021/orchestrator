<script lang="ts">
  let { source }: { source: string } = $props();

  const escapeHtml = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (text: string): string =>
    text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)\*([^*]+)\*/g, "$1<em>$2</em>");

  const render = (markdown: string): string => {
    const lines = escapeHtml(markdown).split(/\r?\n/);
    const out: string[] = [];
    let inCode = false;
    let inList = false;
    const closeList = (): void => {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
    };
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        closeList();
        out.push(inCode ? "</code></pre>" : '<pre class="code"><code>');
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        out.push(line);
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        closeList();
        const level = heading[1]!.length;
        out.push(`<h${level}>${heading[2]}</h${level}>`);
        continue;
      }
      const item = /^\s*[-*]\s+(.*)$/.exec(line);
      if (item) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push(`<li>${inline(item[1]!)}</li>`);
        continue;
      }
      closeList();
      if (!line.trim()) continue;
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    if (inCode) out.push("</code></pre>");
    return out.join("\n");
  };

  const html = $derived(render(source));

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const pre = target?.closest("pre");
    if (!pre) return;
    void navigator.clipboard?.writeText(pre.innerText).then(() => {
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1200);
    });
  };
</script>

<div class="md" role="presentation" onclick={onClick}>
  {#if copied}<span class="copy-toast">copied</span>{/if}
  {@html html}
</div>

<style>
  .md {
    position: relative;
  }
  .md :global(pre) {
    cursor: copy;
  }
  .copy-toast {
    position: absolute;
    top: 0;
    right: 0;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--panel, #222);
    border: 1px solid var(--border, #333);
    color: var(--muted, #999);
  }
</style>
