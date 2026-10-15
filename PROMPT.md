# Orchestrator — Handoff Prompt (finish v1 end-to-end)

You are the next agent. The base is **built and verified**; your job is to close the
remaining gaps and ship a coherent v1. Work **end-to-end**: implement, wire UI, verify with
real runs, run the quality gates, and only then report. Do not leave anything half-wired.

Repo root: `C:\Desktop\orchestrator` (Windows, bash shell). Use the `workdir` param instead of
`cd`. Read `AGENTS.md` first — its rules are binding.

---

## 0. What this is
A dark Tauri 2 desktop IDE that orchestrates local coding harnesses:
**OpenCode** (full agent runtime via `opencode serve`) and **Antigravity** (model + MCP source).
Single authority is the Node sidecar; UI is dumb and depends only on `@orchestrator/contracts`.
Event-sourced: every state change is a domain event → event store → read model → pushed to clients.

North stars: **performance first**, **reliability first**, SOLID/DRY/YAGNI, no `any`.
The product's headline promise: *every MCP configured in Antigravity/OpenCode is usable by agents*,
and *dozens of agents run in parallel without stepping on each other*.

---

## 1. Ground truth — ALREADY BUILT & VERIFIED (do not rebuild)

| Area | Status | Key files |
|---|---|---|
| Tauri shell | compiles (`cargo build` OK), spawns sidecar, parses WS port, injects `__ORCHESTRATOR_WS__`, kills sidecar on exit | `apps/desktop/src-tauri/src/lib.rs`, `tauri.conf.json`, `Cargo.toml` |
| Sidecar WS/HTTP | `server.ts`, `RequestHandlers.ts`, `rpc.ts` (web) |
| Event store + journal | buffered JSONL at `~/.orchestrator/events/<sha1(ws)>.jsonl`, replay on boot, running→stopped on restart | `event/EventStore.ts`, `index.ts:35-37`, `Orchestrator.ts:66-70` |
| Read model | `event/ReadModel.ts` |
| OpenCode runtime | persistent `opencode serve` pool + SSE streaming + abort; `opencode run` fallback; `simulate` if unavailable | `adapters/OpenCodeServer.ts`, `adapters/OpenCodeAdapter.ts` |
| MCP discovery | merges `~/.config/opencode/opencode.json` (mcp block), `~/.gemini/antigravity*/mcp_config.json`, Engram | `mcp/mcpConfig.ts` |
| MCP → OpenCode bridge | writes `~/.orchestrator/opencode.merged.json` (mode 0600, atomic) and passes it via `OPENCODE_CONFIG` so agents get the servers natively | `mcp/OpenCodeMcpBridge.ts`, `McpManager.ts`, `OpenCodeAdapter.harnessEnv` |
| MCP clients | stdio + http/SSE (session-id handshake, SSE JSON-RPC id matching) | `mcp/McpClient.ts` |
| Skills | discovery from 3 dirs, frontmatter parse, enable/disable, slash `matchInvocation` | `skills/SkillsLoader.ts`, `config/paths.ts` |
| Antigravity | model source + launch IDE | `adapters/AntigravityAdapter.ts`, `ConfigService.ts:76-82` |
| Editor | Monaco lazy, tabs, syntax, save, markdown preview | `apps/web/src/components/EditorPane.svelte`, `lib/monaco.ts`, `MarkdownPreview.svelte` |
| Git | status, diff (read-only), branch, stage-all, commit, push | `git/GitService.ts`, `components/DiffView.svelte` |
| UI shell | TitleBar, FileTree, AgentArea/AgentColumn, ChatDock, HistorySidebar (search+grouping), SettingsModal, StatusBar, ModelSelector (2-level+search) | `apps/web/src/components/*` |
| Tests | 17 passing | `services/sidecar/src/**/*.test.ts` |

Quality gates currently green: `pnpm typecheck`, `pnpm build`, `pnpm test` (17/17), `cargo build`.

**Note:** `neatroots` was intentionally removed from `~/.config/opencode/opencode.json` (and from
the test fixture). Do not re-add it.

---

