<script lang="ts">
  import { session, type SettingsSection } from "../lib/session.svelte";

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: "harnesses", label: "Harnesses" },
    { id: "mcp", label: "MCP Servers" },
    { id: "skills", label: "Skills" },
    { id: "updates", label: "Updates" },
  ];

  const onToggle = (target: "harness" | "mcp" | "skill", id: string, enabled: boolean): void => {
    void session.toggle(target, id, enabled);
  };

  let testFor = $state<string | null>(null);
  let testToolName = $state("");
  let testArgs = $state("{}");
  let testResult = $state<string | null>(null);
  let testBusy = $state(false);

  const toggleTest = (name: string): void => {
    testFor = testFor === name ? null : name;
    testToolName = "";
    testArgs = "{}";
    testResult = null;
  };

  const runTest = async (server: string): Promise<void> => {
    testBusy = true;
    testResult = null;
    try {
      const args = JSON.parse(testArgs || "{}") as Record<string, unknown>;
      testResult = await session.testTool(server, testToolName, args);
    } catch (err) {
      testResult = err instanceof Error ? err.message : String(err);
    } finally {
      testBusy = false;
    }
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
      <span class="sub">Harnesses, MCP servers, skills and updates</span>
      <div class="spacer"></div>
      <button class="tbtn" onclick={() => session.closeSettings()}>Close</button>
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
              {#if s.status === "connected"}
                <button class="tbtn" onclick={() => toggleTest(s.name)}>Test</button>
              {/if}
              <label class="switch">
                <input type="checkbox" checked={s.enabled} onchange={(e) => onToggle("mcp", s.name, e.currentTarget.checked)} />
                <span class="slider"></span>
              </label>
            </div>
            {#if testFor === s.name}
              <div class="test-panel">
                <div class="test-fields">
                  <input class="search" list="tools-{s.name}" bind:value={testToolName} placeholder="tool name" />
                  <datalist id="tools-{s.name}">
                    {#each s.tools as t (t)}<option value={t}></option>{/each}
                  </datalist>
                  <textarea class="test-args" bind:value={testArgs} placeholder={'{"key":"value"}'}></textarea>
                </div>
                <div class="row">
                  <button class="tbtn" disabled={testBusy || !testToolName.trim()} onclick={() => void runTest(s.name)}>Run tool</button>
                </div>
                {#if testResult !== null}
                  <pre class="test-out">{testResult}</pre>
                {/if}
              </div>
            {/if}
          {/each}
        {:else if session.settingsSection === "skills"}
          <h3>Skills</h3>
          <div class="sub">
            {(session.config?.skills ?? []).filter((s) => s.enabled).length} of {(session.config?.skills ?? []).length} enabled. Enabled skills are injected as the agent system prompt.
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
        {:else}
          <h3>Updates</h3>
          <div class="sub">The desktop app can install new versions automatically on launch.</div>
          <div class="srow">
            <div class="grow">
              <div class="name">Install updates automatically</div>
              <div class="detail">Check for a newer release at startup and install it.</div>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                checked={session.config?.updates.autoUpdate ?? true}
                onchange={(e) => void session.setUpdateSettings({ autoUpdate: e.currentTarget.checked })}
              />
              <span class="slider"></span>
            </label>
          </div>
          <div class="srow">
            <div class="grow">
              <div class="name">Include major versions</div>
              <div class="detail">Also install releases with a major version bump.</div>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                checked={session.config?.updates.includeMajor ?? true}
                disabled={!(session.config?.updates.autoUpdate ?? true)}
                onchange={(e) => void session.setUpdateSettings({ includeMajor: e.currentTarget.checked })}
              />
              <span class="slider"></span>
            </label>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
