import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import type { SkillConfig } from "@orchestrator/contracts";
import { skillDirs } from "../config/paths.js";

interface Frontmatter {
  name?: string;
  description?: string;
}

export function parseSkillFile(file: string): { meta: Frontmatter; body: string } {
  const text = readFileSync(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const raw = match[1] ?? "";
  const body = match[2] ?? "";
  const meta: Frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") meta.name = value;
    if (key === "description") meta.description = value;
  }
  return { meta, body };
}

export class SkillsLoader {
  private skills: SkillConfig[];

  constructor() {
    this.skills = this.scan();
  }

  list(): SkillConfig[] {
    return this.skills;
  }

  get enabledCount(): number {
    return this.skills.filter((s) => s.enabled).length;
  }

  setEnabled(name: string, enabled: boolean): SkillConfig | undefined {
    const skill = this.skills.find((s) => s.name === name);
    if (skill) skill.enabled = enabled;
    return skill;
  }

  private scan(): SkillConfig[] {
    const found = new Map<string, SkillConfig>();
    for (const dir of skillDirs) {
      if (!existsSync(dir)) continue;
      for (const entry of this.readDir(dir)) {
        const skillFile = path.join(entry, "SKILL.md");
        const target = existsSync(skillFile) ? skillFile : entry.endsWith(".md") ? entry : null;
        if (!target) continue;
        try {
          const { meta, body } = parseSkillFile(target);
          const name = meta.name || path.basename(path.dirname(target)) || path.basename(target, ".md");
          if (found.has(name)) continue;
          const description =
            meta.description ||
            body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"))?.trim() ||
            "";
          found.set(name, { name, description, path: target, enabled: true });
        } catch {
          continue;
        }
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private readDir(dir: string): string[] {
    try {
      return readdirSync(dir).map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  }

  systemPrompt(): string {
    const enabled = this.skills.filter((s) => s.enabled);
    if (enabled.length === 0) return "";
    const lines = enabled.map((s) => `- ${s.name}: ${s.description}`);
    return `Available skills:\n${lines.join("\n")}`;
  }

  matchInvocation(prompt: string): { name: string; body: string; prompt: string } | null {
    const match = /^\/([A-Za-z0-9_-]+)\s*([\s\S]*)$/.exec(prompt.trim());
    if (!match) return null;
    const name = match[1]!;
    const skill = this.skills.find((s) => s.name === name && s.enabled);
    if (!skill) return null;
    let body = "";
    try {
      body = parseSkillFile(skill.path).body.trim();
    } catch {
      body = "";
    }
    return { name, body, prompt: (match[2] ?? "").trim() };
  }
}

export const isDirectory = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