## 2. Environment (verified on this machine — reuse, don't re-discover)
- Node v24.18.0, pnpm 11.9.0, rustc/cargo 1.99.1 (MSVC). `node_modules` installed.
- OpenCode CLI: `C:\Program Files\nodejs\opencode` (v1.19.0). Global config `~/.config/opencode/opencode.json`.
- Antigravity MCP configs: `~/.gemini/antigravity/mcp_config.json`, `~/.gemini/antigravity-ide/mcp_config.json` (resend/supabase/vercel, `serverUrl` style).
- Global skill dirs: `~/.agents/skills`, `~/.config/opencode/skills`, `~/.claude/skills`.
- Runtime dir (outside repo, gitignored): `~/.orchestrator/` → `opencode.merged.json`, `events/`.
- **The repo has ZERO git commits.** Many features you must build (worktrees, PR, branch) need a commit — make an initial commit early (ask/confirm message) or feature-gate gracefully.

### Hard rules
- Never copy secrets/tokens into the repo. The bridge file contains tokens (e.g. resend `Authorization`) — keep it in `~/.orchestrator/` mode 0600.
- No `any`; infer types from zod in `packages/contracts`. Small files, one responsibility. No comments unless they explain non-obvious intent. No barrel `index.ts` in packages.
- Never commit unless the user asks. Never push.
- Engram is unconfigured (no `.engram.env`) — don't push to it.

---

## 3. Verified runtime facts (trust these; they save hours)

**`opencode serve`** (default execution path)
- Spawn `opencode serve --port 0`; it prints `http://127.0.0.1:<port>` to stdout.
- API: `POST /session` `{title?,model:{id,providerID,variant?}}` → session id; `POST /session/{id}/message` `{model:{providerID,modelID},variant?,system?,parts:[{type:"text",text}]}`; `POST /session/{id}/abort`; `POST /session/{id}/fork`; SSE `GET /event`.
- OpenAPI spec at `GET /doc` while running — use it to discover routes.
- SSE mapping (`OpenCodeAdapter.serveTurn`): `message.part.delta` (field `text`, `properties.sessionID` filter) → assistant deltas; `message.part.updated` `part.type==="tool"` → `tool.called`/`tool.result` (dedup by `callID`, `state.status` pending→completed); `message.updated` assistant `error` → error; `session.idle` → `turn.completed`.
- Model id format `provider/model` with optional `#variant` → split to `{providerID, modelID, variant}`.
- Test model id: `opencode/deepseek-v4.1-flash-free`.

**MCP bridge**
- `OPENCODE_CONFIG` is **merged** with the user's global opencode config (verified). `enabled:false` in the bridge disables a globally-defined server.
- Shapes: local `{type:"local",command:[],environment?,enabled}`, remote `{type:"remote",url,headers?,enabled}`.
- Verified live: Antigravity `resend` connected with **134 tools**; `supabase`/`vercel` read "needs authentication" until `opencode mcp auth <name>`.

**Persistence**
- Journals are per-workspace, JSONL, flushed 100 ms / 256 events, flushed again on `close()`.
- On boot the journal is replayed into the read model, then `config.assemble()` overwrites config (see gap P1.1).

---

