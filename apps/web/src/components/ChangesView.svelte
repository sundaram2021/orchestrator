<script lang="ts">
  import { Plus, GitCommitHorizontal, GitPullRequest, Upload, GitBranch } from "@lucide/svelte";
  import { session } from "../lib/session.svelte";
  import { fileGlyph } from "../lib/icons";
  import { baseName } from "../lib/paths";

  const git = $derived(session.git);
  const branches = $derived(session.branches);
</script>

{#if !git?.available}
  <div class="empty" style="padding:16px">Not a git repository.</div>
{:else}
  <div class="right-head">
    Changes
    <span class="count">{git.files.length}</span>
    <span class="spacer"></span>
    {#if branches && branches.local.length > 1}
      <span class="brselect">
        <GitBranch size={12} />
        <select class="select" value={branches.current} onchange={(e) => void session.checkout(e.currentTarget.value)}>
          {#each branches.local as b (b)}<option value={b}>{b}</option>{/each}
        </select>
      </span>
    {/if}
  </div>

  <div class="changes-list">
    {#each git.files as f (f.path)}
      {@const Glyph = fileGlyph(f.path)}
      <div class="chg" class:sel={session.diffPath === f.path}>
        <button class="chg-name" title={f.path} onclick={() => void session.openDiff(f.path)}>
          <span class="chg-st" class:add={f.index === "A"} class:del={f.index === "D"}>{f.index !== " " && f.index !== "?" ? f.index : "U"}</span>
          <span class="ffile"><Glyph size={14} /></span>
          <span class="txt">{baseName(f.path)}</span>
          <span class="dirtext">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
        </button>
        {#if f.worktree !== " "}
          <button class="chg-stage" title="Stage file" onclick={() => void session.stageFile(f.path)}><Plus size={14} /></button>
        {/if}
      </div>
    {/each}
    {#if git.files.length === 0}
      <div class="empty" style="padding:10px">Working tree clean.</div>
    {/if}
  </div>

  <div class="git-form">
    <input class="search" bind:value={session.commitMessage} placeholder="Commit message…" />
    <div class="row">
      <button class="btn" onclick={() => void session.stageAll()}><Plus size={14} /> Stage all</button>
      <button class="btn primary" disabled={!session.commitMessage.trim()} onclick={() => void session.commitAndPush()}>
        <GitCommitHorizontal size={14} /> Commit &amp; push
      </button>
    </div>
    <input class="search" bind:value={session.prTitle} placeholder="PR title…" />
    <div class="row">
      <button class="btn" disabled={!session.prTitle.trim()} onclick={() => void session.createPr()}>
        <GitPullRequest size={14} /> Open PR
      </button>
      <button class="btn" onclick={() => void session.push()}><Upload size={14} /> Push</button>
    </div>
  </div>
{/if}

<style>
  .brselect {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--faint);
  }
  .ffile {
    display: grid;
    place-items: center;
    color: var(--faint);
    flex-shrink: 0;
  }
</style>
