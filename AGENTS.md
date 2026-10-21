# AGENTS.md — Orchestrator

Guidance for AI agents working in this repo.

## What this is
A dark desktop IDE (Tauri 2) that orchestrates local coding harnesses:
**OpenCode** (full agent runtime) and **Antigravity** (model + MCP source).
Product spec: `README.md`. Approved demo UI: `orchestrator-demo.html`.

## Layout
```
packages/contracts   schema-only (zod) — rpc, domain events, read model, config
services/sidecar     Node single authority: WS/HTTP, EventStore, ReadModel,
                     AdapterManager, McpManager, SkillsLoader, GitService, Files
apps/web             Svelte 5 + Vite UI (lazy Monaco/Xterm)
apps/desktop         Tauri 2 shell (Rust) — requires `rustup`/cargo
```

## Architecture rules
- The **sidecar is the single authority**. UI is dumb; it depends on `@orchestrator/contracts`,
  never on concrete adapters (DIP).
- **Event sourcing**: every state change is a domain event appended to the store, then
  projected into the read model. Reconnecting clients call `replayEvents(fromSeq)`.
- Adapters satisfy one lean `HarnessAdapter` interface (OCP — new harness = new adapter).
- No `any`. Types are inferred from zod schemas in `packages/contracts`.
- Follow SOLID/DRY/YAGNI. In-memory event store is the default (no DB yet).

## Commands
- `pnpm dev`         sidecar + web (hot reload)
- `pnpm build`       build contracts, sidecar, web
- `pnpm typecheck`   build contracts, then typecheck all packages
- `pnpm test`        build contracts, then run package tests
- `pnpm sidecar`     sidecar only
- `pnpm tauri`       Tauri desktop (needs Rust toolchain)

## Conventions
- TypeScript, ESM, strict. Prefer small files with a single responsibility.
- No comments unless they explain non-obvious intent.
- Never commit secrets. MCP configs (which may contain tokens) are read at runtime
  from the user's home dir — never copied into the repo.

## Verified environment (this machine)
- OpenCode CLI: `/c/Program Files/nodejs/opencode` (v1.19.0)
- OpenCode config: `~/.config/opencode/opencode.json` (has `mcp` block)
- Antigravity MCP: `~/.gemini/antigravity/mcp_config.json`,
  `~/.gemini/antigravity-ide/mcp_config.json` (serverUrl style)
- Global skills: `~/.agents/skills`, `~/.config/opencode/skills`, `~/.claude/skills`
- Engram MCP: https://www.engram-memory.com
- Rust/Cargo: **installed** (`rustup` stable-x86_64-pc-windows-msvc, rustc 1.99.x,
  MSVC BuildTools 18). `pnpm tauri` builds `apps/desktop/src-tauri` (dev binary links OK).
  App icons live in `apps/desktop/src-tauri/icons` (generated via `tauri icon`).
- MCP HTTP handshake requires: echo `Mcp-Session-Id` from `initialize`, send
  `notifications/initialized`, pass source headers (e.g. `Authorization`), and match replies
  by JSON-RPC id inside SSE streams. See `services/sidecar/src/mcp/McpClient.ts`.

## Testing
- `pnpm test` runs `node --import tsx --test "src/**/*.test.ts"` in the sidecar
  (unit tests for EventStore, ReadModel projection, parseRunLine, model catalog, skills).

## MCP routing to agents (verified)
- `McpManager` collects discovered servers and `OpenCodeMcpBridge` writes two profiles under
  `~/.orchestrator/`: `opencode.agents.json` (routed servers + the built-in `orchestrator`
  server) and `opencode.orchestrator.json` (only the built-in; every third-party server is
  written with `enabled:false`).
- **Third-party MCP is opt-in.** A server is injected into agents only when its `route` flag is
  set (Settings → MCP → "Share with agents"). The flag defaults to `false`; `enabled` merely
  controls the sidecar connection/Test panel. This prevents huge tool schemas (e.g. Resend:
  137 tools, ~101k tokens) from consuming every request.
