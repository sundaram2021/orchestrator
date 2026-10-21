import { z } from "zod";
import { AttachmentMetaSchema } from "./attachments.js";
import { AppConfigSchema, HarnessStatusSchema, McpStatusSchema } from "./config.js";

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const ThreadKindSchema = z.enum(["orchestrator", "agent"]);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;

export const MessageSourceSchema = z.enum(["user", "orchestrator"]);
export type MessageSource = z.infer<typeof MessageSourceSchema>;

export const MessageLevelSchema = z.enum(["info", "warning", "error"]);
export type MessageLevel = z.infer<typeof MessageLevelSchema>;

export const UsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  total: z.number().optional(),
  cost: z.number().optional(),
  contextLimit: z.number().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const AgentStatusSchema = z.enum(["idle", "running", "stopped", "done", "error"]);

export const ThreadStartedSchema = z.object({
  type: z.literal("thread.started"),
  threadId: z.string(),
  title: z.string(),
  harness: z.string(),
  model: z.string(),
  kind: ThreadKindSchema.optional(),
  prompt: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
  parentId: z.string().optional(),
  attachments: z.array(AttachmentMetaSchema).optional(),
});

export const AgentStatusChangedSchema = z.object({
  type: z.literal("agent.status"),
  threadId: z.string(),
  status: AgentStatusSchema,
});

export const ThreadUnreadSchema = z.object({
  type: z.literal("thread.unread"),
  threadId: z.string(),
});

export const ThreadReadSchema = z.object({
  type: z.literal("thread.read"),
  threadId: z.string(),
});

export const MessageAppendedSchema = z.object({
  type: z.literal("message.appended"),
  threadId: z.string(),
  messageId: z.string(),
  role: MessageRoleSchema,
  text: z.string(),
  source: MessageSourceSchema.optional(),
  level: MessageLevelSchema.optional(),
  details: z.string().optional(),
});

export const MessageDeltaSchema = z.object({
  type: z.literal("message.delta"),
  threadId: z.string(),
  messageId: z.string(),
  delta: z.string(),
});

export const MessageReasoningSchema = z.object({
  type: z.literal("message.reasoning"),
  threadId: z.string(),
  messageId: z.string(),
  delta: z.string(),
});

export const ToolCalledSchema = z.object({
  type: z.literal("tool.called"),
  threadId: z.string(),
  callId: z.string(),
  tool: z.string(),
  args: z.string(),
});

export const ToolResultSchema = z.object({
  type: z.literal("tool.result"),
  threadId: z.string(),
  callId: z.string(),
  ok: z.boolean(),
  result: z.string(),
  truncated: z.boolean().optional(),
});

export const TurnCompletedSchema = z.object({
  type: z.literal("turn.completed"),
  threadId: z.string(),
});

export const UsageUpdatedSchema = z.object({
  type: z.literal("usage.updated"),
  threadId: z.string(),
  usage: UsageSchema,
});

export const AgentErrorSchema = z.object({
  type: z.literal("agent.error"),
  threadId: z.string(),
  message: z.string(),
});

export const ThreadRemovedSchema = z.object({
  type: z.literal("thread.removed"),
  threadId: z.string(),
});

export const ConfigChangedSchema = z.object({
  type: z.literal("config.changed"),
  config: AppConfigSchema,
});

export const HarnessStatusChangedSchema = z.object({
  type: z.literal("harness.status"),
  harnessId: z.string(),
  status: HarnessStatusSchema,
});

export const McpStatusChangedSchema = z.object({
  type: z.literal("mcp.status"),
  name: z.string(),
  status: McpStatusSchema,
  tools: z.array(z.string()),
  schemaChars: z.number().optional(),
});

export const EventBodySchema = z.discriminatedUnion("type", [
  ThreadStartedSchema,
  AgentStatusChangedSchema,
  ThreadUnreadSchema,
  ThreadReadSchema,
  MessageAppendedSchema,
  MessageDeltaSchema,
  MessageReasoningSchema,
  ToolCalledSchema,
  ToolResultSchema,
  TurnCompletedSchema,
  UsageUpdatedSchema,
  AgentErrorSchema,
  ThreadRemovedSchema,
  ConfigChangedSchema,
  HarnessStatusChangedSchema,
  McpStatusChangedSchema,
]);
export type EventBody = z.infer<typeof EventBodySchema>;

export const DomainEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  event: EventBodySchema,
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;
