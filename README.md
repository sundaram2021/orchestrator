# Orchestrator — Product & Implementation Plan

A **dark, desktop IDE** that orchestrates two local coding harnesses — **OpenCode** (full agent runtime) and **Antigravity** (model + MCP source) — from one surface. Own your subscriptions; we orchestrate, you keep your plans. Minimal memory footprint, fast startup, SOLID/DRY/YAGNI throughout.

## 1. What we're actually building

A Tauri 2 desktop app with:
- A code editor (Monaco) with file tree, tabs, git diff, markdown preview.
- A dual-mode UI:
  - **IDE mode**: editor-centric with file explorer and docked chat.
  - **Agent mode**: horizontal columns of independent agents + history sidebar.
- An orchestrator chat dock that starts a **new independent agent per message**.
- Direct control of OpenCode sessions; Antigravity used as model/MCP source (no headless agent API).
- MCP servers (from Antigravity configs + opencode config + Engram) with tools routed into agent turns.
- Global agent-skills (`SKILL.md`) discovered and injectable.
- Git integration: status, diff, branch, one-click commit/PR.

## 2. Feature list

**Workspace & files**
- Open folder as workspace; file tree with expand/collapse.
- Multi-tab editor (Monaco) with syntax highlighting, search-in-file.
- Git diff view (hunk-level) and Markdown preview toggle.
- Create/rename/delete file via context.

**Agents**
- Each chat message spawns an independent agent column (own transcript, status, stop control).
- Per-agent: harness, model, status (running/stopped/done), tool calls, code diffs.
- Clear finished, stop agent, retry, fork from thread.
- History sidebar with search, grouped Running/History.

**Harnesses**
- OpenCode: full adapter using `opencode serve` (sessions, turns, interrupt, approvals, fork/continue).
- Antigravity: model list + MCP config + launch IDE (status "model source only").
- Harness toggle enable/disable; per-harness model list.

**Model selector**
- Two-level menu: harness -> model, with search, recents (localStorage).
- Assigned model shows in status bar.

**MCP**
- Merge configs from:
  - `~/.config/opencode/opencode.json` (mcp block)
  - `~/.gemini/antigravity/mcp_config.json`
  - `~/.gemini/antigravity-ide/mcp_config.json`
  - Engram remote.
- Connect only when enabled; list tools/resources; call tool; show status.
- Settings modal with toggles and tool preview.

**Skills**
- Scan: `~/.agents/skills`, `~/.config/opencode/skills`, `~/.claude/skills`.
- Parse YAML frontmatter (`name`, `description`).
- Enable/disable; inject enabled into agent system context.
- Slash invocation: `/skill-name`.

**Chat / dock**
- Enter send, Shift+Enter newline; hint `@file · /skill · /mcp`.
- Streaming markdown; tool-call cards; code apply button (diff view then accept/reject).
- Auto-route or manual harness per message.

**Git**
- Branch, status count, staged/unstaged.
- One button commit/push/PR (later phase).

**Settings modal**
- Harnesses, MCP Servers, Skills sections.
- Switches persist to sidecar state (+ user config file).

## 3. How it works (runtime flow)

1. **Launch**: Tauri starts → Rust spawns Node sidecar (`services/sidecar`) → sidecar prints port → Tauri opens webview pointing to bundled Svelte app.
2. **Client connect**: Svelte WS client connects to `ws://127.0.0.1:$PORT` with auto-reconnect + sequence replay.
3. **Bootstrap**: client sends `getConfig` → harness/MCP/skills state; `getSnapshot` → threads/read model.
4. **User sends message** (dock): client `dispatchCommand({ kind: 'StartThread', prompt, model })`.
5. **Sidecar** creates thread, starts OpenCode session, streams provider events into event store → read model → push `domainEvent` to clients.
6. **UI** creates agent column, appends messages as events arrive, marks done on `TurnCompleted`.
7. **Tools/MCP**: agent turn requests tool → sidecar routes to MCP client or local fs/git → result appended as `ToolCalled` event → shown as card.
8. **Skills**: enabled skills concatenated into system prompt before `sendTurn`.
9. **Exit**: Tauri `Exit` kills sidecar + all child process groups (opencode serve, MCP stdio).

Event sourcing means a reconnecting client calls `replayEvents(fromSeq)` and reconstructs exact UI; no duplicate state.

## 4. Architecture

```
┌─ Tauri webview (Svelte 5, lazy Monaco/Xterm) ──────┐
│   WS client: typed RPC + event replay               │
└──────────┬─────────────────────────────────────────┘
           │ ws://127.0.0.1:$PORT
┌──────────▼─────────────────────────────────────────┐
│ Node sidecar (single authority)                    │
│  WS/HTTP · EventStore · ReadModel · AdapterManager │
│  McpManager · SkillsLoader · GitService · Files    │
└───┬──────────────┬──────────────────┬────────────┘
    │              │                  │
 opencode serve   antigravity models  MCP clients (SDK)
 (JSON-RPC/SSE)   (source only)       over stdio/sse/http
```

