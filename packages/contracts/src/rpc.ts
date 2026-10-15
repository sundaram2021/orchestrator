import { z } from "zod";
import { AppConfigSchema, ModelRefSchema } from "./config.js";
import { DomainEventSchema } from "./events.js";
import { ReadModelSchema } from "./readmodel.js";
import { FileContentSchema, FileNodeSchema, GitStatusSchema } from "./files.js";

export const CommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("StartThread"),
    prompt: z.string().min(1),
    harness: z.string(),
    model: z.string(),
  }),
  z.object({ kind: z.literal("StopAgent"), threadId: z.string() }),
  z.object({ kind: z.literal("RetryThread"), threadId: z.string(), model: z.string().optional() }),
  z.object({ kind: z.literal("ForkThread"), threadId: z.string() }),
  z.object({ kind: z.literal("DiscardThread"), threadId: z.string() }),
  z.object({ kind: z.literal("MergeThread"), threadId: z.string() }),
  z.object({ kind: z.literal("ClearFinished") }),
  z.object({ kind: z.literal("SetModel"), model: ModelRefSchema }),
  z.object({
    kind: z.literal("SetEnabled"),
    target: z.enum(["harness", "mcp", "skill"]),
    id: z.string(),
    enabled: z.boolean(),
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
  "launchAntigravity",
  "mcpCallTool",
] as const;

export const ClientRequestSchema = z.object({
  id: z.string(),
  method: z.enum(METHOD_NAMES),
  params: z.unknown().optional(),
});
export type ClientRequest = z.infer<typeof ClientRequestSchema>;

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
  launchAntigravity: { params: undefined; result: { ok: boolean; detail: string } };
  mcpCallTool: {
    params: { server: string; tool: string; args: Record<string, unknown> };
    result: { ok: boolean; result: string };
  };
}

export type MethodName = (typeof METHOD_NAMES)[number];
export type MethodResult<M extends MethodName> = MethodMap[M]["result"];
export type MethodParams<M extends MethodName> = MethodMap[M]["params"];
