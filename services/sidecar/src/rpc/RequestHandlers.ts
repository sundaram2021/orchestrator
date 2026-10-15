import { CommandSchema, type MethodName } from "@orchestrator/contracts";
import type { Orchestrator } from "../Orchestrator.js";
import type { FilesService } from "../files/FilesService.js";
import type { GitService } from "../git/GitService.js";
import type { AdapterManager } from "../adapters/AdapterManager.js";
import type { McpManager } from "../mcp/McpManager.js";
import { isLaunchable } from "../adapters/HarnessAdapter.js";

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export interface HandlerDeps {
  orchestrator: Orchestrator;
  files: FilesService;
  git: GitService;
  adapters: AdapterManager;
  mcp: McpManager;
}

export class RequestHandlers {
  constructor(private readonly deps: HandlerDeps) {}

  async handle(method: MethodName, params: unknown): Promise<unknown> {
    const p = rec(params);
    switch (method) {
      case "ping":
        return { pong: true, ts: Date.now() };
      case "getConfig":
        return this.deps.orchestrator.config;
      case "getSnapshot":
        return this.deps.orchestrator.snapshot();
      case "replayEvents":
        return this.deps.orchestrator.replay(typeof p.fromSeq === "number" ? p.fromSeq : 0);
      case "dispatchCommand": {
        const command = CommandSchema.parse(params);
        await this.deps.orchestrator.handle(command);
        return { accepted: true };
      }
      case "listTree":
        return this.deps.files.listTree(
          str(p.path),
          typeof p.depth === "number" ? p.depth : undefined,
        );
      case "readFile":
        return this.deps.files.readFile(str(p.path));
      case "writeFile":
        await this.deps.files.writeFile(str(p.path), str(p.content));
        return { ok: true };
      case "createPath": {
        await this.deps.files.createPath(str(p.path), p.type === "dir" ? "dir" : "file");
        return { ok: true };
      }
      case "renamePath":
        await this.deps.files.rename(str(p.from), str(p.to));
        return { ok: true };
      case "deletePath":
        await this.deps.files.remove(str(p.path));
        return { ok: true };
      case "gitStatus":
        return this.deps.git.status();
      case "gitDiff":
        return {
          diff: await this.deps.git.diff({
            path: typeof p.path === "string" ? p.path : undefined,
            staged: p.staged === true,
          }),
        };
      case "gitStage":
        await this.deps.git.stage(typeof p.path === "string" ? p.path : undefined);
        return { ok: true };
      case "gitCommit":
        return this.deps.git.commit(str(p.message));
      case "gitPush":
        return this.deps.git.push();
      case "gitBranches":
        return this.deps.git.branches();
      case "gitCheckout":
        return this.deps.git.checkout(str(p.branch), p.force === true);
      case "gitCreatePr":
        return this.deps.git.createPullRequest({
          title: str(p.title),
          body: typeof p.body === "string" ? p.body : undefined,
          base: typeof p.base === "string" ? p.base : undefined,
        });
      case "launchAntigravity": {
        const adapter = this.deps.adapters.get("antigravity");
        if (!adapter || !isLaunchable(adapter)) {
          return { ok: false, detail: "antigravity adapter unavailable" };
        }
        return adapter.launch();
      }
      case "mcpCallTool": {
        const result = await this.deps.mcp.callTool(str(p.server), str(p.tool), rec(p.args));
        return { ok: true, result };
      }
    }
  }
}
