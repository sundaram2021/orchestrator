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
- Antigravity-IDE / OpenCode MCP servers are made usable by agents via an **OpenCode config
  bridge**: `McpManager` collects discovered servers and `OpenCodeMcpBridge` writes them
  (`local`/`remote` shape, with an `enabled` flag) to `~/.orchestrator/opencode.merged.json`.
- `OpenCodeAdapter` spawns `opencode run` with `OPENCODE_CONFIG` pointing at that file.
  OpenCode **merges** it with the user's global config (verified), so injected servers appear
  alongside native ones and `enabled:false` disables a globally-defined server.
- The bridge file can contain tokens; it is written to the user home (outside the repo) with
  mode 0600. Never copy it into the repo.
- `supabase`/`vercel` are OAuth servers and will read as `needs authentication` until the user
  runs `opencode mcp auth <name>`. This is expected, not a bridge bug.
- Sidecar startup does **not** block on MCP connections (`connectEnabled` is fire-and-forget);
  status updates stream as `mcp.status` events.

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
  (`model`, and per-id `harnesses`/`mcp`/`skills` boolean overrides). Re-applied after
  `config.assemble()` so toggles survive restart. `SettingsStore` with no file path is in-memory
  (used by unit tests).
- On WS reopen the client calls `replayEvents(lastSeq + 1)` (`session.svelte.ts onOpen`) to
  recover events missed while disconnected.

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
- Landing follows T3 Code: the primary per-thread action is **"Commit & PR"** (`landThread` = commit →
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