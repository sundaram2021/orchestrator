import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileNode } from "@orchestrator/contracts";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".svelte-kit",
  "target",
  ".orchestrator",
  ".turbo",
  ".next",
]);

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 12;

export class FilesService {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(relative: string): string {
    const abs = path.resolve(this.root, relative || ".");
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error("path is outside the workspace");
    }
    return abs;
  }

  async listTree(relative = "", depth = MAX_DEPTH): Promise<FileNode[]> {
    return this.readDir(this.resolve(relative), relative, depth);
  }

  private async readDir(abs: string, relative: string, depth: number): Promise<FileNode[]> {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const childRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: childRelative,
          type: "dir",
          children: depth > 0 ? await this.readDir(path.join(abs, entry.name), childRelative, depth - 1) : [],
        });
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: childRelative, type: "file" });
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }

  async readFile(relative: string): Promise<{ path: string; content: string }> {
    const abs = this.resolve(relative);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_BYTES) throw new Error(`file too large (${stat.size} bytes)`);
    const buffer = await fs.readFile(abs);
    if (buffer.includes(0)) throw new Error("binary file");
    return { path: relative, content: buffer.toString("utf8") };
  }

  async writeFile(relative: string, content: string): Promise<void> {
    const abs = this.resolve(relative);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  async createPath(relative: string, type: "file" | "dir"): Promise<void> {
    const abs = this.resolve(relative);
    if (type === "dir") await fs.mkdir(abs, { recursive: true });
    else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "", { flag: "a" });
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.resolve(from), this.resolve(to));
  }

  async remove(relative: string): Promise<void> {
    await fs.rm(this.resolve(relative), { recursive: true, force: true });
  }
}
