<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { FileNode } from "@orchestrator/contracts";
  import { Sparkles, Plug, Paperclip, X, Bot } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { fileGlyph } from "../lib/icons";
  import { agentSlug } from "../lib/mentions";
  import ModelPicker from "./ModelPicker.svelte";

  type Item = {
    id: string;
    label: string;
    hint: string;
    insert: string;
    group: string;
    search: string;
    path?: string;
  };

  type FileAttachment = { name: string; mime: string; data: string; size: number };

  const MAX_BYTES = 8 * 1024 * 1024;

  let text = $state("");
  let ta = $state<HTMLTextAreaElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let cursor = $state(0);
  let active = $state(0);
  let dismissed = $state(false);
  let dragging = $state(false);
  let attachments = $state<FileAttachment[]>([]);

  const files = $derived.by(() => {
    const out: { name: string; path: string }[] = [];
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.type === "file") out.push({ name: n.name, path: n.path });
        else if (n.children) walk(n.children);
      }
    };
    walk(session.tree);
    return out;
  });

  const mcp = $derived((session.config?.mcp ?? []).filter((s) => s.enabled));
  const skills = $derived((session.config?.skills ?? []).filter((s) => s.enabled));
  const agents = $derived(session.threads.filter((t) => t.kind !== "orchestrator"));

  const token = $derived.by(() => {
    if (dismissed) return null;
    const before = text.slice(0, cursor);
    const at = before.lastIndexOf("@");
    const slash = before.lastIndexOf("/");
    const dollar = before.lastIndexOf("$");
    const idx = Math.max(at, slash, dollar);
    if (idx < 0) return null;
    const ch = before[idx]!;
    if (idx > 0 && !/\s/.test(before[idx - 1]!)) return null;
    const query = before.slice(idx + 1);
    if (/\s/.test(query)) return null;
    return { trigger: ch as "@" | "/" | "$", query, start: idx };
  });

  const items: Item[] = $derived.by(() => {
    const t = token;
    if (!t) return [];
    const q = t.query.toLowerCase();
    if (t.trigger === "@") {
      return files
        .filter((f) => f.path.toLowerCase().includes(q))
        .slice(0, 50)
        .map((f) => ({
          id: `file:${f.path}`,
          label: f.name,
          hint: f.path,
          insert: `@${f.path} `,
          group: "Files",
          search: f.path.toLowerCase(),
          path: f.path,
        }));
    }
    if (t.trigger === "$") {
      return agents
        .filter((a) => !q || a.title.toLowerCase().includes(q))
        .slice(0, 50)
        .map((a) => ({
          id: `agent:${a.id}`,
          label: a.title,
          hint: `${a.status} · ${a.harness}`,
          insert: `$${agentSlug(a.title)} `,
          group: "Agents",
          search: `agent ${a.title}`.toLowerCase(),
        }));
    }
    const out: Item[] = [];
    for (const s of mcp) {
      out.push({
        id: `mcp:${s.name}`,
        label: s.name,
        hint: `${s.tools.length} tools · MCP`,
        insert: `@mcp/${s.name} `,
        group: "MCP servers",
        search: `mcp ${s.name}`.toLowerCase(),
      });
    }
    for (const s of skills) {
      out.push({
        id: `skill:${s.name}`,
        label: s.name,
        hint: s.description || "Skill",
        insert: `/${s.name} `,
        group: "Skills",
        search: `skill ${s.name}`.toLowerCase(),
      });
    }
    return q ? out.filter((i) => i.search.includes(q) || i.label.toLowerCase().includes(q)) : out;
  });

  const open = $derived(items.length > 0 && token !== null);
  const canSend = $derived(session.connection === "open" && (!!text.trim() || attachments.length > 0));

  const humanSize = (n: number): string =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

  const extFor = (mime: string): string => (mime.split("/")[1] ?? "bin").split("+")[0]!;

  const readOne = (file: File): Promise<FileAttachment | null> =>
    new Promise((resolve) => {
      if (file.size > MAX_BYTES) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        const semi = result.indexOf(";");
        if (comma < 0 || semi < 0) {
          resolve(null);
          return;
        }
        const mime = file.type || result.slice(5, semi) || "application/octet-stream";
        const base = file.name && file.name !== "blob" ? file.name : `pasted-${Date.now()}.${extFor(mime)}`;
        resolve({ name: base, mime, data: result.slice(comma + 1), size: file.size });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });

  const addFiles = async (incoming: File[]): Promise<void> => {
    const results = await Promise.all(incoming.map(readOne));
    const rejected = results.filter((r) => r === null).length;
    if (rejected) window.alert(`Skipped ${rejected} file(s) — only files up to 8 MB are supported.`);
    const ok = results.filter((r): r is FileAttachment => r !== null);
    if (ok.length) attachments = [...attachments, ...ok];
  };

  const onPaste = (e: ClipboardEvent): void => {
    const dt = e.clipboardData;
    if (!dt) return;
    const pasted: File[] = [];
    for (const item of dt.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length === 0 && dt.files.length) pasted.push(...dt.files);
    if (pasted.length) {
      e.preventDefault();
      void addFiles(pasted);
    }
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    dragging = false;
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length) void addFiles([...dropped]);
  };

  const onFilePicked = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) void addFiles([...input.files]);
    input.value = "";
  };

  const removeAttachment = (index: number): void => {
    attachments = attachments.filter((_, i) => i !== index);
  };

  const pick = (item: Item): void => {
    const t = token;
    if (!t || !ta) return;
    const end = ta.selectionEnd;
    text = text.slice(0, t.start) + item.insert + text.slice(end);
    const pos = t.start + item.insert.length;
    active = 0;
    dismissed = false;
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
      cursor = pos;
    });
  };

  const send = async (): Promise<void> => {
    const value = text.trim() || (attachments.length ? "Please review the attached file(s)." : "");
    if (!value) return;
    const payload = attachments.map((a) => ({ name: a.name, mime: a.mime, data: a.data }));
    text = "";
    attachments = [];
    dismissed = true;
    await session.send(value, payload);
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = (active + 1) % items.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        active = (active - 1 + items.length) % items.length;
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(items[Math.min(active, items.length - 1)]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissed = true;
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onInput = (): void => {
    dismissed = false;
    active = 0;
    cursor = ta?.selectionStart ?? text.length;
  };
  const syncCursor = (): void => {
    cursor = ta?.selectionStart ?? text.length;
  };

  const focus = (): void => ta?.focus();
  const setComposer = (e: Event): void => {
    text = (e as CustomEvent<string>).detail;
    ta?.focus();
  };
  onMount(() => {
    window.addEventListener("orchestrator:focus-composer", focus);
    window.addEventListener("orchestrator:set-composer", setComposer);
    ta?.focus();
  });
  onDestroy(() => {
    window.removeEventListener("orchestrator:focus-composer", focus);
    window.removeEventListener("orchestrator:set-composer", setComposer);
  });
</script>

<div
  class="composer"
  class:dragging
  role="presentation"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <div class="compose-box">
    {#if open}
      <div class="tmenu">
        {#each items as item, i (item.id)}
          {#if i === 0 || items[i - 1]!.group !== item.group}
            <div class="menu-head">{item.group}</div>
          {/if}
          {@const Glyph = item.path ? fileGlyph(item.label) : item.group === "MCP servers" ? Plug : item.group === "Agents" ? Bot : Sparkles}
          <button
            type="button"
            class="menu-row"
            class:active={i === active}
            onmouseenter={() => (active = i)}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(item)}
          >
            <span class="micon"><Glyph size={13} /></span>
            <span class="mlabel">{item.label}</span>
            <span class="mhint">{item.hint}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if attachments.length}
      <div class="atts">
        {#each attachments as a, i (a.name + i)}
          <div class="att" title={`${a.name} · ${humanSize(a.size)}`}>
            {#if a.mime.startsWith("image/")}
              <img class="athumb" src={`data:${a.mime};base64,${a.data}`} alt={a.name} />
            {:else}
              {@const AGlyph = fileGlyph(a.name)}
              <span class="aglyph"><AGlyph size={16} /></span>
            {/if}
            <div class="ameta">
              <span class="aname">{a.name}</span>
              <span class="asize">{humanSize(a.size)}</span>
            </div>
            <button class="adel" title="Remove" onclick={() => removeAttachment(i)}><X size={12} /></button>
          </div>
        {/each}
      </div>
    {/if}

    <textarea
      bind:this={ta}
      bind:value={text}
      oninput={onInput}
      onkeydown={onKeydown}
      onkeyup={syncCursor}
      onclick={syncCursor}
      onselect={syncCursor}
      onpaste={onPaste}
      placeholder="Give an instruction… (drop or paste images, Enter to send)"
    ></textarea>

    <div class="compose-bar">
      <button class="tool" title="Attach files" onclick={() => fileInput?.click()}>
        <Paperclip size={15} />
      </button>
      <ModelPicker />
      <span class="hint">
        <b>$</b> agents · <b>@</b> files · <b>/</b> skills · <b>/mcp</b>
      </span>
      <button class="send" disabled={!canSend} title="Send" onclick={() => void send()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
    </div>
  </div>
  <input
    bind:this={fileInput}
    type="file"
    multiple
    class="file-input"
    onchange={onFilePicked}
  />
</div>

<style>
  .file-input {
    display: none;
  }
  .composer.dragging .compose-box {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tool {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    background: transparent;
    border: 1px solid var(--border-soft);
    border-radius: 9px;
    color: var(--muted);
  }
  .tool:hover {
    color: var(--text);
    border-color: var(--border);
  }
  .tmenu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    max-height: 320px;
    overflow-y: auto;
    background: var(--overlay);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    padding: 6px;
    z-index: 40;
  }
  .menu-head {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faint);
    padding: 6px 8px 4px;
  }
  .menu-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    padding: 6px 8px;
    color: var(--text);
    font-size: 12.5px;
    text-align: left;
  }
  .menu-row.active {
    background: var(--accent-soft);
  }
  .micon {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--muted);
    flex-shrink: 0;
  }
  .menu-row.active .micon {
    color: var(--accent);
  }
  .mlabel {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 40%;
  }
  .mhint {
    color: var(--faint);
    font-family: var(--mono);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-left: auto;
  }
  .hint b {
    color: var(--muted);
    font-weight: 600;
  }
  .atts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .att {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 230px;
    padding: 5px 6px 5px 5px;
    background: var(--surface-2);
    border: 1px solid var(--border-soft);
    border-radius: 10px;
  }
  .athumb {
    width: 34px;
    height: 34px;
    border-radius: 7px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .aglyph {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 7px;
    background: var(--canvas);
    color: var(--muted);
    flex-shrink: 0;
  }
  .ameta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .aname {
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .asize {
    font-size: 10.5px;
    color: var(--faint);
  }
  .adel {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--faint);
    flex-shrink: 0;
  }
  .adel:hover {
    background: var(--overlay);
    color: var(--red);
  }
</style>
