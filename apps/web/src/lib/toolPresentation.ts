import type { McpServerConfig, ThreadView, ToolView } from "@orchestrator/contracts";
import {
  matchMcpServer,
  mcpLeaf,
  parseToolArgs,
  parseToolResult,
  toolCategory,
  toolLabel,
  toolSummary,
  type ToolCategory,
  type ToolRecord,
} from "./toolText";

export type ToolBody =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "records"; items: ToolRecord[] }
  | { kind: "fields"; entries: Array<{ key: string; value: string }> }
  | { kind: "list"; items: string[] };

export interface ToolPresentation {
  category: ToolCategory;
  action: string;
  target: string;
  preview: string;
  body: ToolBody;
  truncated: boolean;
}

export interface ToolContext {
  threads?: ThreadView[];
  servers?: McpServerConfig[];
}

const ORCH_ACTIONS: Record<string, string> = {
  capabilities: "Checked capabilities",
  create_thread: "Created agent",
  delegate_task: "Delegated task",
  task_status: "Checked agent status",
  task_cancel: "Cancelled task",
  thread_list: "Listed agents",
  thread_read: "Read agent transcript",
  thread_wait: "Waited for agent",
  thread_interrupt: "Interrupted agent",
  send_message: "Messaged agent",
  memory_write: "Saved memory",
  memory_search: "Searched memory",
  memory_list: "Listed memory",
  agent_registry: "Read agent registry",
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const countLines = (text: string): number => (text ? text.split("\n").length : 0);

const firstLine = (text: string, max = 140): string => {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const clip = (text: string, max = 140): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const humanizeIds = (text: string, threads: ThreadView[]): string =>
  text
    .replace(/th_[A-Za-z0-9-]+/g, (id) => {
      const thread = threads.find((candidate) => candidate.id === id);
      return thread ? `“${thread.title}”` : "an agent";
    })
    .replace(/\bnote_[A-Za-z0-9-]+/gi, "")
    .replace(/[ \t]{2,}/g, " ");

const bodyOf = (result?: string): ToolBody => {
  const view = parseToolResult(result);
  switch (view.kind) {
    case "empty":
      return { kind: "none" };
    case "text":
      return { kind: "text", text: view.text };
    case "records":
      return { kind: "records", items: view.items };
    case "fields":
      return { kind: "fields", entries: view.entries };
    case "list":
      return { kind: "list", items: view.items };
  }
};

const humanizeBody = (body: ToolBody, threads: ThreadView[]): ToolBody =>
  body.kind === "text" ? { kind: "text", text: humanizeIds(body.text, threads) } : body;

const previewOf = (body: ToolBody): string => {
  switch (body.kind) {
    case "none":
      return "";
    case "text":
      return body.text ? `${countLines(body.text)} lines` : "";
    case "records":
      return `${body.items.length} result${body.items.length === 1 ? "" : "s"}`;
    case "fields":
      return `${body.entries.length} field${body.entries.length === 1 ? "" : "s"}`;
    case "list":
      return `${body.items.length} item${body.items.length === 1 ? "" : "s"}`;
  }
};

const diffCounts = (text: string): { added: number; removed: number } | null => {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return added || removed ? { added, removed } : null;
};

const matchCount = (text: string): number => {
  if (/no matches|no results|0 matches/i.test(text)) return 0;
  const lines = text.split("\n").filter(Boolean);
  const hits = lines.filter((line) => /^.+?:\d+[:|-]/.test(line)).length;
  return hits || lines.length;
};

const jsonObject = (text: string): Record<string, unknown> | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const statusOf = (text: string): string => {
  if (/\bis running\b/i.test(text)) return "running";
  if (/\bfinished\b/i.test(text)) return "done";
  if (/\bhit an error\b/i.test(text)) return "error";
  if (/\bwas stopped\b/i.test(text)) return "stopped";
  if (/\btimed out\b/i.test(text)) return "still running";
  return "";
};

export const describeTool = (tool: ToolView, ctx: ToolContext = {}): ToolPresentation => {
  const threads = ctx.threads ?? [];
  const servers = ctx.servers ?? [];
  const args = parseToolArgs(tool.args);
  const name = tool.tool;
  const raw = tool.result ?? "";
  const body = bodyOf(raw);
  const truncated = tool.truncated === true;
  const failed = tool.ok === false;

  if (name.startsWith("orchestrator_")) {
    const leaf = name.replace(/^orchestrator_/, "");
    const target = humanizeIds(toolSummary(name, tool.args), threads) || toolLabel(leaf);
    let preview = previewOf(body);
    if (leaf.startsWith("memory") && body.kind === "text") preview = clip(firstLine(body.text), 90);
    else if (leaf === "thread_list" || leaf === "agent_registry") {
      const count = (raw.match(/\n\s*id:/g) ?? []).length;
      preview = `${count} agent${count === 1 ? "" : "s"}`;
    } else if (leaf === "delegate_task" || leaf === "task_status" || leaf === "thread_wait") {
      preview = statusOf(raw) || preview;
    } else if (leaf === "create_thread") preview = "started";
    else if (leaf === "send_message") preview = "sent";
    else if (leaf === "task_cancel" || leaf === "thread_interrupt") preview = "stopped";
    return {
      category: "agent",
      action: ORCH_ACTIONS[leaf] ?? toolLabel(leaf),
      target,
      preview: failed ? "failed" : preview,
      body: humanizeBody(body, threads),
      truncated,
    };
  }

  const server = matchMcpServer(name, servers);
  if (server) {
    const target = humanizeIds(toolSummary(name, tool.args), threads) || server;
    return {
      category: "mcp",
      action: toolLabel(mcpLeaf(name, server)),
      target,
      preview: failed ? "failed" : previewOf(body) || server,
      body,
      truncated,
    };
  }

  const category = toolCategory(name);
  switch (category) {
    case "run": {
      const command =
        str(args.command) ??
        str(args.command_line) ??
        str(args.cmd) ??
        str(args.script) ??
        toolSummary(name, tool.args);
      return {
        category,
        action: "Ran command",
        target: clip(humanizeIds(command, threads)),
        preview: failed ? "failed" : previewOf(body) || "no output",
        body,
        truncated,
      };
    }
    case "read": {
      const meta = jsonObject(raw);
      const metaKeys = meta ? Object.keys(meta) : [];
      const metadataOnly =
        metaKeys.length > 0 &&
        metaKeys.every((key) => ["filePath", "path", "lines", "bytes"].includes(key));
      const lines = num(meta?.lines);
      const bytes = num(meta?.bytes);
      let preview = lines ? `${lines} lines` : previewOf(body);
      if (bytes) preview = `${preview} · ${formatBytes(bytes)}`;
      return {
        category,
        action: "Read file",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : preview || "done",
        body: metadataOnly ? { kind: "none" } : body,
        truncated,
      };
    }
    case "write": {
      const counts = diffCounts(raw);
      return {
        category,
        action: "Edited file",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed
          ? "failed"
          : counts
            ? `+${counts.added} −${counts.removed}`
            : body.kind === "none"
              ? "done"
              : previewOf(body),
        body,
        truncated,
      };
    }
    case "search":
      return {
        category,
        action: "Searched",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : `${matchCount(raw)} matches`,
        body,
        truncated,
      };
    case "list":
      return {
        category,
        action: "Listed",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : `${countLines(raw)} entries`,
        body,
        truncated,
      };
    case "web": {
      const query = str(args.query) ?? str(args.q);
      const url = str(args.url);
      const isSearch = /search/i.test(name) || !!query;
      const target = humanizeIds(
        isSearch ? (query ?? toolSummary(name, tool.args)) : url ? host(url) : toolSummary(name, tool.args),
        threads,
      );
      return {
        category,
        action: isSearch ? "Searched the web" : "Fetched",
        target,
        preview: failed ? "failed" : previewOf(body) || (isSearch ? "searched" : "fetched"),
        body,
        truncated,
      };
    }
    case "agent":
      return {
        category,
        action: "Delegated task",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : statusOf(raw) || previewOf(body),
        body: humanizeBody(body, threads),
        truncated,
      };
    case "todo":
      return {
        category,
        action: "Updated plan",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : previewOf(body) || "updated",
        body,
        truncated,
      };
    case "browser":
      return {
        category,
        action: "Browsed",
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : previewOf(body) || "done",
        body,
        truncated,
      };
    case "skill":
      return {
        category,
        action: "Used skill",
        target: humanizeIds(toolSummary(name, tool.args), threads) || toolLabel(name),
        preview: failed ? "failed" : previewOf(body) || "loaded",
        body,
        truncated,
      };
    case "mcp":
      return {
        category,
        action: toolLabel(name),
        target: humanizeIds(toolSummary(name, tool.args), threads),
        preview: failed ? "failed" : previewOf(body),
        body,
        truncated,
      };
    case "other":
      return {
        category,
        action: "Used tool",
        target: humanizeIds(toolSummary(name, tool.args), threads) || toolLabel(name),
        preview: failed ? "failed" : previewOf(body) || "done",
        body,
        truncated,
      };
  }
};
