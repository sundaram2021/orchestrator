type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.ORCHESTRATOR_LOG_LEVEL as Level) ?? "info"] ?? 20;

const emit = (level: Level, scope: string, message: string, extra?: unknown): void => {
  if (order[level] < threshold) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${scope}: ${message}`;
  if (level === "error") console.error(line, extra ?? "");
  else console.log(line, extra ?? "");
};

export const logger = (scope: string) => ({
  debug: (m: string, e?: unknown) => emit("debug", scope, m, e),
  info: (m: string, e?: unknown) => emit("info", scope, m, e),
  warn: (m: string, e?: unknown) => emit("warn", scope, m, e),
  error: (m: string, e?: unknown) => emit("error", scope, m, e),
});
