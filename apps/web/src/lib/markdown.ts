const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const looksLikePath = (value: string): boolean => {
  if (!value || /\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  const bare = value.replace(/:\d+(?::\d+)?$/, "");
  if (/^[A-Za-z]:[\\/]/.test(bare)) return true;
  if (!/[\\/]/.test(bare)) return false;
  return /\.\w{1,10}$/.test(bare);
};

const codeSpan = (raw: string): string => {
  const text = raw.trim();
  return looksLikePath(text)
    ? `<code class="file-ref" data-file="${raw.trim()}">${raw}</code>`
    : `<code>${raw}</code>`;
};

const anchor = (label: string, url: string): string => {
  const isFile = url.startsWith("file://") || looksLikePath(url.replace(/&amp;/g, "&"));
  const attrs = isFile
    ? `href="${url}" class="file-ref"`
    : `href="${url}" target="_blank" rel="noopener noreferrer"`;
  return `<a ${attrs}>${label}</a>`;
};

const inline = (source: string): string => {
  const codes: string[] = [];
  let text = escapeHtml(source).replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(codeSpan(code));
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => `<img src="${url}" alt="${alt}" />`);
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => anchor(label, url));
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre: string, url: string) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? "");
};

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

const renderList = (lines: string[], start: number): { html: string; next: number } => {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = LIST_ITEM.exec(line);
    if (!match) {
      if (line.trim() && /^\s+/.test(line) && items.length) {
        items[items.length - 1] += ` ${inline(line.trim())}`;
        i += 1;
        continue;
      }
      break;
    }
    const indent = match[1]!.length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const nested = renderList(lines, i);
      items[items.length - 1] += nested.html;
      i = nested.next;
      continue;
    }
    if (/\d/.test(match[2]!) !== ordered) break;
    items.push(inline(match[3]!));
    i += 1;
  }
  const tag = ordered ? "ol" : "ul";
  const html = `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
  return { html, next: i };
};

export const renderMarkdown = (source: string): string => {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let i = 0;

  const flush = (): void => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(inline).join("<br />")}</p>`);
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = /^\s{0,3}```+\s*([\w.+#-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s{0,3}```+\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : "";
      out.push(`<div class="code-block">${label}<pre><code>${escapeHtml(body.join("\n"))}</code></pre></div>`);
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push("<hr />");
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?[\s:|-]*$/.test(lines[i + 1]!)) {
      flush();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      const head = header.map((cell) => `<th>${inline(cell)}</th>`).join("");
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flush();
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }

    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flush();
  return out.join("\n");
};

export { looksLikePath };
