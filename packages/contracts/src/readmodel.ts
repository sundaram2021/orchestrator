import { z } from "zod";
import {
  AgentStatusSchema,
  MessageRoleSchema,
  MessageSourceSchema,
  ThreadKindSchema,
  UsageSchema,
} from "./events.js";
import { AttachmentMetaSchema } from "./attachments.js";
import { AppConfigSchema } from "./config.js";

export const ToolViewSchema = z.object({
  callId: z.string(),
  tool: z.string(),
  args: z.string(),
  ok: z.boolean().optional(),
  result: z.string().optional(),
  startedAt: z.number().int().optional(),
  endedAt: z.number().int().optional(),
});
export type ToolView = z.infer<typeof ToolViewSchema>;

export const MessageViewSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  text: z.string(),
  source: MessageSourceSchema.optional(),
  reasoning: z.string().optional(),
  tools: z.array(ToolViewSchema),
});
export type MessageView = z.infer<typeof MessageViewSchema>;

export const ThreadViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  harness: z.string(),
  model: z.string(),
  kind: ThreadKindSchema.optional(),
  status: AgentStatusSchema,
  unread: z.boolean().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  messages: z.array(MessageViewSchema),
  prompt: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
  parentId: z.string().optional(),
  attachments: z.array(AttachmentMetaSchema).optional(),
  usage: UsageSchema.optional(),
});
export type ThreadView = z.infer<typeof ThreadViewSchema>;

export const RuntimeStatusSchema = z.object({
  agentsRunning: z.number().int(),
  totalThreads: z.number().int(),
});

export const ReadModelSchema = z.object({
  threads: z.array(ThreadViewSchema),
  status: RuntimeStatusSchema,
  config: AppConfigSchema,
  lastSeq: z.number().int().nonnegative(),
});
export type ReadModel = z.infer<typeof ReadModelSchema>;
