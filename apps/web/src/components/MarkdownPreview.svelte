<script lang="ts">
  import { renderMarkdown } from "../lib/markdown";
  import { normalizeFileRef, session } from "../lib/session.svelte";

  let { source, onFile }: { source: string; onFile?: (path: string) => void } = $props();

  const html = $derived(renderMarkdown(source));

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const openRef = (raw: string): void => {
    const path = normalizeFileRef(raw);
    if (!path) return;
    if (onFile) onFile(path);
    else void session.openFile(path);
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;

    const fileEl = target?.closest<HTMLElement>("[data-file]");
    if (fileEl?.dataset.file) {
      event.preventDefault();
      openRef(fileEl.dataset.file);
      return;
    }

    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    if (anchor) {
      const href = anchor.getAttribute("href") ?? "";
      const isFile = href.startsWith("file://") || (href !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(href));
      event.preventDefault();
      if (isFile) openRef(href);
      else window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

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
