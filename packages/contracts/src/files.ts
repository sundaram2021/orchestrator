import { z } from "zod";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "dir"]),
    children: z.array(FileNodeSchema).optional(),
  }),
);

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type FileContent = z.infer<typeof FileContentSchema>;

export const GitStatusSchema = z.object({
  available: z.boolean(),
  branch: z.string(),
  changed: z.number().int(),
  staged: z.number().int(),
  unstaged: z.number().int(),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;
