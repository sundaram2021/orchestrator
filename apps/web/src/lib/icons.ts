import type { Component } from "svelte";
import { extOf } from "./paths";
import {
  FileCode,
  FileText,
  FileJson,
  FileCog,
  FileImage,
  FileTerminal,
  FileType,
  File as FileIcon,
} from "@lucide/svelte";

const map: Record<string, string> = {
  ts: "TS",
  tsx: "TS",
  js: "JS",
  jsx: "JS",
  mjs: "JS",
  cjs: "JS",
  svelte: "SV",
  json: "{}",
  md: "MD",
  markdown: "MD",
  css: "CS",
  scss: "SC",
  html: "HT",
  rs: "RS",
  toml: "TM",
  yml: "YL",
  yaml: "YL",
  sh: "SH",
  py: "PY",
  go: "GO",
  lock: "LK",
};

export const fileIcon = (name: string): string => {
  const ext = extOf(name);
  return map[ext] ?? "··";
};

export const fileGlyph = (name: string): Component => {
  const ext = extOf(name);
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "svelte", "vue", "rs", "go", "py", "rb", "java", "c", "cpp", "h", "cs", "php", "css", "scss", "html", "sh", "sql"].includes(ext))
    return FileCode;
  if (["json", "jsonc", "yml", "yaml", "toml", "lock"].includes(ext)) return FileJson;
  if (["md", "markdown"].includes(ext)) return FileText;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) return FileImage;
  if (["sh", "bash", "zsh", "bat", "ps1", "cmd"].includes(ext)) return FileTerminal;
  if (["conf", "ini", "env", "cfg"].includes(ext)) return FileCog;
  if (["txt", "log"].includes(ext)) return FileType;
  return FileIcon;
};

export const languageOf = (path: string): string => {
  const ext = extOf(path);
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "html":
      return "html";
    case "md":
    case "markdown":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "sh":
      return "shell";
    case "go":
      return "go";
    default:
      return "plaintext";
  }
};