- Both profile files list every discovered server with an explicit `enabled` value. OpenCode
  **merges** the profile with the user's global config (verified), so omitting a server would
  let the global entry re-enable it.
- `OpenCodeAdapter` spawns `opencode serve`/`opencode run` with `OPENCODE_CONFIG` selected by
  MCP profile. The orchestrator session uses the orchestrator profile; subagents use the agents
  profile.
- The bridge files can contain tokens; they are written to the user home (outside the repo) with
  mode 0600. Never copy them into the repo.
- `supabase`/`vercel` are OAuth servers and will read as `needs authentication` until the user
  runs `opencode mcp auth <name>`. This is expected, not a bridge bug.
- Sidecar startup does **not** block on MCP connections (`connectEnabled` is fire-and-forget);
  status updates stream as `mcp.status` events.

## Context budget (verified)
- `McpClient.listTools()` records the serialized schema size; `McpServerConfig.schemaChars`
  surfaces it in Settings next to the tool count (~chars/4 tokens). Servers above ~20k tokens
  show a warning when shared with agents.
- The orchestrator session auto-compacts after a turn when usage exceeds 70% of the model's
  context window (`OpenCodeAdapter.compact` → `POST /session/:id/summarize`); if that fails it
  rotates to a fresh OpenCode session and relies on the memory summary.
- Orchestrator MCP reads are bounded: `thread_read` last 30 messages / 12k chars,
  `agent_registry` 20 rows / 120-char tails, `summarize` 1.5k, `thread_list` 30,
  `memory_list` 20. `MemoryStore.render` caps summary/notes/agents/recent at ~6k chars.

## OpenCode runtime (verified)
- `OpenCodeServer` starts **one long-lived `opencode serve`** per workspace (port 0, parsed from
  stdout) and uses its HTTP API: `POST /session`, `POST /session/{id}/message`,
  `POST /session/{id}/abort`, `SSE GET /event`. This is the default execution path; the old
  per-turn `opencode run` path remains as an automatic fallback if serve can't start.
- SSE mapping (`OpenCodeAdapter.serveTurn`): `message.part.delta` (field `text`) → assistant
  deltas; `message.part.updated` with `part.type==="tool"` → `tool.called`/`tool.result`
  (dedup by `callID`, `state.status` pending→completed); `message.updated` assistant `error` →
  error; `session.idle` → `turn.completed`. Events are filtered by `properties.sessionID`.
- Model id format is `provider/model` with optional `#variant`; split into
  `{providerID, modelID, variant}` for the server API.
- The OpenAPI spec is served at `GET /doc` while a server is running — use it to discover routes.

## Persistence (verified)
- `EventStore` optionally appends to a JSONL journal at `~/.orchestrator/events/<hash>.jsonl`
  (buffered, 100 ms / 256-event flush; `close()` flushes on shutdown). `index.ts` calls
  `store.load()` and replays into the `ReadModel` before boot; old `running` threads are marked
  `stopped` on startup. Journals are per-workspace and can contain config snapshots (no secrets).
- **User settings** persist to `~/.orchestrator/config.json` via `config/SettingsStore.ts`
  (`model`, per-id `harnesses`/`mcp`/`skills` boolean overrides, `mcpRoute` opt-ins, and
  `updates.autoUpdate` / `updates.includeMajor` — both default **on**). Re-applied after `config.assemble()` so toggles
  survive restart. `SettingsStore` with no file path is in-memory (used by unit tests). The
  `SetUpdateSettings` command updates them; they surface on `AppConfig.updates`. The live Tauri
  updater wiring/signing is intentionally deferred until a signed release endpoint exists.
- On WS reopen the client calls `replayEvents(lastSeq + 1)` (`session.svelte.ts onOpen`) to
  recover events missed while disconnected.

