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
</script>

<div class="md">{@html html}</div>
