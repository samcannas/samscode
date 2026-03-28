import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ProviderKind,
  SkillCatalogEntry,
  SkillCatalogListResult,
  SkillInstallResult,
  SkillInstallState,
  SkillInstallTarget,
  SkillPromptBuildResult,
  SkillUninstallResult,
} from "@samscode/contracts";

import {
  collectFilesRecursively,
  humanizeCatalogId,
  parseMarkdownFrontmatter,
  pathExists,
  readBooleanField,
  readStringField,
  readSupportedProviders,
  toCatalogId,
  trimToUndefined,
} from "./catalogUtils";

const WORKSPACE_SKILL_CATALOG_RELATIVE_PATH = ["skills", "catalog"] as const;
const USER_SKILL_CATALOG_RELATIVE_PATH = ["skills", "catalog"] as const;

type ParsedCatalogSkill = {
  entry: Omit<SkillCatalogEntry, "installState">;
  prompt: string;
};

function firstParagraph(value: string): string | undefined {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }
  return trimToUndefined(normalized.split(/\n\s*\n/u, 1)[0] ?? normalized);
}

function resolveSkillCategoryParts(
  rootPath: string,
  skillDirectoryPath: string,
): {
  category?: string;
  subcategory?: string;
} {
  const relativeDirectory = path.relative(rootPath, skillDirectoryPath);
  if (!relativeDirectory || relativeDirectory === ".") {
    return {};
  }
  const segments = relativeDirectory
    .split(path.sep)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return {};
  }
  const [category, subcategory] = segments.slice(0, -1);
  return {
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
  };
}

async function collectSkillEntryFiles(skillDirectoryPath: string): Promise<string[]> {
  const files = await collectFilesRecursively(skillDirectoryPath);
  return files.toSorted((left, right) => left.localeCompare(right));
}

async function collectSkillDirectories(rootPath: string): Promise<string[]> {
  const files = await collectFilesRecursively(rootPath);
  const skillDirectories = files
    .filter((filePath) => path.basename(filePath).toLowerCase() === "skill.md")
    .map((filePath) => path.dirname(filePath));
  return Array.from(new Set(skillDirectories)).toSorted((left, right) => left.localeCompare(right));
}

async function readTextFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function toDisplayName(rawName: string): string {
  return /[\sA-Z]/.test(rawName) || rawName.includes("(")
    ? rawName
    : humanizeCatalogId(toCatalogId(rawName));
}

async function parseCatalogSkillDirectory(input: {
  rootPath: string;
  skillDirectoryPath: string;
  source: "workspace" | "user";
}): Promise<ParsedCatalogSkill | null> {
  const entrypointPath = path.join(input.skillDirectoryPath, "SKILL.md");
  const contents = await readTextFileOrNull(entrypointPath);
  if (!contents) {
    return null;
  }

  const parsed = parseMarkdownFrontmatter(contents);
  const body = parsed?.body ?? contents.trim();
  const frontmatter = parsed?.frontmatter ?? {};
  const rawName =
    readStringField(frontmatter, "name", "title") ?? path.basename(input.skillDirectoryPath);
  const description =
    readStringField(frontmatter, "description") ?? firstParagraph(body) ?? "Skill instructions";
  const prompt = trimToUndefined(body);
  if (!rawName || !description || !prompt) {
    return null;
  }

  const id = toCatalogId(rawName);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return null;
  }

  const skillFiles = await collectSkillEntryFiles(input.skillDirectoryPath);
  const supportingFiles = skillFiles.filter(
    (filePath) => path.resolve(filePath) !== path.resolve(entrypointPath),
  );
  const relativeSupportingFiles = supportingFiles.map((filePath) =>
    path.relative(input.skillDirectoryPath, filePath),
  );
  const supports = readSupportedProviders(frontmatter);
  const disableModelInvocation =
    readBooleanField(frontmatter, "disable-model-invocation", "disable_model_invocation") === true;
  const userInvocable = readBooleanField(frontmatter, "user-invocable", "user_invocable") ?? true;
  const categoryParts = resolveSkillCategoryParts(input.rootPath, input.skillDirectoryPath);
  const argumentHint = readStringField(frontmatter, "argument-hint", "argument_hint");
  const license = readStringField(frontmatter, "license");
  const model = readStringField(frontmatter, "model");
  const effort = readStringField(frontmatter, "effort");
  const context = readStringField(frontmatter, "context");

  return {
    entry: {
      id,
      name: toDisplayName(rawName),
      description,
      ...(categoryParts.category ? { category: categoryParts.category } : {}),
      ...(categoryParts.subcategory ? { subcategory: categoryParts.subcategory } : {}),
      supports,
      source: input.source,
      sourcePath: input.skillDirectoryPath,
      entrypointPath,
      supportingFileCount: supportingFiles.length,
      hasScripts: relativeSupportingFiles.some(
        (relativePath) => relativePath.split(path.sep)[0]?.toLowerCase() === "scripts",
      ),
      userInvocable,
      implicitInvocationEnabled: !disableModelInvocation,
      ...(argumentHint ? { argumentHint } : {}),
      ...(license ? { license } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(context ? { context } : {}),
    },
    prompt,
  };
}

