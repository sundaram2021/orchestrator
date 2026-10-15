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

interface OpenCodeProviderModel {
  name?: string;
  variants?: Record<string, unknown>;
}

interface OpenCodeJson {
  provider?: Record<string, { models?: Record<string, OpenCodeProviderModel> }>;
}

const prettify = (short: string): string =>
  short
    .split("-")
    .map((w) => (w.length <= 3 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");

export function buildHarnessModels(
  catalog: CatalogModel[],
  opencodeJson: OpenCodeJson,
): { opencode: ModelDescriptor[]; antigravity: ModelDescriptor[] } {
  const googleModels = opencodeJson.provider?.google?.models ?? {};
  const friendly = (short: string): string => googleModels[short]?.name ?? prettify(short);

  const opencode: ModelDescriptor[] = [];
  const antigravity: ModelDescriptor[] = [];

  for (const m of catalog) {
    if (m.provider === "opencode") {
      opencode.push({ id: m.id, name: m.short });
    } else if (m.short.startsWith("antigravity")) {
      const variants = googleModels[m.short]?.variants;
      if (variants && Object.keys(variants).length > 0) {
        for (const variant of Object.keys(variants)) {
          antigravity.push({
            id: `${m.id}#${variant}`,
            name: `${friendly(m.short)} (${variant})`,
          });
        }
      } else {
        antigravity.push({ id: m.id, name: friendly(m.short) });
      }
    }
  }
  return { opencode, antigravity };
}
