import { CommandSchema, type MethodName } from "@orchestrator/contracts";
import type { Orchestrator } from "../Orchestrator.js";
import type { FilesService } from "../files/FilesService.js";
import type { GitService } from "../git/GitService.js";
import type { AdapterManager } from "../adapters/AdapterManager.js";
import type { AntigravityHarness } from "../adapters/AntigravityHarness.js";
import type { McpManager } from "../mcp/McpManager.js";
import { asRecord, asString } from "../util/coerce.js";

export interface HandlerDeps {
  orchestrator: Orchestrator;
  files: FilesService;
  git: GitService;
  adapters: AdapterManager;
  mcp: McpManager;
  antigravity: AntigravityHarness;
}

export class RequestHandlers {
  constructor(private readonly deps: HandlerDeps) {}

  async handle(method: MethodName, params: unknown): Promise<unknown> {
    const p = asRecord(params);
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
          asString(p.path),
          typeof p.depth === "number" ? p.depth : undefined,
        );
      case "readFile":
        return this.deps.files.readFile(asString(p.path));
      case "writeFile":
        await this.deps.files.writeFile(asString(p.path), asString(p.content));
        return { ok: true };
      case "createPath": {
        await this.deps.files.createPath(asString(p.path), p.type === "dir" ? "dir" : "file");
        return { ok: true };
      }
      case "renamePath":
        await this.deps.files.rename(asString(p.from), asString(p.to));
        return { ok: true };
      case "deletePath":
        await this.deps.files.remove(asString(p.path));
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
        return this.deps.git.commit(asString(p.message));
      case "gitPush":
        return this.deps.git.push();
      case "gitBranches":
        return this.deps.git.branches();
      case "gitCheckout":
        return this.deps.git.checkout(asString(p.branch), p.force === true);
      case "gitCreatePr":
        return this.deps.git.createPullRequest({
          title: asString(p.title),
          body: typeof p.body === "string" ? p.body : undefined,
          base: typeof p.base === "string" ? p.base : undefined,
        });
      case "listCheckpoints":
        return this.deps.orchestrator.listCheckpoints(asString(p.threadId));
      case "createCheckpoint":
        return this.deps.orchestrator.createCheckpoint(
          asString(p.threadId),
          typeof p.label === "string" ? p.label : undefined,
        );
      case "restoreCheckpoint":
        return this.deps.orchestrator.restoreCheckpoint(asString(p.threadId), asString(p.sha));
      case "landThread":
        return this.deps.orchestrator.landThread(asString(p.threadId), {
          title: typeof p.title === "string" ? p.title : undefined,
          body: typeof p.body === "string" ? p.body : undefined,
          base: typeof p.base === "string" ? p.base : undefined,
        });
      case "antigravityStatus":
        return this.deps.antigravity.statusInfo();
      case "installAntigravity": {
        const status = await this.deps.antigravity.install();
        await this.deps.orchestrator.refreshConfig();
        return status;
      }
      case "antigravitySignIn":
        return this.deps.antigravity.signIn(() => undefined);
      case "antigravitySignInComplete":
        return { ok: await this.deps.antigravity.completeSignIn(asString(p.callbackUrl)) };
      case "antigravitySignInCancel":
        this.deps.antigravity.cancelSignIn();
        return { ok: true };
      case "mcpCallTool": {
        const result = await this.deps.mcp.callTool(asString(p.server), asString(p.tool), asRecord(p.args));
        return { ok: true, result };
      }
    }
  }
}
