<script lang="ts">
  import { session, type SettingsSection } from "../lib/session.svelte";

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: "harnesses", label: "Harnesses" },
    { id: "mcp", label: "MCP Servers" },
    { id: "skills", label: "Skills" },
  ];

  const onToggle = (target: "harness" | "mcp" | "skill", id: string, enabled: boolean) => {
    void session.toggle(target, id, enabled);
  };
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && session.closeSettings()}
>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1">
    <div class="modal-head">
      <strong id="settingsTitle">Settings</strong>
      <span class="sub">Harnesses, MCP servers and skills</span>
      <div class="spacer"></div>
      <button class="btn ghost" onclick={() => session.closeSettings()}>Close</button>
    </div>
    <div class="modal-body">
      <nav class="settings-nav">
        {#each sections as section (section.id)}
          <button class:active={session.settingsSection === section.id} onclick={() => (session.settingsSection = section.id)}>
            {section.label}
          </button>
        {/each}
      </nav>
      <div class="settings-main">
        {#if session.settingsSection === "harnesses"}
          <h3>Harnesses</h3>
          <div class="sub">Agent runtimes the orchestrator connects to.</div>
          {#each session.config?.harnesses ?? [] as h (h.id)}
            <div class="srow">
              <span class="hdot" style="background:{h.color};width:9px;height:9px"></span>
              <div class="grow">
                <div class="name">
                  {h.name}
                  <span class="badge" class:ok={h.status === "connected"} class:warn={h.status !== "connected"}>{h.status}</span>
                </div>
                <div class="detail">{h.detail}</div>
              </div>
              <label class="switch">
                <input type="checkbox" checked={h.enabled} onchange={(e) => onToggle("harness", h.id, e.currentTarget.checked)} />
                <span class="slider"></span>
              </label>
            </div>
          {/each}
        {:else if session.settingsSection === "mcp"}
          <h3>MCP Servers</h3>
          <div class="sub">
            {(session.config?.mcp ?? []).filter((s) => s.enabled).length} of {(session.config?.mcp ?? []).length} enabled.
          </div>
          {#each session.config?.mcp ?? [] as s (s.name)}
            <div class="srow">
              <div class="grow">
                <div class="name">
                  {s.name}
                  <span class="badge" class:ok={s.status === "connected"} class:warn={s.status === "error"}>{s.status}</span>
                </div>
                <div class="detail">{s.transport} · {s.source} · {s.detail}{s.tools.length ? ` · ${s.tools.length} tools` : ""}</div>
              </div>
              <label class="switch">
                <input type="checkbox" checked={s.enabled} onchange={(e) => onToggle("mcp", s.name, e.currentTarget.checked)} />
                <span class="slider"></span>
              </label>
            </div>
          {/each}
        {:else}
          <h3>Skills</h3>
          <div class="sub">
            {(session.config?.skills ?? []).filter((s) => s.enabled).length} of {(session.config?.skills ?? []).length} enabled.
          </div>
          {#each session.config?.skills ?? [] as s (s.name)}
            <div class="srow">
              <div class="grow">
                <div class="name">{s.name}</div>
                <div class="detail">{s.description || s.path}</div>
              </div>
              <label class="switch">
                <input type="checkbox" checked={s.enabled} onchange={(e) => onToggle("skill", s.name, e.currentTarget.checked)} />
                <span class="slider"></span>
              </label>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>