## Process lifecycle (verified)
- `util/process.ts` `killTree(child)` reaps a whole process tree: `taskkill /PID <pid> /T /F` on
  Windows, else `process.kill(-pid, "SIGKILL")`. Used by `OpenCodeServer` (dispose + 20 s start
  timeout), `McpClient` stdio `close()`, `runCapture` timeout, and `OpenCodeAdapter` run-mode /
  interrupt. `index.ts` shutdown calls `adapters.stopAll()` + `mcp.stopAll()`.
- `OpenCodeAdapter` no longer holds one `serve` for the whole sidecar. `OpenCodeServerPool`
  (`adapters/OpenCodeServerPool.ts`) keeps **one `opencode serve` per cwd + MCP profile**
  (worktree), reference counted per turn (`acquire`/`release`), and **reaps idle servers** after
  5 min with none active. So parallel agents each get a serve rooted in their own worktree, and
  processes don't linger.
  `stop()` → `pool.disposeAll()`. Unit-tested with an injected factory (`OpenCodeServerPool.test.ts`).

## Multi-agent isolation (verified)
- Each `StartThread` gets its own git worktree at `~/.orchestrator/worktrees/<threadId>` on
  branch `orch/<shortId>` (`git/WorktreeService.ts`, from `HEAD`). The OpenCode session cwd is the
  worktree, so parallel agents never collide. Requires the workspace to be a git repo with ≥1
  commit; otherwise the thread falls back to the shared workspace (no `branch`/`worktree`).
- `thread.started` carries optional `prompt`, `branch`, `worktree`, `parentId`; commands
  `RetryThread`/`ForkThread` re-run a thread's prompt as a new isolated thread, `MergeThread`
  merges its branch into the workspace, `DiscardThread` removes the worktree + branch.
- Enabled skills are injected as the real system prompt (`HarnessAdapter.sendTurn` `TurnOptions.system`
  → `OpenCodeServer.sendMessage({ system })`), not just shown in the UI.
- Frameless window: `TitleBar.svelte` wires minimize/maximize/close via `@tauri-apps/api/window`
  (guarded by `__TAURI_INTERNALS__`); drag regions use `data-tauri-drag-region`; capabilities
  grant `core:window:allow-{minimize,toggle-maximize,close,start-dragging}`. On exit the Rust
  side kills the whole process tree (`taskkill /T /F`) so `opencode serve` is not orphaned.

## MCP test-tool (verified)
- `mcpCallTool` RPC → `McpManager.callTool`; SettingsModal exposes a per-server "Test" panel
  (tool name via datalist + JSON args) for connected servers.

## Checkpoints & landing (verified)
- Per-thread checkpoints are git commits in the thread worktree: `WorktreeService.checkpoint/log/restore`
  (RPC `createCheckpoint`/`listCheckpoints`/`restoreCheckpoint`). Restore = `reset --hard` + `clean -fd`.
- Landing is commit-and-PR by default: the primary per-thread action is **"Commit & PR"** (`landThread` = commit →
  `git push -u origin <branch>` → `gh pr create`, graceful when `gh`/remote absent). `MergeThread`
  (local `git merge` into the workspace) remains a secondary action.
- `gitStatus` returns a per-file list; `gitBranches`/`gitCheckout`/`gitCreatePr` power the git panel
  (branch `<select>`, per-file stage, staged/unstaged diff toggle, PR title/body).

## Desktop (verified)
- `pnpm tauri build` succeeds: `orchestrator-desktop.exe` ~5.3 MB + MSI/NSIS installers; cfg is
  `build.removeUnusedCommands: true` and `app.security.csp` (not null). `tauri-plugin-dialog` +
  `restart_sidecar(workspace)` command back the TitleBar "Open folder" picker; `RpcClient.setUrl`
  reconnects and `session.onOpen` re-bootstraps when `lastSeq < 0`.
- Window is frameless; controls + `data-tauri-drag-region` in `TitleBar.svelte`; exit kills the
  process tree (`taskkill /T /F`).