import type { Component } from "svelte";
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
import { toolCategory, type ToolCategory } from "./toolText";

export * from "./toolText";

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

export const toolIcon = (name: string): Component => ICONS[toolCategory(name)];