## 4. How to run & verify
- `pnpm dev` — sidecar + web (hot reload). `pnpm sidecar` — sidecar only. `pnpm tauri` — desktop (Rust installed).
- `pnpm typecheck` / `pnpm build` / `pnpm test` — must stay green.
- Smoke test without the desktop: run the sidecar (`ORCHESTRATOR_PORT=4123 pnpm sidecar`), connect a WS client to `ws://127.0.0.1:4123`, send `getSnapshot`, `dispatchCommand {kind:"StartThread",prompt,harness,model}`, and assert you receive `thread.started`, `message.delta`, `tool.called`/`tool.result`, `turn.completed`. (Write a throwaway client under `C:\Users\jhasu\AppData\Local\Temp\opencode\`; do not commit it.)
- Clean up orphaned servers: `netstat -ano | findstr LISTENING` then `taskkill //F //PID <pid>` (ports 4096/4123/4197-4199 have been used).

---

## 5. REMAINING WORK (ordered; each item = implement + wire UI + verify)

### Phase 1 — Correctness wiring (things the README claims but aren't actually wired)
1. **Persist user settings across restart.** `ConfigService` model/harness/skill toggles and `McpManager` MCP toggles are in-memory and get overwritten at boot.
   - Write `~/.orchestrator/config.json` (schema in `packages/contracts/config.ts`); load at boot and re-apply **after** `config.assemble()`.
   - Acceptance: toggle model + disable a harness/MCP/skill, restart sidecar, state is restored.
2. **Skill system-prompt injection is display-only.** `Orchestrator.ts:128-129` emits `skills.systemPrompt()` as a UI message but `sendTurn` never receives it; `OpenCodeServer.sendMessage` already accepts `system`.
   - Pass the enabled-skills prompt through `HarnessAdapter.sendTurn` (extend the signature/option) → `OpenCodeServer.sendMessage({system})`.
   - Acceptance: enabled skill text is present in the turn actually sent to OpenCode (log/verify).
3. **Client reconnect replay.** `replayEvents(fromSeq)` exists server-side but the web client never calls it; on WS reopen events during the gap are lost.
   - In `session.svelte.ts` `onState`, on transition to `open` call `replayEvents` with `lastSeq` and apply.
4. **Chat is rendered as plain text**, not markdown. `Message.svelte:11` uses `{message.text}`.
   - Render streaming markdown safely (reuse/extend `MarkdownPreview`); code blocks must be copyable.
5. **File create/rename/delete has a backend but no UI.** RPC + `FilesService` are done.
   - Add a FileTree context menu → `createPath`/`renamePath`/`deletePath`; refresh tree + git.
6. **MCP `callTool` is dead code.** Decide and document: agent turns get MCP tools **natively via the bridge**, so orchestrator-side routing isn't needed for turns.
   - Reuse `McpManager.callTool` for an explicit "Test tool" action in SettingsModal (invoke a tool with JSON args, show result), OR delete the dead path. Do not leave it half-dead.
7. **`harness.status` event is never emitted** though the schema + read model handle it. Emit it from `AdapterManager.startAll()` where harnesses connect/fail, or remove the schema. Prefer emit.

### Phase 2 — Multi-agent isolation (the headline feature)
8. **Per-thread git worktree + branch.** Today every agent shares one workspace/cwd.
   - For each `StartThread`, create worktree `~/.orchestrator/worktrees/<threadId>` on branch `orch/<shortId>` from HEAD; set the OpenCode session cwd to it; tag the thread with its branch/worktree.
   - UI: show branch per agent column; buttons to "Open diff", "Merge/PR", "Discard" (remove worktree + branch).
   - Acceptance: two agents editing the same file don't collide; each has an isolated checkout. (Needs ≥1 commit.)
9. **Per-agent model/harness picker** (currently all threads use the global dock model). Add a picker on `AgentColumn` and pass harness/model in `StartThread`.
10. **Retry and Fork.** Add `RetryThread` and `ForkThread` commands/events + UI. `OpenCodeServer.fork()` already exists and is unused.
11. **Virtualize agent columns/history** for dozens of agents (windowing).

### Phase 3 — Git & review flow
12. **Code-apply accept/reject.** When an agent turn produces file changes, surface a diff with per-hunk accept/reject that writes to the worktree. (Pairs with worktrees.)
13. **One-click PR.** Extend `GitService` with `createPullRequest` using `gh` (detect CLI; graceful error if absent). Add RPC + UI button after push.
14. **Staged diff + per-file stage.** `gitDiff` already accepts `staged`; `gitStage` accepts a path — wire both in the UI.
15. **Branch switch** (currently branch is display-only) — add a command with a safety check for dirty trees.

### Phase 4 — Desktop polish & packaging
16. **Window chrome.** `tauri.conf.json` sets `"decorations": false` and `lib.rs` builds the window programmatically, but `TitleBar.svelte` has three non-functional dots and no drag region/controls.
   - Add a `data-tauri-drag-region` and wire minimize/maximize/close (via `@tauri-apps/api/window`, already a dep but currently unused). Remove the dead `sidecar_url` command OR use it.
17. **CSP + `removeUnusedCommands`.** `tauri.conf.json` has `"csp": null`; set a strict CSP and enable command trimming.
18. **Open folder as workspace.** Workspace is fixed at launch (`ORCHESTRATOR_WORKSPACE`). Add a folder picker (Tauri dialog) that restarts/points the sidecar at the chosen workspace.
19. **Run the full desktop path once:** `pnpm tauri` → window loads bundled UI → sidecar spawns → send a prompt → see a streamed answer. Kill all child process groups on exit (Windows: job object).
20. **Packaging:** `pnpm tauri build`; validate icons; decide on updater (optional for v1).

### Phase 5 — Performance, tests, docs
21. Verify budgets (README §6): binary <25 MB, web <250 KB gz (excl. lazy Monaco), sidecar heap <80 MB idle, cold start.
22. Add tests for every new behavior (settings persistence, worktree lifecycle, replay, skill injection, PR parsing). Extend the existing `node --test` suite.
23. Update `README.md` checkmarks and `AGENTS.md` with any new verified facts. Keep `AGENTS.md` short and factual.

---

## 6. Definition of done
- All Phase 1 + Phase 2 items implemented, wired in the UI, and verified with a real run.
- `pnpm typecheck`, `pnpm build`, `pnpm test` all green; `cargo build` green; `pnpm tauri` opens and streams a real turn.
- New features covered by tests.
- No dead schema/commands left behind (emit or delete).
- No secrets in the repo; `~/.orchestrator` remains outside git.
- A short report: what changed, how you verified each item, remaining risks, and updated gates.

## 7. Non-goals (YAGNI)
No cloud sync, no mobile, no arbitrary provider plugin system, no light theme, no reimplementing
harness tooling, no billing. Terminal/xterm only if a concrete need appears.

## 8. Gotchas
- `OPENCODE_CONFIG` merges with the global config — a bridge entry is an override, not a replacement. Always include `enabled` explicitly.
- MCP HTTP handshake needs echoed `Mcp-Session-Id`, a `notifications/initialized`, source headers, and JSON-RPC id matching inside SSE.
- Sidecar startup must not block on MCP connects (`connectEnabled` is fire-and-forget; status streams as `mcp.status`).
- Worktrees/branches require at least one commit; handle the zero-commit repo gracefully.
- Windows process tree kill needs a job object or `taskkill //T`; killing the sidecar PID alone can orphan `opencode serve`.

## 9. Open decisions (ask the user)
- Worktree merge strategy: auto-merge to base branch, or always open a PR?
- Should the orchestrator-side MCP `callTool` path be kept (settings "test tool") or removed?
- Auto-update channel needed for v1?

## 10. Reference snapshot
```
packages/contracts/src/   events.ts rpc.ts readmodel.ts config.ts
services/sidecar/src/     index.ts server.ts Orchestrator.ts RequestHandlers.ts
  adapters/               HarnessAdapter.ts AdapterManager.ts OpenCodeAdapter.ts OpenCodeServer.ts AntigravityAdapter.ts
  mcp/                    McpManager.ts McpClient.ts mcpConfig.ts OpenCodeMcpBridge.ts
  skills/                 SkillsLoader.ts
  git/                    GitService.ts
  files/                  FilesService.ts
  config/                 paths.ts ConfigService.ts
  event/                  EventStore.ts ReadModel.ts Broadcaster.ts
  models/                 catalog.ts
apps/web/src/             App.svelte lib/{session.svelte.ts,rpc.ts,monaco.ts,icons.ts}
  components/             TitleBar FileTree EditorPane CodeEditor MarkdownPreview DiffView
                          AgentArea AgentColumn ChatDock HistorySidebar SettingsModal StatusBar ModelSelector Message
apps/desktop/src-tauri/   src/lib.rs tauri.conf.json Cargo.toml icons/
~/.orchestrator/          opencode.merged.json  events/<hash>.jsonl   (OUTSIDE the repo)
```

Start with Phase 1, keep the gates green after every change, and verify each item with a real run
before moving on. If a decision in §9 blocks you, implement the recommended default and note it.
