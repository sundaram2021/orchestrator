import { z } from "zod";
import { AppConfigSchema, HarnessStatusSchema, McpStatusSchema } from "./config.js";

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const AgentStatusSchema = z.enum(["running", "stopped", "done", "error"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const ThreadStartedSchema = z.object({
  type: z.literal("thread.started"),
  threadId: z.string(),
  title: z.string(),
  harness: z.string(),
  model: z.string(),
  prompt: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
  parentId: z.string().optional(),
});

export const AgentStatusChangedSchema = z.object({
  type: z.literal("agent.status"),
  threadId: z.string(),
  status: AgentStatusSchema,
});

export const MessageAppendedSchema = z.object({
  type: z.literal("message.appended"),
  threadId: z.string(),
  messageId: z.string(),
  role: MessageRoleSchema,
  text: z.string(),
});

export const MessageDeltaSchema = z.object({
  type: z.literal("message.delta"),
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
});

export const TurnCompletedSchema = z.object({
  type: z.literal("turn.completed"),
  threadId: z.string(),
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
});

export const EventBodySchema = z.discriminatedUnion("type", [
  ThreadStartedSchema,
  AgentStatusChangedSchema,
  MessageAppendedSchema,
  MessageDeltaSchema,
  ToolCalledSchema,
  ToolResultSchema,
  TurnCompletedSchema,
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
