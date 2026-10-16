import type { Usage } from "@orchestrator/contracts";

export const fmtTokens = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
};

export const contextUsed = (usage: Usage): number =>
  (usage.input ?? 0) +
  (usage.output ?? 0) +
  (usage.reasoning ?? 0) +
  (usage.cacheRead ?? 0) +
  (usage.cacheWrite ?? 0);

export const contextPct = (usage: Usage): number | null => {
  if (!usage.contextLimit) return null;
  return Math.min(100, Math.round((contextUsed(usage) / usage.contextLimit) * 100));
};

export const usageTooltip = (usage: Usage): string => {
  const lines = [
    `input ${fmtTokens(usage.input)} · output ${fmtTokens(usage.output)}`,
    `cache read ${fmtTokens(usage.cacheRead ?? 0)} · write ${fmtTokens(usage.cacheWrite ?? 0)}`,
  ];
  if (usage.reasoning) lines.push(`reasoning ${fmtTokens(usage.reasoning)}`);
  if (usage.contextLimit) {
    lines.push(`context ${fmtTokens(contextUsed(usage))} / ${fmtTokens(usage.contextLimit)} (${contextPct(usage)}%)`);
  }
  if (typeof usage.cost === "number") lines.push(`cost $${usage.cost.toFixed(4)}`);
  return lines.join("\n");
};
