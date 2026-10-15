import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelRef } from "@orchestrator/contracts";

type Overrides = Record<string, boolean>;

interface SettingsData {
  model?: ModelRef;
  harnesses: Overrides;
  mcp: Overrides;
  skills: Overrides;
  updates: { autoUpdate?: boolean; includeMajor?: boolean };
}

const asOverrides = (value: unknown): Overrides => {
  if (!value || typeof value !== "object") return {};
  const out: Overrides = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "boolean") out[key] = val;
  }
  return out;
};

export class SettingsStore {
  private data: SettingsData;

  constructor(private readonly file?: string) {
    this.data = this.load();
  }

  private load(): SettingsData {
    const empty: SettingsData = { harnesses: {}, mcp: {}, skills: {}, updates: {} };
    if (!this.file) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      const updates = (parsed.updates ?? {}) as Record<string, unknown>;
      return {
        model: parsed.model as ModelRef | undefined,
        harnesses: asOverrides(parsed.harnesses),
        mcp: asOverrides(parsed.mcp),
        skills: asOverrides(parsed.skills),
        updates: {
          autoUpdate: typeof updates.autoUpdate === "boolean" ? updates.autoUpdate : undefined,
          includeMajor: typeof updates.includeMajor === "boolean" ? updates.includeMajor : undefined,
        },
      };
    } catch {
      return empty;
    }
  }

  private write(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    } catch {
      /* best-effort; settings are non-critical */
    }
  }

  get model(): ModelRef | undefined {
    return this.data.model;
  }

  setModel(model: ModelRef): void {
    this.data.model = model;
    this.write();
  }

  harnessEnabled(id: string, fallback: boolean): boolean {
    return this.data.harnesses[id] ?? fallback;
  }

  setHarness(id: string, enabled: boolean): void {
    this.data.harnesses[id] = enabled;
    this.write();
  }

  mcpEnabled(name: string, fallback: boolean): boolean {
    return this.data.mcp[name] ?? fallback;
  }

  setMcp(name: string, enabled: boolean): void {
    this.data.mcp[name] = enabled;
    this.write();
  }

  skillEnabled(name: string, fallback: boolean): boolean {
    return this.data.skills[name] ?? fallback;
  }

  setSkill(name: string, enabled: boolean): void {
    this.data.skills[name] = enabled;
    this.write();
  }

  get autoUpdate(): boolean {
    return this.data.updates.autoUpdate ?? true;
  }

  get includeMajor(): boolean {
    return this.data.updates.includeMajor ?? true;
  }

  setAutoUpdate(enabled: boolean): void {
    this.data.updates.autoUpdate = enabled;
    this.write();
  }

  setIncludeMajor(enabled: boolean): void {
    this.data.updates.includeMajor = enabled;
    this.write();
  }
}
