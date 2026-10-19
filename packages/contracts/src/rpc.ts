import { z } from "zod";
import { AttachmentSchema } from "./attachments.js";
import { AppConfigSchema, AntigravityStatusSchema, ModelRefSchema } from "./config.js";
import { DomainEventSchema } from "./events.js";
import { ReadModelSchema } from "./readmodel.js";
import {
  CheckpointSchema,
  FileContentSchema,
  FileNodeSchema,
  GitBranchesSchema,
  GitStatusSchema,
} from "./files.js";

export const CommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("StartThread"),
    prompt: z.string().min(1),
    harness: z.string(),
    model: z.string(),
    attachments: z.array(AttachmentSchema).optional(),
  }),
  z.object({ kind: z.literal("StopAgent"), threadId: z.string() }),
  z.object({ kind: z.literal("RetryThread"), threadId: z.string(), model: z.string().optional() }),
  z.object({ kind: z.literal("ForkThread"), threadId: z.string() }),
  z.object({ kind: z.literal("DiscardThread"), threadId: z.string() }),
  z.object({ kind: z.literal("MergeThread"), threadId: z.string() }),
  z.object({ kind: z.literal("ClearFinished") }),
  z.object({ kind: z.literal("ClearAll") }),
  z.object({ kind: z.literal("SetModel"), model: ModelRefSchema }),
  z.object({
    kind: z.literal("SetEnabled"),
    target: z.enum(["harness", "mcp", "skill"]),
    id: z.string(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("SetUpdateSettings"),
    autoUpdate: z.boolean().optional(),
    includeMajor: z.boolean().optional(),
  }),
]);
export type Command = z.infer<typeof CommandSchema>;

export const METHOD_NAMES = [
  "ping",
  "getConfig",
  "getSnapshot",
  "replayEvents",
  "dispatchCommand",
  "listTree",
  "readFile",
  "writeFile",
  "createPath",
  "renamePath",
  "deletePath",
  "gitStatus",
  "gitDiff",
  "gitStage",
  "gitCommit",
  "gitPush",
  "gitBranches",
  "gitCheckout",
  "gitCreatePr",
  "listCheckpoints",
  "createCheckpoint",
  "restoreCheckpoint",
  "landThread",
  "antigravityStatus",
  "installAntigravity",
  "antigravitySignIn",
  "antigravitySignInComplete",
  "antigravitySignInCancel",
  "mcpCallTool",
] as const;

export const ClientRequestSchema = z.object({
  id: z.string(),
  method: z.enum(METHOD_NAMES),
  params: z.unknown().optional(),
});

export const ServerReplySchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type ServerReply = z.infer<typeof ServerReplySchema>;

export const ServerPushSchema = z.object({
  push: z.literal("event"),
  event: DomainEventSchema,
});
export type ServerPush = z.infer<typeof ServerPushSchema>;

export interface MethodMap {
  ping: { params: undefined; result: { pong: true; ts: number } };
  getConfig: { params: undefined; result: z.infer<typeof AppConfigSchema> };
  getSnapshot: { params: undefined; result: z.infer<typeof ReadModelSchema> };
  replayEvents: { params: { fromSeq: number }; result: z.infer<typeof DomainEventSchema>[] };
  dispatchCommand: { params: Command; result: { accepted: true } };
  listTree: { params: { path?: string }; result: z.infer<typeof FileNodeSchema>[] };
  readFile: { params: { path: string }; result: z.infer<typeof FileContentSchema> };
  writeFile: { params: { path: string; content: string }; result: { ok: true } };
  createPath: { params: { path: string; type: "file" | "dir" }; result: { ok: true } };
  renamePath: { params: { from: string; to: string }; result: { ok: true } };
  deletePath: { params: { path: string }; result: { ok: true } };
  gitStatus: { params: undefined; result: z.infer<typeof GitStatusSchema> };
  gitDiff: { params: { path?: string; staged?: boolean }; result: { diff: string } };
  gitStage: { params: { path?: string }; result: { ok: true } };
  gitCommit: { params: { message: string }; result: { ok: boolean; output: string } };
  gitPush: { params: undefined; result: { ok: boolean; output: string } };
  gitBranches: { params: undefined; result: z.infer<typeof GitBranchesSchema> };
  gitCheckout: { params: { branch: string; force?: boolean }; result: { ok: boolean; output: string } };
  gitCreatePr: {
    params: { title: string; body?: string; base?: string };
    result: { ok: boolean; output: string };
  };
  listCheckpoints: { params: { threadId: string }; result: z.infer<typeof CheckpointSchema>[] };
  createCheckpoint: {
    params: { threadId: string; label?: string };
    result: { ok: boolean; sha: string; output: string };
  };
  restoreCheckpoint: { params: { threadId: string; sha: string }; result: { ok: boolean; output: string } };
  landThread: {
    params: { threadId: string; title?: string; body?: string; base?: string };
    result: { ok: boolean; output: string };
  };
  antigravityStatus: { params: undefined; result: z.infer<typeof AntigravityStatusSchema> };
  installAntigravity: { params: undefined; result: z.infer<typeof AntigravityStatusSchema> };
  antigravitySignIn: { params: undefined; result: { url: string } };
  antigravitySignInComplete: { params: { callbackUrl: string }; result: { ok: boolean } };
  antigravitySignInCancel: { params: undefined; result: { ok: true } };
  mcpCallTool: {
    params: { server: string; tool: string; args: Record<string, unknown> };
    result: { ok: boolean; result: string };
  };
}

export type MethodName = (typeof METHOD_NAMES)[number];
export type MethodResult<M extends MethodName> = MethodMap[M]["result"];
export type MethodParams<M extends MethodName> = MethodMap[M]["params"];