async function loadCatalogSkillsFromRoot(input: {
  rootPath: string;
  source: "workspace" | "user";
}): Promise<ParsedCatalogSkill[]> {
  const skillDirectories = await collectSkillDirectories(input.rootPath);
  const entries = await Promise.all(
    skillDirectories.map((skillDirectoryPath) =>
      parseCatalogSkillDirectory({
        rootPath: input.rootPath,
        skillDirectoryPath,
        source: input.source,
      }),
    ),
  );
  return entries.filter((entry): entry is ParsedCatalogSkill => entry !== null);
}

function resolveWritableCatalogPath(baseDir: string): string {
  return path.join(baseDir, ...USER_SKILL_CATALOG_RELATIVE_PATH);
}

function resolveWorkspaceCatalogPath(cwd: string): string {
  return path.join(cwd, ...WORKSPACE_SKILL_CATALOG_RELATIVE_PATH);
}

function resolveBundledCatalogPath(): string | undefined {
  const bundledCatalogRoot = process.env.SAMSCODE_CATALOG_ROOT?.trim();
  if (!bundledCatalogRoot) {
    return undefined;
  }

  return path.join(path.resolve(bundledCatalogRoot), ...WORKSPACE_SKILL_CATALOG_RELATIVE_PATH);
}

function resolveCatalogRoots(cwd: string, writableCatalogPath: string) {
  const workspaceRoot = {
    rootPath: resolveWorkspaceCatalogPath(cwd),
    source: "workspace" as const,
  };
  const userRoot = { rootPath: writableCatalogPath, source: "user" as const };

  const bundledCatalogPath = resolveBundledCatalogPath();
  if (!bundledCatalogPath) {
    return [workspaceRoot, userRoot];
  }

  const normalizedWorkspacePath = path.resolve(workspaceRoot.rootPath);
  const normalizedBundledPath = path.resolve(bundledCatalogPath);
  if (normalizedBundledPath === normalizedWorkspacePath) {
    return [workspaceRoot, userRoot];
  }

  return [workspaceRoot, { rootPath: bundledCatalogPath, source: "workspace" as const }, userRoot];
}

function resolveClaudeInstallPath(skillId: string): string {
  return path.join(os.homedir(), ".claude", "skills", skillId);
}

function resolveCodexInstallPath(skillId: string): string {
  return path.join(os.homedir(), ".agents", "skills", skillId);
}

async function copyDirectoryAtomically(sourcePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.rm(tempPath, { recursive: true, force: true });
  await fs.cp(sourcePath, tempPath, { recursive: true });
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.rename(tempPath, targetPath);
}

function buildInstallState(input: { codex: boolean; claudeAgent: boolean }): SkillInstallState {
  return {
    codex: input.codex,
    claudeAgent: input.claudeAgent,
  };
}

async function readCatalogEntries(input: { cwd: string; baseDir: string }): Promise<{
  writableCatalogPath: string;
  skillsById: Map<string, ParsedCatalogSkill>;
}> {
  const writableCatalogPath = resolveWritableCatalogPath(input.baseDir);
  await fs.mkdir(writableCatalogPath, { recursive: true });
  const roots = resolveCatalogRoots(input.cwd, writableCatalogPath);
  const parsedRoots = await Promise.all(
    roots.map((root) => loadCatalogSkillsFromRoot(root).catch(() => [])),
  );
  const skillsById = new Map<string, ParsedCatalogSkill>();
  for (const catalogEntries of parsedRoots) {
    for (const entry of catalogEntries) {
      skillsById.set(entry.entry.id, entry);
    }
  }
  return {
    writableCatalogPath,
    skillsById,
  };
}

async function buildSkillInstallState(skill: ParsedCatalogSkill): Promise<SkillInstallState> {
  return buildInstallState({
    codex:
      skill.entry.supports.includes("codex") &&
      (await pathExists(resolveCodexInstallPath(skill.entry.id))),
    claudeAgent:
      skill.entry.supports.includes("claudeAgent") &&
      (await pathExists(resolveClaudeInstallPath(skill.entry.id))),
  });
}

function resolveTargets(target: SkillInstallTarget): ProviderKind[] {
  if (target === "all") {
    return ["codex", "claudeAgent"];
  }
  return [target];
}

function codeFenceLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".ts":
    case ".tsx":
      return "ts";
    case ".js":
    case ".jsx":
      return "js";
    case ".json":
      return "json";
    case ".md":
      return "md";
    case ".sh":
      return "sh";
    case ".py":
      return "py";
    case ".toml":
      return "toml";
    case ".yaml":
    case ".yml":
      return "yaml";
    default:
      return "text";
  }
}

