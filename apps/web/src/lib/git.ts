import type { GitFile, GitStatus } from "@orchestrator/contracts";

export type ChangeKind = "new" | "mod" | "del" | "ren";

export interface FileChange {
  code: "U" | "M" | "D" | "R";
  kind: ChangeKind;
  label: string;
}

export const classifyChange = (file: GitFile): FileChange => {
  const { index, worktree } = file;
  if (index === "?" || worktree === "?" || index === "A") return { code: "U", kind: "new", label: "New" };
  if (index === "D" || worktree === "D") return { code: "D", kind: "del", label: "Deleted" };
  if (index === "R" || worktree === "R") return { code: "R", kind: "ren", label: "Renamed" };
  return { code: "M", kind: "mod", label: "Modified" };
};

export const changeMap = (git: GitStatus | null): Map<string, FileChange> =>
  new Map((git?.files ?? []).map((file) => [file.path, classifyChange(file)]));
