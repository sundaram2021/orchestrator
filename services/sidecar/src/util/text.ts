const OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const SINGLE = /\u001b[@-_]/g;

export const stripAnsi = (text: string): string =>
  text.replace(OSC, "").replace(CSI, "").replace(SINGLE, "");

export const normalizeText = (text: string): string => stripAnsi(text).replace(/\r\n?/g, "\n");

export const firstLine = (text: string, max = 160): string => {
  const line = normalizeText(text)
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export interface CleanToolText {
  text: string;
  truncated: boolean;
}

export const cleanToolText = (text: string, limit = 16_000): CleanToolText => {
  const normalized = normalizeText(text).replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!normalized) return { text: "", truncated: false };
  if (normalized.includes("\u0000")) return { text: "Binary output omitted.", truncated: false };
  if (normalized.length <= limit) return { text: normalized, truncated: false };
  return {
    text: `${normalized.slice(0, limit)}\n\n… output truncated (${normalized.length} chars)`,
    truncated: true,
  };
};
