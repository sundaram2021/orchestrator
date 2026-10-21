export interface ErrorExplanation {
  title: string;
  hint: string;
}

interface Rule {
  re: RegExp;
  title: string;
  hint: string;
}

const RULES: Rule[] = [
  {
    re: /maximum number of items is 128|Invalid value for 'tools'/i,
    title: "This model can't load that many tools",
    hint: "One of the enabled MCP servers exposes too many tools for this model. Disable a server or pick a different model.",
  },
  {
    re: /\b401\b|unauthorized|needs authentication|invalid api key|incorrect api key/i,
    title: "Authentication failed",
    hint: "Sign in again for this provider or MCP server, then retry.",
  },
  {
    re: /\b429\b|rate limit|too many requests/i,
    title: "Rate limited",
    hint: "The provider is throttling requests. Wait a moment and retry.",
  },
  {
    re: /fetch failed|ECONNREFUSED|ENOTFOUND|network error|socket hang up/i,
    title: "Can't reach the service",
    hint: "Check your connection, VPN, or proxy and try again.",
  },
  {
    re: /ENOENT|no such file|not found/i,
    title: "File or command not found",
    hint: "The path may have moved. Check the workspace and retry.",
  },
  {
    re: /context length|context window|too many tokens|token limit/i,
    title: "The conversation is too long",
    hint: "Start a new agent or reduce the amount of context in this thread.",
  },
  {
    re: /aborted|cancelled|canceled|interrupted/i,
    title: "Stopped",
    hint: "The run was interrupted before it finished.",
  },
  {
    re: /exit code|command failed|non-zero/i,
    title: "A command failed",
    hint: "Expand details to see the command output, then fix the cause and retry.",
  },
  {
    re: /not a git repository|no commits yet|dirty working tree/i,
    title: "Git can't do that here",
    hint: "This workspace needs a git repo with at least one commit, and no uncommitted conflicts.",
  },
];

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

const clean = (text: string): string => text.replace(ANSI, "").replace(/\r\n/g, "\n").trim();

export const firstLine = (text: string, max = 160): string => {
  const line = clean(text).split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export const explainError = (raw: string): ErrorExplanation => {
  const text = clean(raw);
  if (!text) {
    return {
      title: "Something went wrong",
      hint: "The run stopped unexpectedly. Retry, or expand details for the raw message.",
    };
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) return { title: rule.title, hint: rule.hint };
  }
  return {
    title: "Something went wrong",
    hint: "Expand details for the raw message, then retry or adjust the task.",
  };
};
