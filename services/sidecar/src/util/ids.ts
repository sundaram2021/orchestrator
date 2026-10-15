import { randomUUID } from "node:crypto";

export const uid = (prefix = ""): string => prefix + randomUUID();

export const shortId = (prefix = ""): string => prefix + randomUUID().slice(0, 8);

export const truncate = (text: string, max = 48): string =>
  text.length > max ? text.slice(0, max) + "\u2026" : text;
