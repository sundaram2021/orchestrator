import { z } from "zod";

export const HarnessStatusSchema = z.enum([
  "connected",
  "error",
  "disabled",
  "model-source-only",
  "connecting",
]);
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

export const HarnessIdSchema = z.string();

export const ModelRefSchema = z.object({
  harness: HarnessIdSchema,
  id: z.string(),
  name: z.string(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ModelDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const HarnessConfigSchema = z.object({
  id: HarnessIdSchema,
  name: z.string(),
  color: z.string(),
  status: HarnessStatusSchema,
  detail: z.string(),
  enabled: z.boolean(),
  models: z.array(ModelDescriptorSchema),
});
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

export const McpStatusSchema = z.enum(["connected", "connecting", "error", "disabled"]);
export type McpStatus = z.infer<typeof McpStatusSchema>;

export const McpServerConfigSchema = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "sse", "http"]),
  source: z.string(),
  detail: z.string(),
  tools: z.array(z.string()),
  status: McpStatusSchema,
  enabled: z.boolean(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const SkillConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  enabled: z.boolean(),
});
export type SkillConfig = z.infer<typeof SkillConfigSchema>;

export const UpdateSettingsSchema = z.object({
  autoUpdate: z.boolean(),
  includeMajor: z.boolean(),
});
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;

export const AntigravityStatusSchema = z.object({
  installed: z.boolean(),
  signedIn: z.boolean(),
  version: z.string().nullable(),
  executablePath: z.string().nullable(),
  detail: z.string(),
});
export type AntigravityStatus = z.infer<typeof AntigravityStatusSchema>;

export const AppConfigSchema = z.object({
  workspace: z.string(),
  model: ModelRefSchema,
  harnesses: z.array(HarnessConfigSchema),
  mcp: z.array(McpServerConfigSchema),
  skills: z.array(SkillConfigSchema),
  updates: UpdateSettingsSchema,
  version: z.string(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
