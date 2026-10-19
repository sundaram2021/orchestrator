<script lang="ts">
  import { session } from "../lib/session.svelte";

  type Kind = "meta" | "hunk" | "ctx" | "mod" | "add" | "del";

  interface Row {
    kind: Kind;
    leftNo: number | null;
    left: string;
    leftMark: "" | "-";
    rightNo: number | null;
    right: string;
    rightMark: "" | "+";
  }

  const isMeta = (t: string): boolean =>
    t.startsWith("diff --git") ||
    t.startsWith("index ") ||
    t.startsWith("--- ") ||
    t.startsWith("+++ ") ||
    t.startsWith("new file mode") ||
    t.startsWith("deleted file mode") ||
    t.startsWith("old mode") ||
    t.startsWith("new mode") ||
    t.startsWith("similarity index") ||
    t.startsWith("rename ") ||
    t.startsWith("Binary files") ||
    t.startsWith("\\ No newline");

  const parse = (diff: string): Row[] => {
    const rows: Row[] = [];
    let oldNo = 0;
    let newNo = 0;
    let dels: string[] = [];
    let adds: string[] = [];

    const flush = (): void => {
      const max = Math.max(dels.length, adds.length);
      for (let i = 0; i < max; i++) {
        const d = dels[i];
        const a = adds[i];
        if (d !== undefined && a !== undefined) {
          rows.push({ kind: "mod", leftNo: oldNo++, left: d, leftMark: "-", rightNo: newNo++, right: a, rightMark: "+" });
        } else if (d !== undefined) {
          rows.push({ kind: "del", leftNo: oldNo++, left: d, leftMark: "-", rightNo: null, right: "", rightMark: "" });
        } else {
          rows.push({ kind: "add", leftNo: null, left: "", leftMark: "", rightNo: newNo++, right: a ?? "", rightMark: "+" });
        }
      }
      dels = [];
      adds = [];
    };

    const raw = diff.split(/\r?\n/);
    if (raw.length && raw[raw.length - 1] === "") raw.pop();
    for (const line of raw) {
      if (isMeta(line)) {
        flush();
        rows.push({ kind: "meta", leftNo: null, left: line, leftMark: "", rightNo: null, right: "", rightMark: "" });
        continue;
      }
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        flush();
        oldNo = Number(hunk[1]);
        newNo = Number(hunk[2]);
        rows.push({ kind: "hunk", leftNo: null, left: line, leftMark: "", rightNo: null, right: "", rightMark: "" });
        continue;
      }
      if (line.startsWith("-")) {
        dels.push(line.slice(1));
        continue;
      }
      if (line.startsWith("+")) {
        adds.push(line.slice(1));
        continue;
      }
      flush();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ kind: "ctx", leftNo: oldNo++, left: text, leftMark: "", rightNo: newNo++, right: text, rightMark: "" });
    }
    flush();
    return rows;
  };

  const rows = $derived(parse(session.diff));
  const hasDiff = $derived(session.diff.trim().length > 0);
</script>

<div class="diffwrap">
  {#if !hasDiff}
    <div class="empty">
      {session.diffStaged ? "Nothing staged for this file." : "No changes to show. Edit a file to see its diff."}
    </div>
  {:else}
    <div class="split">
      {#each rows as row, i (i)}
        {#if row.kind === "meta"}
          <div class="drow wide meta"><span class="full">{row.left}</span></div>
        {:else if row.kind === "hunk"}
          <div class="drow wide hunk"><span class="full">{row.left}</span></div>
        {:else}
          {@const tintL = row.leftMark === "-" ? "del" : ""}
          {@const tintR = row.rightMark === "+" ? "add" : ""}
          <div class="drow">
            {#if row.leftNo !== null}
              <span class="g {tintL}">{row.leftNo}</span>
              <span class="m {tintL}">{row.leftMark}</span>
              <span class="code {tintL}">{row.left || " "}</span>
            {:else}
              <span class="g filler"></span>
              <span class="m filler"></span>
              <span class="code filler"></span>
            {/if}
            {#if row.rightNo !== null}
              <span class="g r {tintR}">{row.rightNo}</span>
              <span class="m r {tintR}">{row.rightMark}</span>
              <span class="code r {tintR}">{row.right || " "}</span>
            {:else}
              <span class="g r filler"></span>
              <span class="m r filler"></span>
              <span class="code r filler"></span>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
