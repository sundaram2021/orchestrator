import type { ModelDescriptor } from "@orchestrator/contracts";

export interface CatalogModel {
  provider: string;
  short: string;
  id: string;
}

export function parseOpenCodeModels(stdout: string): CatalogModel[] {
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("/")) continue;
    const slash = line.indexOf("/");
    const provider = line.slice(0, slash);
    const short = line.slice(slash + 1);
    if (!provider || !short || seen.has(line)) continue;
    seen.add(line);
    models.push({ provider, short, id: line });
  }
  return models;
}

export function buildOpenCodeModels(catalog: CatalogModel[]): ModelDescriptor[] {
  return catalog
    .filter((m) => m.provider === "opencode")
    .map((m) => ({ id: m.id, name: m.short }));
}
