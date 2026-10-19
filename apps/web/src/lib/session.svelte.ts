import type {
  AntigravityStatus,
  AppConfig,
  Attachment,
  Checkpoint,
  DomainEvent,
  FileNode,
  GitBranches,
  GitStatus,
  MessageView,
  ModelRef,
  ThreadView,
} from "@orchestrator/contracts";
import { RpcClient, type ConnState } from "./rpc";

type EditorView = "code" | "diff" | "markdown";
export type SettingsSection = "harnesses" | "mcp" | "skills" | "updates";

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Normalize a file reference from markdown/tool output into a path the sidecar can read. */
export const normalizeFileRef = (raw: string): string | null => {
  let value = raw.trim().replace(/^[`"'<(]+|[`"'>)]+$/g, "");
  if (!value) return null;
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      value = decodeURIComponent(value.slice("file://".length));
    }
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
  }
  value = value.replace(/[#?].*$/, "").replace(/:(\d+)(?::\d+)?$/, "");
  value = value.trim();
  if (!value || /[\n\r]/.test(value)) return null;
  return value;
};

const resolveUrl = (): string => {
  if (typeof window === "undefined") return "ws://127.0.0.1:4123";
  if (window.__ORCHESTRATOR_WS__) return window.__ORCHESTRATOR_WS__;
  const param = new URLSearchParams(window.location.search).get("ws");
  if (param) return param;
  const env = import.meta.env.VITE_ORCHESTRATOR_WS as string | undefined;
  return env ?? "ws://127.0.0.1:4123";
};

class Session {
  config = $state<AppConfig | null>(null);
  threads = $state<ThreadView[]>([]);
  connection = $state<ConnState>("connecting");
  view = $state<"chat" | "editor">("chat");
  showRight = $state(true);
  rightTab = $state<"files" | "changes">("changes");
  favorites = $state<string[]>([]);
  activeThreadId = $state<string | null>(null);
  editorView = $state<EditorView>("code");
  settingsOpen = $state(false);
  settingsSection = $state<SettingsSection>("harnesses");

  tree = $state<FileNode[]>([]);
  openTabs = $state<string[]>([]);
  activeFile = $state<string | null>(null);
  fileContents = $state<Record<string, string>>({});
  dirty = $state<Record<string, boolean>>({});
  collapsed = $state<Record<string, boolean>>({});
  git = $state<GitStatus | null>(null);
  diff = $state("");
  commitMessage = $state("");
  branches = $state<GitBranches | null>(null);
  diffStaged = $state(false);
  diffPath = $state<string | null>(null);
  prTitle = $state("");
  prBody = $state("");
  checkpoints = $state<Record<string, Checkpoint[]>>({});
  antigravity = $state<AntigravityStatus | null>(null);
  antigravityAuthUrl = $state<string | null>(null);
  toast = $state<string | null>(null);

  private lastSeq = -1;
  private client = new RpcClient(resolveUrl());

  async init(): Promise<void> {
    this.client.onState((state) => {
      this.connection = state;
      if (state === "open") void this.onOpen();
      else this.client.pause();
    });
    this.client.onEvent((event) => this.applyEvent(event));
    await this.bootstrap();
    this.client.connect();
  }

  private async onOpen(): Promise<void> {
    if (this.lastSeq < 0) {
      await this.bootstrap();
      return;
    }
    try {
      const missed = await this.client.request("replayEvents", { fromSeq: this.lastSeq + 1 });
      for (const event of missed) this.applyEvent(event);
    } catch {
      /* next reconnect retries */
    }
    this.client.resume();
  }

  private async bootstrap(): Promise<void> {
    try {
      const snapshot = await this.client.request("getSnapshot");
      this.threads = snapshot.threads;
      this.config = snapshot.config;
      this.lastSeq = snapshot.lastSeq;
      if (!this.activeThreadId && this.threads[0]) this.activeThreadId = this.threads[0].id;
      this.client.resume();
      void this.refreshTree();
      void this.refreshGit();
      void this.refreshAntigravity();
    } catch {
      setTimeout(() => void this.bootstrap(), 1000);
    }
  }

  private ensureActive(): void {
    if (this.activeThreadId && !this.threads.some((t) => t.id === this.activeThreadId)) {
      this.activeThreadId = this.threads[this.threads.length - 1]?.id ?? null;
    } else if (!this.activeThreadId && this.threads[0]) {
      this.activeThreadId = this.threads[0].id;
    }
  }

  private findThread(id: string): ThreadView | undefined {
    return this.threads.find((t) => t.id === id);
  }

  private applyEvent(event: DomainEvent): void {
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    const e = event.event;

    switch (e.type) {
      case "thread.started": {
        const now = event.ts;
        this.threads.push({
          id: e.threadId,
          title: e.title,
          harness: e.harness,
          model: e.model,
          status: "running",
          createdAt: now,
          updatedAt: now,
          messages: [],
          ...(e.prompt ? { prompt: e.prompt } : {}),
          ...(e.branch ? { branch: e.branch } : {}),
          ...(e.worktree ? { worktree: e.worktree } : {}),
          ...(e.parentId ? { parentId: e.parentId } : {}),
          ...(e.attachments ? { attachments: e.attachments } : {}),
        });
        if (!this.activeThreadId) this.activeThreadId = e.threadId;
        break;
      }
      case "agent.status": {
        const t = this.findThread(e.threadId);
        if (t) t.status = e.status;
        break;
      }
      case "message.appended": {
        const t = this.findThread(e.threadId);
        if (t) t.messages.push({ id: e.messageId, role: e.role, text: e.text, tools: [] });
        break;
      }
      case "message.delta": {
        const t = this.findThread(e.threadId);
        const msg = t?.messages.find((m) => m.id === e.messageId);
        if (msg) msg.text += e.delta;
        break;
      }
      case "message.reasoning": {
        const t = this.findThread(e.threadId);
        const msg = t?.messages.find((m) => m.id === e.messageId);
        if (msg) msg.reasoning = (msg.reasoning ?? "") + e.delta;
        break;
      }
      case "tool.called": {
        const t = this.findThread(e.threadId);
        if (!t) break;
        const last = t.messages[t.messages.length - 1];
        const target: MessageView =
          last && last.role === "assistant"
            ? last
            : { id: uid(), role: "assistant", text: "", tools: [] };
        if (target !== last) t.messages.push(target);
        target.tools.push({ callId: e.callId, tool: e.tool, args: e.args, startedAt: event.ts });
        break;
      }
      case "tool.result": {
        const t = this.findThread(e.threadId);
        if (!t) break;
        for (const m of t.messages) {
          const tool = m.tools.find((x) => x.callId === e.callId);
          if (tool) {
            tool.ok = e.ok;
            tool.result = e.result;
            tool.endedAt = event.ts;
            break;
          }
        }
        break;
      }
      case "agent.error": {
        const t = this.findThread(e.threadId);
        if (t) {
          t.status = "error";
          t.messages.push({ id: uid(), role: "system", text: e.message, tools: [] });
        }
        break;
      }
      case "thread.removed": {
        this.threads = this.threads.filter((t) => t.id !== e.threadId);
        const checkpoints = { ...this.checkpoints };
        delete checkpoints[e.threadId];
        this.checkpoints = checkpoints;
        this.ensureActive();
        break;
      }
      case "usage.updated": {
        const t = this.findThread(e.threadId);
        if (t) t.usage = e.usage;
        break;
      }
      case "config.changed": {
        this.config = e.config;
        break;
      }
      case "harness.status": {
        const harness = this.config?.harnesses.find((h) => h.id === e.harnessId);
        if (harness && e.status) harness.status = e.status;
        break;
      }
      case "mcp.status": {
        const server = this.config?.mcp.find((m) => m.name === e.name);
        if (server) {
          server.status = e.status;
          if (e.tools.length) server.tools = e.tools;
        }
        break;
      }
      case "turn.completed":
        break;
    }
  }

  private notify(text: string): void {
    this.toast = text;
    setTimeout(() => {
      if (this.toast === text) this.toast = null;
    }, 3200);
  }

  async send(prompt: string, attachments?: Attachment[]): Promise<void> {
    const text = prompt.trim();
    if (!text || !this.config) return;
    const { harness, id } = this.config.model;
    this.view = "chat";
    await this.client.request("dispatchCommand", {
      kind: "StartThread",
      prompt: text,
      harness,
      model: id,
      ...(attachments?.length ? { attachments } : {}),
    });
  }

  async stop(threadId: string): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "StopAgent", threadId });
  }

  async clearFinished(): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "ClearFinished" });
  }

  async clearAll(): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "ClearAll" });
  }

  async retryThread(threadId: string, model?: string): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "RetryThread", threadId, ...(model ? { model } : {}) });
  }

  async forkThread(threadId: string): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "ForkThread", threadId });
  }

  async discardThread(threadId: string): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "DiscardThread", threadId });
  }

  async mergeThread(threadId: string): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "MergeThread", threadId });
  }

  async selectModel(model: ModelRef): Promise<void> {
    if (this.config) this.config.model = model;
    await this.client.request("dispatchCommand", { kind: "SetModel", model });
  }

  async toggle(target: "harness" | "mcp" | "skill", id: string, enabled: boolean): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "SetEnabled", target, id, enabled });
  }

  async setUpdateSettings(patch: { autoUpdate?: boolean; includeMajor?: boolean }): Promise<void> {
    if (this.config) {
      if (patch.autoUpdate !== undefined) this.config.updates.autoUpdate = patch.autoUpdate;
      if (patch.includeMajor !== undefined) this.config.updates.includeMajor = patch.includeMajor;
    }
    await this.client.request("dispatchCommand", { kind: "SetUpdateSettings", ...patch });
  }

  setView(view: "chat" | "editor"): void {
    this.view = view;
    this.settingsOpen = false;
  }

  toggleRight(): void {
    this.showRight = !this.showRight;
  }

  setRightTab(tab: "files" | "changes"): void {
    this.rightTab = tab;
    this.showRight = true;
  }

  toggleRightTab(tab: "files" | "changes"): void {
    if (this.showRight && this.rightTab === tab) {
      this.showRight = false;
    } else {
      this.rightTab = tab;
      this.showRight = true;
    }
  }

  toggleFavorite(id: string): void {
    this.favorites = this.favorites.includes(id)
      ? this.favorites.filter((f) => f !== id)
      : [...this.favorites, id];
  }

  selectThread(id: string): void {
    this.activeThreadId = id;
    this.view = "chat";
  }

  newAgent(): void {
    this.activeThreadId = null;
    this.view = "chat";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("orchestrator:focus-composer"));
    }
  }

  suggest(text: string): void {
    this.activeThreadId = null;
    this.view = "chat";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("orchestrator:set-composer", { detail: text }));
    }
  }

  get activeThread(): ThreadView | undefined {
    return this.threads.find((t) => t.id === this.activeThreadId);
  }

  openSettings(): void {
    this.settingsOpen = true;
  }

  closeSettings(): void {
    this.settingsOpen = false;
  }

  toggleDir(path: string): void {
    this.collapsed = { ...this.collapsed, [path]: !this.collapsed[path] };
  }

  async createPath(path: string, type: "file" | "dir"): Promise<void> {
    try {
      await this.client.request("createPath", { path, type });
      if (type === "file") await this.openFile(path);
      await this.refreshTree();
      await this.refreshGit();
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async renamePath(from: string, to: string): Promise<void> {
    try {
      await this.client.request("renamePath", { from, to });
      const contents = { ...this.fileContents };
      if (contents[from] !== undefined) {
        contents[to] = contents[from]!;
        delete contents[from];
        this.fileContents = contents;
      }
      this.openTabs = this.openTabs.map((t) => (t === from ? to : t));
      if (this.activeFile === from) this.activeFile = to;
      await this.refreshTree();
      await this.refreshGit();
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async deletePath(path: string): Promise<void> {
    try {
      await this.client.request("deletePath", { path });
      this.closeTab(path);
      await this.refreshTree();
      await this.refreshGit();
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async testTool(server: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.request("mcpCallTool", { server, tool, args });
    return result.result;
  }

  async refreshTree(): Promise<void> {
    try {
      this.tree = await this.client.request("listTree", {});
    } catch {
      /* ignore */
    }
  }

  async openFile(path: string): Promise<void> {
    const target = normalizeFileRef(path);
    if (!target) return;
    try {
      if (this.fileContents[target] === undefined) {
        const file = await this.client.request("readFile", { path: target });
        this.fileContents = { ...this.fileContents, [target]: file.content };
      }
      if (!this.openTabs.includes(target)) this.openTabs = [...this.openTabs, target];
      this.activeFile = target;
      this.editorView = "code";
      this.view = "editor";
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  closeTab(path: string): void {
    this.openTabs = this.openTabs.filter((t) => t !== path);
    const next = { ...this.fileContents };
    delete next[path];
    this.fileContents = next;
    const dirty = { ...this.dirty };
    delete dirty[path];
    this.dirty = dirty;
    if (this.activeFile === path) this.activeFile = this.openTabs[this.openTabs.length - 1] ?? null;
  }

  updateContent(path: string, content: string): void {
    this.fileContents = { ...this.fileContents, [path]: content };
    this.dirty = { ...this.dirty, [path]: true };
  }

  async saveActive(): Promise<void> {
    const path = this.activeFile;
    if (!path) return;
    try {
      await this.client.request("writeFile", { path, content: this.fileContents[path] ?? "" });
      const dirty = { ...this.dirty };
      delete dirty[path];
      this.dirty = dirty;
      this.notify(`Saved ${path}`);
      await this.refreshGit();
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async refreshGit(): Promise<void> {
    try {
      this.git = await this.client.request("gitStatus");
    } catch {
      this.git = null;
    }
    await this.refreshBranches();
  }

  async refreshBranches(): Promise<void> {
    try {
      this.branches = await this.client.request("gitBranches");
    } catch {
      this.branches = null;
    }
  }

  async loadDiff(path?: string, staged = this.diffStaged): Promise<void> {
    this.diffPath = path ?? null;
    try {
      const params: { path?: string; staged?: boolean } = {};
      if (path) params.path = path;
      if (staged) params.staged = true;
      const result = await this.client.request("gitDiff", params);
      this.diff = result.diff;
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async setDiffStaged(staged: boolean): Promise<void> {
    this.diffStaged = staged;
    await this.loadDiff(this.diffPath ?? undefined, staged);
  }

  async openDiff(path: string): Promise<void> {
    this.activeFile = path;
    this.editorView = "diff";
    this.view = "editor";
    await this.loadDiff(path);
  }

  async stageAll(): Promise<void> {
    await this.client.request("gitStage", {});
    await this.refreshGit();
  }

  async stageFile(path: string): Promise<void> {
    await this.client.request("gitStage", { path });
    await this.refreshGit();
  }

  async checkout(branch: string): Promise<void> {
    if (branch === this.git?.branch) return;
    const result = await this.client.request("gitCheckout", { branch });
    this.notify(result.ok ? `Switched to ${branch}` : result.output || "Checkout failed");
    if (result.ok) await this.refreshGit();
  }

  async createPr(): Promise<void> {
    const title = this.prTitle.trim() || `Orchestrator: ${this.git?.branch ?? "changes"}`;
    const body = this.prBody.trim();
    const result = await this.client.request("gitCreatePr", body ? { title, body } : { title });
    this.notify(result.ok ? result.output || "Pull request created" : result.output || "PR failed");
  }

  async loadCheckpoints(threadId: string): Promise<void> {
    try {
      this.checkpoints[threadId] = await this.client.request("listCheckpoints", { threadId });
    } catch {
      this.checkpoints[threadId] = [];
    }
  }

  async createCheckpoint(threadId: string): Promise<void> {
    const result = await this.client.request("createCheckpoint", { threadId });
    this.notify(result.ok ? `Checkpoint ${result.sha}` : result.output || "Checkpoint failed");
    await this.loadCheckpoints(threadId);
  }

  async restoreCheckpoint(threadId: string, sha: string): Promise<void> {
    if (!confirm(`Restore this agent's worktree to ${sha}? Later changes will be discarded.`)) return;
    const result = await this.client.request("restoreCheckpoint", { threadId, sha });
    this.notify(result.ok ? `Restored to ${sha}` : result.output || "Restore failed");
    await this.loadCheckpoints(threadId);
  }

  async landThread(threadId: string, title?: string): Promise<void> {
    const result = await this.client.request(
      "landThread",
      title && title.trim() ? { threadId, title: title.trim() } : { threadId },
    );
    this.notify(result.ok ? result.output || "Pull request opened" : result.output || "Landing failed");
    await this.loadCheckpoints(threadId);
  }

  async push(): Promise<void> {
    const result = await this.client.request("gitPush");
    this.notify(result.ok ? "Pushed" : result.output || "Push failed");
    await this.refreshGit();
  }

  async commit(): Promise<void> {
    const message = this.commitMessage.trim();
    if (!message) return;
    const result = await this.client.request("gitCommit", { message });
    this.notify(result.ok ? "Committed" : result.output || "Commit failed");
    if (result.ok) this.commitMessage = "";
    await this.refreshGit();
  }

  async commitAndPush(): Promise<void> {
    const message = this.commitMessage.trim();
    if (!message) return;
    const committed = await this.client.request("gitCommit", { message });
    if (!committed.ok) {
      this.notify(committed.output || "Commit failed");
      return;
    }
    this.commitMessage = "";
    const pushed = await this.client.request("gitPush");
    this.notify(pushed.ok ? "Committed & pushed" : pushed.output || "Push failed");
    await this.refreshGit();
  }

  async refreshAntigravity(): Promise<void> {
    try {
      this.antigravity = await this.client.request("antigravityStatus");
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async installAntigravity(): Promise<void> {
    this.notify("Installing Antigravity agent…");
    try {
      this.antigravity = await this.client.request("installAntigravity");
      this.notify("Antigravity agent installed");
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async signInAntigravity(): Promise<void> {
    this.antigravityAuthUrl = null;
    try {
      const result = await this.client.request("antigravitySignIn");
      this.antigravityAuthUrl = result.url;
      this.notify("Open the sign-in link to authenticate with Google.");
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async completeAntigravitySignIn(callbackUrl: string): Promise<void> {
    try {
      const result = await this.client.request("antigravitySignInComplete", { callbackUrl });
      this.notify(result.ok ? "Antigravity signed in" : "Sign-in callback failed");
      await this.refreshAntigravity();
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async cancelAntigravitySignIn(): Promise<void> {
    this.antigravityAuthUrl = null;
    await this.client.request("antigravitySignInCancel");
  }

  async openWorkspace(): Promise<void> {
    if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) {
      this.notify("Open folder is only available in the desktop app.");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      const { invoke } = await import("@tauri-apps/api/core");
      const url = await invoke<string>("restart_sidecar", { workspace: selected });
      this.threads = [];
      this.activeThreadId = null;
      this.git = null;
      this.checkpoints = {};
      this.lastSeq = -1;
      this.client.setUrl(url);
      this.notify(`Workspace: ${selected}`);
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }
}

export const session = new Session();

export const harnessOf = (id: string) => session.config?.harnesses.find((h) => h.id === id);
export const harnessName = (id: string) => harnessOf(id)?.name ?? id;
export const runningCount = () => session.threads.filter((t) => t.status === "running").length;
export const allModels = (): Array<{ id: string; name: string; harness: string }> =>
  (session.config?.harnesses ?? [])
    .filter((h) => h.enabled)
    .flatMap((h) => h.models.map((m) => ({ id: m.id, name: m.name, harness: h.id })));
