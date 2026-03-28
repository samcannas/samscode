import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProviderKind } from "@samscode/contracts";

export type ParsedFrontmatterValue = string | number | boolean | string[];

export function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function expandHomePathSync(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function toCatalogId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function humanizeCatalogId(value: string): string {
  return value
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function parseScalarValue(rawValue: string): ParsedFrontmatterValue {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return trimmed;
}

export function parseMarkdownFrontmatter(contents: string): {
  frontmatter: Record<string, ParsedFrontmatterValue>;
  body: string;
} | null {
  const normalized = contents.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5).trim();
  const frontmatter: Record<string, ParsedFrontmatterValue> = {};
  let activeArrayKey: string | null = null;

  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (activeArrayKey && trimmed.startsWith("- ")) {
      const value = trimToUndefined(trimmed.slice(2));
      if (value) {
        const existing = frontmatter[activeArrayKey];
        const next = Array.isArray(existing) ? existing : [];
        next.push(value);
        frontmatter[activeArrayKey] = next;
      }
      continue;
    }
    activeArrayKey = null;

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1] ?? "";
    const rawValue = match[2] ?? "";
    if (!key) {
      continue;
    }
    if (rawValue.trim().length === 0) {
      activeArrayKey = key;
      frontmatter[key] = [];
      continue;
    }
    frontmatter[key] = parseScalarValue(rawValue);
  }

  return {
    frontmatter,
    body,
  };
}

export function readStringField(
  frontmatter: Record<string, ParsedFrontmatterValue>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "string") {
      const trimmed = trimToUndefined(value);
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function readBooleanField(
  frontmatter: Record<string, ParsedFrontmatterValue>,
  ...keys: readonly string[]
): boolean | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

export function readNumberField(
  frontmatter: Record<string, ParsedFrontmatterValue>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function readStringListField(
  frontmatter: Record<string, ParsedFrontmatterValue>,
  ...keys: readonly string[]
): string[] | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (Array.isArray(value)) {
      const normalized = value
        .flatMap((entry) => (typeof entry === "string" ? [entry.trim()] : []))
        .filter((entry) => entry.length > 0);
      if (normalized.length > 0) {
        return normalized;
      }
      continue;
    }
    if (typeof value === "string") {
      const normalizedValue = value.trim().replace(/^\[(.*)\]$/s, "$1");
      const normalized = normalizedValue
        .split(",")
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
        .filter((entry) => entry.length > 0);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }
  return undefined;
}

export function readSupportedProviders(
  frontmatter: Record<string, ParsedFrontmatterValue>,
): ProviderKind[] {
  const supported = readStringListField(frontmatter, "supports", "providers", "harnesses");
  if (!supported || supported.length === 0) {
    return ["codex", "claudeAgent"];
  }
  const normalized = supported.flatMap((entry): ProviderKind[] => {
    const value = entry.trim().toLowerCase();
    if (value === "codex") return ["codex"];
    if (value === "claude" || value === "claudeagent" || value === "claude-agent") {
      return ["claudeAgent"];
    }
    return [];
  });
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["codex", "claudeAgent"];
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function collectFilesRecursively(rootPath: string): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFilesRecursively(nextPath)));
      continue;
    }
    if (entry.isFile()) {
      results.push(nextPath);
    }
  }
  return results;
}
