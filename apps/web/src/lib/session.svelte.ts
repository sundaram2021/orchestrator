import type {
  AppConfig,
  DomainEvent,
  FileNode,
  GitStatus,
  MessageView,
  ModelRef,
  ThreadView,
} from "@orchestrator/contracts";
import { RpcClient, type ConnState } from "./rpc";

export interface DockMessage {
  id: string;
  role: "user" | "system";
  text: string;
}

export type EditorView = "code" | "diff" | "markdown";
export type SettingsSection = "harnesses" | "mcp" | "skills";

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

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
  mode = $state<"ide" | "agent">("ide");
  activeThreadId = $state<string | null>(null);
  editorView = $state<EditorView>("code");
  settingsOpen = $state(false);
  settingsSection = $state<SettingsSection>("harnesses");
  dock = $state<DockMessage[]>([
    { id: uid(), role: "system", text: "Orchestrator ready. Pick a model below and send an instruction." },
  ]);

  tree = $state<FileNode[]>([]);
  openTabs = $state<string[]>([]);
  activeFile = $state<string | null>(null);
  fileContents = $state<Record<string, string>>({});
  dirty = $state<Record<string, boolean>>({});
  collapsed = $state<Record<string, boolean>>({});
  git = $state<GitStatus | null>(null);
  diff = $state("");
  commitMessage = $state("");
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
    this.client.onEvent(() => this.ensureActive());
    await this.bootstrap();
    this.client.connect();
  }

  private async onOpen(): Promise<void> {
    if (this.lastSeq >= 0) {
      try {
        const missed = await this.client.request("replayEvents", { fromSeq: this.lastSeq + 1 });
        for (const event of missed) this.applyEvent(event);
      } catch {
        /* next reconnect retries */
      }
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
      case "tool.called": {
        const t = this.findThread(e.threadId);
        if (!t) break;
        const last = t.messages[t.messages.length - 1];
        const target: MessageView =
          last && last.role === "assistant"
            ? last
            : { id: uid(), role: "assistant", text: "", tools: [] };
        if (target !== last) t.messages.push(target);
        target.tools.push({ callId: e.callId, tool: e.tool, args: e.args });
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
        this.ensureActive();
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

  private pushDock(role: DockMessage["role"], text: string): void {
    this.dock.push({ id: uid(), role, text });
  }

  private notify(text: string): void {
    this.toast = text;
    setTimeout(() => {
      if (this.toast === text) this.toast = null;
    }, 3200);
  }

  async send(prompt: string): Promise<void> {
    const text = prompt.trim();
    if (!text || !this.config) return;
    const { harness, id, name } = this.config.model;
    this.pushDock("user", text);
    this.pushDock("system", `Started agent on ${harness} · ${name}`);
    await this.client.request("dispatchCommand", {
      kind: "StartThread",
      prompt: text,
      harness,
      model: id,
    });
  }

  async stop(threadId: string): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "StopAgent", threadId });
  }

  async clearFinished(): Promise<void> {
    await this.client.request("dispatchCommand", { kind: "ClearFinished" });
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

  setMode(mode: "ide" | "agent"): void {
    this.mode = mode;
    this.settingsOpen = false;
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
    try {
      if (this.fileContents[path] === undefined) {
        const file = await this.client.request("readFile", { path });
        this.fileContents = { ...this.fileContents, [path]: file.content };
      }
      if (!this.openTabs.includes(path)) this.openTabs = [...this.openTabs, path];
      this.activeFile = path;
      this.editorView = "code";
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
  }

  async loadDiff(path?: string): Promise<void> {
    try {
      const result = await this.client.request("gitDiff", path ? { path } : {});
      this.diff = result.diff;
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err));
    }
  }

  async stageAll(): Promise<void> {
    await this.client.request("gitStage", {});
    await this.refreshGit();
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

  async launchAntigravity(): Promise<void> {
    const result = await this.client.request("launchAntigravity");
    this.notify(result.ok ? "Launching Antigravity IDE" : `Antigravity: ${result.detail}`);
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
