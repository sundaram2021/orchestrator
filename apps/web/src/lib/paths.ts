export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export const extOf = (path: string): string => {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? path.slice(dot + 1).toLowerCase() : "";
};
