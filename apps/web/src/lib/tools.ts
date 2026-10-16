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

export const toolSummary = (name: string, args: string): string => {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
  } catch {
    return args.slice(0, 110);
  }
  const pick =
    str(obj.command) ??
    str(obj.filePath) ??
    str(obj.path) ??
    str(obj.file) ??
    str(obj.pattern) ??
    str(obj.query) ??
    str(obj.url) ??
    str(obj.description) ??
    str(obj.prompt) ??
    str(obj.name);
  if (pick) return pick.length > 120 ? `${pick.slice(0, 117)}…` : pick;
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
