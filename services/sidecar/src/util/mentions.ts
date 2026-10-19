const MENTION = /\$([a-z0-9][a-z0-9-]*)/gi;

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agent";

export const parseAgentMentions = (text: string): string[] => {
  const out: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const slug = match[1]!.toLowerCase();
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
};

export const stripAgentMentions = (text: string): string =>
  text.replace(MENTION, " ").replace(/\s+/g, " ").trim();