async function formatSupportingFilesForPrompt(skillDirectoryPath: string): Promise<string[]> {
  const files = await collectSkillEntryFiles(skillDirectoryPath);
  const supportingFiles = files.filter((filePath) => {
    const relativePath = path.relative(skillDirectoryPath, filePath);
    if (!relativePath || relativePath.toLowerCase() === "skill.md") {
      return false;
    }
    return !/^license(\.|$)/i.test(path.basename(relativePath));
  });

  const renderedSections: string[] = [];
  for (const filePath of supportingFiles) {
    const relativePath = path.relative(skillDirectoryPath, filePath);
    const contents = await readTextFileOrNull(filePath);
    if (contents === null) {
      renderedSections.push(`### ${relativePath}\n\n(Binary or unreadable file omitted.)`);
      continue;
    }
    renderedSections.push(
      [
        `### ${relativePath}`,
        "",
        `\`\`\`${codeFenceLanguage(relativePath)}`,
        contents.trimEnd(),
        "```",
      ].join("\n"),
    );
  }
  return renderedSections;
}

export async function listSkillCatalog(input: {
  cwd: string;
  baseDir: string;
}): Promise<SkillCatalogListResult> {
  const { writableCatalogPath, skillsById } = await readCatalogEntries(input);
  const entries = await Promise.all(
    Array.from(skillsById.values())
      .toSorted((left, right) => left.entry.name.localeCompare(right.entry.name))
      .map(async (skill) =>
        Object.assign({}, skill.entry, {
          installState: await buildSkillInstallState(skill),
        }),
      ),
  );
  return {
    writableCatalogPath,
    entries,
  };
}

export async function installCatalogSkill(input: {
  cwd: string;
  baseDir: string;
  skillId: string;
  target: SkillInstallTarget;
}): Promise<SkillInstallResult> {
  const { skillsById } = await readCatalogEntries(input);
  const skill = skillsById.get(input.skillId);
  if (!skill) {
    throw new Error(`Unknown skill '${input.skillId}'.`);
  }

  for (const provider of resolveTargets(input.target)) {
    if (!skill.entry.supports.includes(provider)) {
      throw new Error(`Skill '${input.skillId}' does not support ${provider}.`);
    }
    if (provider === "codex") {
      await copyDirectoryAtomically(
        skill.entry.sourcePath,
        resolveCodexInstallPath(skill.entry.id),
      );
      continue;
    }
    await copyDirectoryAtomically(skill.entry.sourcePath, resolveClaudeInstallPath(skill.entry.id));
  }

  return {
    skillId: skill.entry.id,
    installState: await buildSkillInstallState(skill),
  };
}

export async function uninstallCatalogSkill(input: {
  cwd: string;
  baseDir: string;
  skillId: string;
  target: SkillInstallTarget;
}): Promise<SkillUninstallResult> {
  const { skillsById } = await readCatalogEntries(input);
  const skill = skillsById.get(input.skillId);
  if (!skill) {
    throw new Error(`Unknown skill '${input.skillId}'.`);
  }

  for (const provider of resolveTargets(input.target)) {
    if (provider === "codex") {
      await fs.rm(resolveCodexInstallPath(skill.entry.id), { recursive: true, force: true });
      continue;
    }
    await fs.rm(resolveClaudeInstallPath(skill.entry.id), { recursive: true, force: true });
  }

  return {
    skillId: skill.entry.id,
    installState: await buildSkillInstallState(skill),
  };
}

export async function buildInstalledSkillPrompt(input: {
  cwd: string;
  baseDir: string;
  provider: ProviderKind;
  prompt: string;
  skillIds: readonly string[];
}): Promise<SkillPromptBuildResult> {
  if (input.skillIds.length === 0) {
    return { prompt: input.prompt };
  }

  const { skillsById } = await readCatalogEntries(input);
  const harnessLabel = input.provider === "codex" ? "Codex" : "Claude Code";
  const sections: string[] = [];

  for (const skillId of input.skillIds) {
    const skill = skillsById.get(skillId);
    if (!skill) {
      throw new Error(`Unknown skill '${skillId}'.`);
    }
    if (!skill.entry.supports.includes(input.provider)) {
      throw new Error(`Skill '${skillId}' is not available for ${harnessLabel}.`);
    }
    const installState = await buildSkillInstallState(skill);
    if (!installState[input.provider]) {
      throw new Error(`Skill '${skillId}' is not installed for ${harnessLabel}.`);
    }

    const supportingFiles = await formatSupportingFilesForPrompt(skill.entry.sourcePath);
    sections.push(
      [
        `## Skill: ${skill.entry.id} (${skill.entry.name})`,
        `Description: ${skill.entry.description}`,
        `Source directory: ${skill.entry.sourcePath}`,
        `Entry file: ${skill.entry.entrypointPath}`,
        "",
        "### Instructions",
        skill.prompt,
        ...(supportingFiles.length > 0
          ? ["", "### Bundled supporting files", ...supportingFiles]
          : []),
      ].join("\n"),
    );
  }

  const requestBody = input.prompt.trim();
  return {
    prompt: [
      `The user explicitly activated these installed ${harnessLabel} skills for this turn:`,
      ...sections,
      "",
      "Apply the relevant guidance from every activated skill while completing the user's request.",
      "If two skills conflict, prefer the interpretation that best matches the user's direct request and the repository context.",
      "",
      "Request:",
      requestBody.length > 0 ? requestBody : "No additional task text was provided.",
    ].join("\n\n"),
  };
}
