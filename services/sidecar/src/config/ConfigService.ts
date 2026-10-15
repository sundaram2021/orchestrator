import { readFileSync } from "node:fs";
import type { AppConfig, HarnessConfig, ModelRef } from "@orchestrator/contracts";
import type { AdapterManager } from "../adapters/AdapterManager.js";
import type { McpManager } from "../mcp/McpManager.js";
import type { SkillsLoader } from "../skills/SkillsLoader.js";
import { configPaths } from "./paths.js";
import { SettingsStore } from "./SettingsStore.js";
import { parseOpenCodeModels, buildHarnessModels, type CatalogModel } from "../models/catalog.js";
import { runCapture } from "../util/process.js";
import { logger } from "../util/logger.js";

const log = logger("config");

const readJson = (file: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export class ConfigService {
  private catalog: CatalogModel[] = [];
  private catalogAt = 0;
  private config: AppConfig | null = null;

  constructor(
    private readonly workspace: string,
    private readonly adapters: AdapterManager,
    private readonly mcp: McpManager,
    private readonly skills: SkillsLoader,
    private readonly settings: SettingsStore = new SettingsStore(),
  ) {}

  private async loadCatalog(): Promise<void> {
    if (this.catalog.length > 0 && Date.now() - this.catalogAt < 60_000) return;
    const res = await runCapture("opencode", ["models"], { timeoutMs: 30000 });
    this.catalog = res.failed ? [] : parseOpenCodeModels(res.stdout);
    this.catalogAt = Date.now();
  }

  private harnessConfigs(): HarnessConfig[] {
    const opencode = this.adapters.get("opencode");
    const antigravity = this.adapters.get("antigravity");
    const { opencode: ocModels, antigravity: agModels } = buildHarnessModels(
      this.catalog,
      readJson(configPaths.opencode),
    );

    const make = (
      id: string,
      name: string,
      color: string,
      detail: string,
      models: HarnessConfig["models"],
    ): HarnessConfig => {
      const adapter = this.adapters.get(id);
      return {
        id,
        name,
        color,
        status: adapter?.status ?? "disabled",
        detail,
        enabled: this.settings.harnessEnabled(id, true),
        models,
      };
    };

    return [
      make(
        "opencode",
        opencode?.name ?? "OpenCode",
        opencode?.color ?? "#5b8def",
        "opencode serve · full agent runtime",
        ocModels,
      ),
      make(
        "antigravity",
        antigravity?.name ?? "Antigravity",
        antigravity?.color ?? "#c792ea",
        "Model source · run through OpenCode",
        agModels,
      ),
    ];
  }

  private defaultModel(harnesses: HarnessConfig[]): ModelRef {
    for (const h of harnesses) {
      const model = h.models[0];
      if (model) return { harness: h.id, id: model.id, name: model.name };
    }
    return { harness: "opencode", id: "opencode/deepseek-v4.1-flash-free", name: "deepseek-v4.1-flash-free" };
  }

  async assemble(): Promise<AppConfig> {
    await this.loadCatalog();
    const harnesses = this.harnessConfigs();
    const config: AppConfig = {
      workspace: this.workspace,
      model: this.config?.model ?? this.settings.model ?? this.defaultModel(harnesses),
      harnesses,
      mcp: this.mcp.list(),
      skills: this.skills.list(),
      version: "0.1.0",
    };
    this.config = config;
    log.info(`config: ${harnesses.length} harnesses, ${this.mcp.list().length} mcp, ${this.skills.list().length} skills`);
    return config;
  }

  setModel(model: ModelRef): void {
    if (this.config) this.config.model = model;
    this.settings.setModel(model);
  }

  setHarnessEnabled(id: string, enabled: boolean): void {
    this.settings.setHarness(id, enabled);
    const harness = this.config?.harnesses.find((h) => h.id === id);
    if (harness) harness.enabled = enabled;
  }
}
