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
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return map[ext] ?? "··";
};

export const languageOf = (path: string): string => {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
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
