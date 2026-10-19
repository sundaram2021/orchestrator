import type { Component } from "svelte";
import type { McpServerConfig } from "@orchestrator/contracts";
import {
  Terminal,
  FileText,
  FilePen,
  Search,
  FolderTree,
  Globe,
  ListChecks,
  Bot,
  Plug,
  Wrench,
  Eye,
  BookOpen,
} from "@lucide/svelte";

export type ToolCategory =
  | "run"
  | "read"
  | "write"
  | "search"
  | "list"
  | "web"
  | "agent"
  | "todo"
  | "browser"
  | "skill"
  | "mcp"
  | "other";

const RULES: Array<{ cat: ToolCategory; re: RegExp }> = [
  { cat: "run", re: /(bash|shell|exec|terminal|command|process|^run$|_run|run_command)/ },
  { cat: "write", re: /(write|edit|patch|apply|replace|multiedit|create_file|str_replace|insert|notebook)/ },
  { cat: "read", re: /(read|view|^cat$|open|file_read|get_file|read_file)/ },
  { cat: "search", re: /(grep|search|find|glob|ripgrep|^rg$)/ },
  { cat: "list", re: /(list|^ls$|tree|dir|folder)/ },
  { cat: "web", re: /(fetch|web|http|curl|browse|url|download)/ },
  { cat: "todo", re: /(todo|plan|checklist|steps|task_list)/ },
  { cat: "agent", re: /(task|agent|subagent|delegate|spawn)/ },
  { cat: "browser", re: /(browser|screenshot|playwright|puppeteer)/ },
  { cat: "skill", re: /skill/ },
];

export const toolCategory = (name: string): ToolCategory => {
  const n = name.toLowerCase();
  for (const { cat, re } of RULES) if (re.test(n)) return cat;
  return "other";
};

const ICONS: Record<ToolCategory, Component> = {
  run: Terminal,
  read: FileText,
  write: FilePen,
  search: Search,
  list: FolderTree,
  web: Globe,
  agent: Bot,
  todo: ListChecks,
  browser: Eye,
  skill: BookOpen,
  mcp: Plug,
  other: Wrench,
};

export const categoryIcon = (cat: ToolCategory): Component => ICONS[cat];
export const toolIcon = (name: string): Component => ICONS[toolCategory(name)];

const ACTIONS: Record<ToolCategory, string> = {
  run: "Ran command",
  read: "Read",
  write: "Edited",
  search: "Searched",
  list: "Listed",
  web: "Fetched",
  agent: "Ran agent",
  todo: "Updated plan",
  browser: "Browsed",
  skill: "Used skill",
  mcp: "Called",
  other: "",
};

export const toolAction = (name: string): string => ACTIONS[toolCategory(name)];

const ACTIVITY: Record<ToolCategory, string> = {
  run: "Running a command",
  read: "Reading a file",
  write: "Editing a file",
  search: "Searching the code",
  list: "Listing files",
  web: "Fetching the web",
  agent: "Running a sub-agent",
  todo: "Updating the plan",
  browser: "Browsing a page",
  skill: "Loading a skill",
  mcp: "Calling an MCP tool",
  other: "Using a tool",
};

export const toolActivity = (name: string): string => ACTIVITY[toolCategory(name)];

const pretty = (name: string): string =>
  name
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const toolLabel = (name: string): string => pretty(name);

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** Trim absolute/worktree paths down to just the file name for compact display. */
export const shortPath = (value: string): string => {
  const trimmed = value.trim();
  const stripped = trimmed.replace(/^.*?worktrees[\\/][^\\/]+[\\/]/i, "");
  const candidate = stripped !== trimmed ? stripped : trimmed;
  if (!/[\\/]/.test(candidate)) return candidate;
  const isAbsolute =
    /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("/") || candidate.startsWith("\\\\");
  if (!isAbsolute) return candidate;
  const segments = candidate.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? candidate;
};

