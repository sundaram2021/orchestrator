export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const asStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
};

export const asBoolRecord = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "boolean") out[key] = val;
  }
  return out;
};

export const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
