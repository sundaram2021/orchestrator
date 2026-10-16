import { z } from "zod";

export const AttachmentSchema = z.object({
  name: z.string(),
  mime: z.string(),
  data: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachmentMetaSchema = z.object({
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});
export type AttachmentMeta = z.infer<typeof AttachmentMetaSchema>;