export const toolSummary = (name: string, args: string): string => {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
  } catch {
    return args.slice(0, 110);
  }
  const limit = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}…` : text);
  const command = str(obj.command);
  if (command) return limit(command);
  const pathPick =
    str(obj.filePath) ??
    str(obj.path) ??
    str(obj.file) ??
    str(obj.absolutePath) ??
    str(obj.filename) ??
    str(obj.target);
  if (pathPick) return limit(shortPath(pathPick));
  const pick =
    str(obj.pattern) ??
    str(obj.query) ??
    str(obj.url) ??
    str(obj.description) ??
    str(obj.prompt) ??
    str(obj.name);
  if (pick) return limit(pick);
  const first = Object.values(obj).find((v) => typeof v === "string");
  return typeof first === "string" ? first.slice(0, 110) : "";
};

export const toolIsEdit = (name: string): boolean => toolCategory(name) === "write";

/** Match an OpenCode tool name against a configured MCP server (namespacing varies). */
export const matchMcpServer = (toolName: string, servers: McpServerConfig[]): string | null => {
  const n = toolName.toLowerCase();
  for (const server of servers) {
    const sn = server.name.toLowerCase();
    if (
      n === sn ||
      n.startsWith(`${sn}_`) ||
      n.startsWith(`${sn}-`) ||
      n.startsWith(`${sn}.`) ||
      n.startsWith(`${sn}/`) ||
      n.startsWith(`mcp_${sn}`) ||
      n.startsWith(`mcp__${sn}`) ||
      n.startsWith(`${sn}__`)
    ) {
      return server.name;
    }
  }
  return null;
};

/** Strip the MCP server prefix so only the tool leaf name is shown. */
export const mcpLeaf = (toolName: string, server: string): string =>
  toolName
    .replace(new RegExp(`^mcp__?${server}[_./-]*`, "i"), "")
    .replace(new RegExp(`^${server}[_./-]*`, "i"), "")
    .replace(/^mcp__?/, "") || toolName;

export type ToolRecord = { title: string; snippet?: string; url?: string; meta?: string };

export type ToolResultView =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "records"; items: ToolRecord[] }
  | { kind: "fields"; entries: Array<{ key: string; value: string }> };

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const firstString = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = asString(obj[key]);
    if (value) return value;
  }
  return undefined;
};

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toRecord = (value: unknown): ToolRecord | null => {
  if (typeof value === "string") return value.trim() ? { title: value.trim() } : null;
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const title =
    firstString(obj, ["title", "name", "heading", "label", "query", "question", "path", "file"]) ??
    "";
  const url = firstString(obj, ["url", "link", "href", "sourceUrl"]);
  if (!title && !url) return null;
  const snippet =
    firstString(obj, ["snippet", "description", "summary", "text", "content", "body", "excerpt"]) ??
    undefined;
  const meta =
    firstString(obj, ["source", "site", "domain", "host", "section", "type"]) ?? undefined;
  return { title: title || (url ?? ""), snippet: snippet === title ? undefined : snippet, url, meta };
};

const recordsFromText = (text: string): ToolRecord[] | null => {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length < 2) return null;
  const withUrl = blocks.filter((block) => /https?:\/\//.test(block));
  if (withUrl.length < 2 || withUrl.length < blocks.length / 2) return null;
  const items: ToolRecord[] = [];
  for (const block of blocks) {
    const url = /https?:\/\/\S+/.exec(block)?.[0];
    const lines = block.split("\n").map((line) => line.trim());
    const title = lines.find((line) => line && line !== url) ?? url ?? "";
    const rest = lines.filter((line) => line && line !== title && line !== url);
    items.push({
      title: title.replace(/^[-*#>\d.\s]+/, "").slice(0, 200),
      snippet: rest.join(" ").slice(0, 400) || undefined,
      url,
    });
  }
  return items.length ? items : null;
};

export const parseToolResult = (raw?: string): ToolResultView => {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "empty" };
  if (text.length > 1 && (text[0] === "{" || text[0] === "[")) {
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }
    if (json !== undefined && json !== null) {
      if (Array.isArray(json)) {
        const items = json.map(toRecord);
        if (items.length && items.every((item): item is ToolRecord => item !== null)) {
          return { kind: "records", items };
        }
        return { kind: "text", text };
      }
      if (typeof json === "object") {
        const obj = json as Record<string, unknown>;
        const keys = Object.keys(obj);
        const body = firstString(obj, [
          "text",
          "content",
          "output",
          "stdout",
          "result",
          "message",
          "description",
          "answer",
        ]);
        if (body && keys.length <= 3) return { kind: "text", text: body };
        const entries = keys.map((key) => ({ key, value: stringifyValue(obj[key]) }));
        if (entries.length && entries.length <= 20 && entries.every((e) => e.value.length <= 500)) {
          return { kind: "fields", entries };
        }
        return { kind: "text", text: body ?? text };
      }
      return { kind: "text", text: stringifyValue(json) };
    }
  }
  const records = recordsFromText(text);
  if (records) return { kind: "records", items: records };
  return { kind: "text", text };
};

