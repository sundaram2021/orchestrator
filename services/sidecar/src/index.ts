import { EventStore } from "./event/EventStore.js";
import { ReadModel } from "./event/ReadModel.js";
import { Broadcaster } from "./Broadcaster.js";
import { AdapterManager } from "./adapters/AdapterManager.js";
import { OpenCodeAdapter } from "./adapters/OpenCodeAdapter.js";
import { AntigravityAdapter } from "./adapters/AntigravityAdapter.js";
import { McpManager } from "./mcp/McpManager.js";
import { SkillsLoader } from "./skills/SkillsLoader.js";
import { ConfigService } from "./config/ConfigService.js";
import { SettingsStore } from "./config/SettingsStore.js";
import { FilesService } from "./files/FilesService.js";
import { GitService } from "./git/GitService.js";
import { WorktreeService } from "./git/WorktreeService.js";
import { RequestHandlers } from "./rpc/RequestHandlers.js";
import { Orchestrator } from "./Orchestrator.js";
import { startServer } from "./server.js";
import { journalPath, userConfigPath } from "./config/paths.js";
import { logger } from "./util/logger.js";

const log = logger("main");

async function main(): Promise<void> {
  const workspace = process.env.ORCHESTRATOR_WORKSPACE ?? process.cwd();
  const preferredPort = Number(process.env.ORCHESTRATOR_PORT ?? 0) || 4123;

  const bus = new Broadcaster();
  const store = new EventStore(journalPath(workspace));
  const readModel = new ReadModel({
    workspace,
    model: { harness: "opencode", id: "", name: "" },
    harnesses: [],
    mcp: [],
    skills: [],
    version: "0.1.0",
  });

  const replayed = store.load();
  for (const event of replayed) readModel.apply(event);
  if (replayed.length > 0) log.info(`replayed ${replayed.length} events from the journal`);

  const adapters = new AdapterManager();
  adapters.register(new OpenCodeAdapter(), { fallback: true });
  adapters.register(new AntigravityAdapter());

  const settings = new SettingsStore(userConfigPath);
  const mcp = new McpManager(undefined, settings);
  const skills = new SkillsLoader(settings);
  const config = new ConfigService(workspace, adapters, mcp, skills, settings);

  const worktrees = new WorktreeService(workspace);
  const orchestrator = new Orchestrator({
    workspace,
    store,
    readModel,
    adapters,
    config,
    mcp,
    skills,
    worktrees,
    bus,
  });
  const handlers = new RequestHandlers({
    orchestrator,
    files: new FilesService(workspace),
    git: new GitService(workspace),
    adapters,
    mcp,
  });

  await orchestrator.init();
  const server = await startServer(orchestrator, handlers, bus, preferredPort);

  process.stdout.write(`ORCHESTRATOR_PORT=${server.port}\n`);
  process.stdout.write(`ORCHESTRATOR_WS=ws://127.0.0.1:${server.port}\n`);
  log.info(`workspace ${workspace}`);

  const shutdown = async (): Promise<void> => {
    log.info("shutting down");
    await adapters.stopAll();
    await mcp.stopAll();
    store.close();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  log.error("fatal", err);
  process.exit(1);
});