**Contracts** (`packages/contracts`): schema-only (zod). WS methods + domain events + read-model. Inferred TS types, no `any`. Complexity at adapter boundary; orchestration pure; UI dumb (SOLID).

**Adapters** implement one interface (OCP — adding a provider needs no orchestrator change):
```
interface HarnessAdapter {
  id: string; status: 'connected'|'error'|'disabled'|'model-source-only';
  detect(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  startSession(cwd: string): Promise<SessionHandle>;
  sendTurn(s: SessionHandle, prompt: string, model: string): AsyncIterable<ProviderEvent>;
  interrupt(s: SessionHandle): Promise<void>;
}
```

## 5. UI layout (dark tokens from demo)

- Title bar: app name/project, mode toggle (Agent/IDE), right-aligned model pill + MCP count.
- Body three columns: left file tree (IDE mode), main workspace (IDE/Agent), right history (Agent mode).
- Bottom dock (always): Orchestrator chat, model picker, hints, send.
- Status bar: harness conn, MCP count, skills count, antigravity warning, mode, model, agents running, cursor.

CSS uses token variables; only dark theme; system fonts.

## 6. Performance & memory budget

- App binary `<25 MB`; web `<250 KB` gz (excluding lazy Monaco/Xterm); sidecar heap `<80 MB` idle.
- Cargo: `lto=true`, `codegen-units=1`, `opt-level="s"`, `panic="abort"`, `strip=true`.
- tauri.conf: `removeUnusedCommands=true`; minimal ACL (sidecar execute, dialog).
- Vite: `manualChunks` (monaco, xterm), esbuild minify, source maps off in prod, tree-shake.
- Runtime: MCP disabled by default; virtualized columns; debounced watchers; abort on teardown; process group kill on exit.
- Memory is a library, not a service: Engram stays remote HTTP; local skills parsed lazily.

## 7. SOLID/DRY/YAGNI mapping
- SRP: `McpManager` (lifecycle) vs `McpClient` (I/O); `AgentRun` state vs view.
- OCP: new harness = new adapter only.
- LSP/ISP: all adapters satisfy lean interface; optional capabilities via separate contracts.
- DIP: UI depends on contracts, not concrete adapters.
- DRY: one protocol schema, one message renderer, one settings list generator.
- YAGNI: in-memory event store default; no plugin registry; no cloud sync; no mobile app now.

## 8. Discovery paths (already verified on this machine)

- OpenCode: `/c/Program Files/nodejs/opencode` (v1.19.0), config `~/.config/opencode/opencode.json`, accounts `~/.config/opencode/antigravity-accounts.json`, skills `~/.config/opencode/skills`.
- Antigravity IDE: `~/.AppData/Local/Programs/Antigravity IDE`, CLI `antigravity-ide.cmd`, MCP configs `~/.gemini/antigravity/mcp_config.json` and `antigravity-ide/mcp_config.json`.
- Global skills: `~/.agents/skills` (factory-fleet, find-skills, fix-the-issue, tech-explainer, video-to-context).
- Engram memory MCP: `https://www.engram-memory.com`.

## 9. Phases & tasks

1. **Scaffold** — workspace, contracts, sidecar WS ping, Tauri + Svelte stub, AGENTS.md.
2. **OpenCode adapter** — spawn serve, session/turn/interrupt, streaming events.
3. **Editor** — file tree, tabs, Monaco (lazy), diff toggle, markdown view.
4. **Git** — status/diff/branch; commit flow.
5. **MCP** — config loader, clients, tool routing, settings UI.
6. **Skills** — loader + injection + slash invocation.
7. **Antigravity** — model source + IDE launcher + status labels.
8. **Polish** — agent columns, history search, virtualization, perms.
9. **Perf/memory** — profiling, leak check, cold start, bundle.
10. **Packaging** — tauri build, updater, installer.

## 10. Commands (after scaffold)

- `pnpm dev` — sidecar + web + tauri (hot reload).
- `pnpm sidecar` — sidecar only.
- `pnpm build` — production build all.
- `pnpm test` — unit + integration.
- `pnpm lint` / `pnpm typecheck`.
- `cargo fmt && cargo clippy` — Rust.

## 11. Open questions
- Terminal emulator needed? (Currently xterm planned for sidecar logs; remove if YAGNI.)
- Persist threads across restarts (SQLite) or in-memory only?
- Auto-update channel (tauri updater) — needed for v1?

## 12. Non-goals (YAGNI)
- No cloud sync, no mobile app, no arbitrary provider plugin system, no theme beyond dark.
- No reimplementing agent tooling; reuse harness + MCP tools.
- No billing/token resale.

---
Approved demo UI: `orchestrator-demo.html`. Production scaffold begins on your **"go"**.
