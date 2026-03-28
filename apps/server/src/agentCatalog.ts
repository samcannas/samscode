import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AgentCatalogEntry,
  AgentCatalogListResult,
  AgentInstallResult,
  AgentInstallState,
  AgentInstallTarget,
  AgentUninstallResult,
  ProviderKind,
  ProviderSession,
  ThreadId,
} from "@samscode/contracts";
import {
  collectFilesRecursively,
  expandHomePathSync,
  humanizeCatalogId,
  parseMarkdownFrontmatter,
  pathExists,
  readBooleanField,
  readNumberField,
  readStringField,
  readStringListField,
  readSupportedProviders,
  toCatalogId,
  trimToUndefined,
} from "./catalogUtils";

const WORKSPACE_AGENT_CATALOG_RELATIVE_PATH = ["agents", "catalog"] as const;
const USER_AGENT_CATALOG_RELATIVE_PATH = ["agents", "catalog"] as const;

type ParsedCatalogAgent = {
  entry: Omit<AgentCatalogEntry, "installState">;
  prompt: string;
  claudeConfig: {
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: string;
    maxTurns?: number;
    skills?: string[];
    background?: boolean;
    effort?: string;
    isolation?: string;
    memory?: string;
  };
  codexConfig: {
    nicknameCandidates?: string[];
    model?: string;
    modelReasoningEffort?: string;
    sandboxMode?: string;
  };
};

function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

function tomlQuoted(value: string): string {
  return JSON.stringify(value);
}

function resolveCategoryParts(
  rootPath: string,
  filePath: string,
): {
  category?: string;
  subcategory?: string;
} {
  const relativeDirectory = path.relative(rootPath, path.dirname(filePath));
  if (!relativeDirectory || relativeDirectory === ".") {
    return {};
  }
  const segments = relativeDirectory
    .split(path.sep)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const [category, subcategory] = segments;
  return {
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
  };
}

async function collectMarkdownFiles(rootPath: string): Promise<string[]> {
  const files = await collectFilesRecursively(rootPath);
  return files.filter((filePath) => filePath.toLowerCase().endsWith(".md"));
}

function parseCatalogMarkdownFile(input: {
  rootPath: string;
  filePath: string;
  source: "workspace" | "user";
  contents: string;
}): ParsedCatalogAgent | null {
  const parsed = parseMarkdownFrontmatter(input.contents);
  if (!parsed) {
    return null;
  }
  const rawName = readStringField(parsed.frontmatter, "name", "title");
  const description = readStringField(parsed.frontmatter, "description");
  const prompt = trimToUndefined(parsed.body);
  if (!rawName || !description || !prompt) {
    return null;
  }
  const rawId = readStringField(parsed.frontmatter, "id", "slug", "identifier") ?? rawName;
  const id = toCatalogId(rawId);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return null;
  }
  const name =
    /[\sA-Z]/.test(rawName) || rawName.includes("(")
      ? rawName
      : humanizeCatalogId(toCatalogId(rawName));
  const tools = readStringListField(parsed.frontmatter, "tools");
  const color = readStringField(parsed.frontmatter, "color");
  const vibe = readStringField(parsed.frontmatter, "vibe");
  const author = readStringField(parsed.frontmatter, "author");
  const disallowedTools = readStringListField(parsed.frontmatter, "disallowedTools");
  const claudeModel = readStringField(parsed.frontmatter, "model");
  const permissionMode = readStringField(parsed.frontmatter, "permissionMode");
  const maxTurns = readNumberField(parsed.frontmatter, "maxTurns");
  const skills = readStringListField(parsed.frontmatter, "skills");
  const background = readBooleanField(parsed.frontmatter, "background");
  const effort = readStringField(parsed.frontmatter, "effort");
  const isolation = readStringField(parsed.frontmatter, "isolation");
  const memory = readStringField(parsed.frontmatter, "memory");
  const nicknameCandidates = readStringListField(
    parsed.frontmatter,
    "nickname_candidates",
    "nicknameCandidates",
  );
  const codexModel = readStringField(parsed.frontmatter, "codex_model");
  const modelReasoningEffort = readStringField(
    parsed.frontmatter,
    "model_reasoning_effort",
    "codex_model_reasoning_effort",
  );
  const sandboxMode = readStringField(parsed.frontmatter, "sandbox_mode");
  const supports = readSupportedProviders(parsed.frontmatter);
  const categoryParts = resolveCategoryParts(input.rootPath, input.filePath);

  return {
    entry: {
      id,
      name,
      description,
      ...(categoryParts.category ? { category: categoryParts.category } : {}),
      ...(categoryParts.subcategory ? { subcategory: categoryParts.subcategory } : {}),
      ...(color ? { color } : {}),
      ...(vibe ? { vibe } : {}),
      ...(author ? { author } : {}),
      ...(tools ? { tools } : {}),
      supports,
      source: input.source,
      sourcePath: input.filePath,
    },
    prompt,
    claudeConfig: {
      ...(tools ? { tools } : {}),
      ...(disallowedTools ? { disallowedTools } : {}),
      ...(claudeModel ? { model: claudeModel } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(skills ? { skills } : {}),
      ...(background !== undefined ? { background } : {}),
      ...(effort ? { effort } : {}),
      ...(isolation ? { isolation } : {}),
      ...(memory ? { memory } : {}),
    },
    codexConfig: {
      ...(nicknameCandidates ? { nicknameCandidates } : {}),
      ...(codexModel ? { model: codexModel } : {}),
      ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
      ...(sandboxMode ? { sandboxMode } : {}),
    },
  };
}

async function loadCatalogAgentsFromRoot(input: {
  rootPath: string;
  source: "workspace" | "user";
}): Promise<ParsedCatalogAgent[]> {
  const markdownFiles = await collectMarkdownFiles(input.rootPath);
  const entries = await Promise.all(
    markdownFiles.map(async (filePath) => {
      const contents = await fs.readFile(filePath, "utf8");
      return parseCatalogMarkdownFile({
        rootPath: input.rootPath,
        filePath,
        source: input.source,
        contents,
      });
    }),
  );
  return entries.filter((entry): entry is ParsedCatalogAgent => entry !== null);
}

function resolveWritableCatalogPath(baseDir: string): string {
  return path.join(baseDir, ...USER_AGENT_CATALOG_RELATIVE_PATH);
}

function resolveWorkspaceCatalogPath(cwd: string): string {
  return path.join(cwd, ...WORKSPACE_AGENT_CATALOG_RELATIVE_PATH);
}

function resolveClaudeInstallPath(agentId: string): string {
  return path.join(os.homedir(), ".claude", "agents", `${agentId}.md`);
}

function resolveCodexInstallPath(agentId: string, codexHomePath?: string): string {
  const homePath = codexHomePath
    ? expandHomePathSync(codexHomePath)
    : path.join(os.homedir(), ".codex");
  return path.join(homePath, "agents", `${agentId}.toml`);
}

async function writeFileAtomically(targetPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, contents, "utf8");
  await fs.rename(tempPath, targetPath);
}

function serializeClaudeAgentMarkdown(agent: ParsedCatalogAgent): string {
  const frontmatterLines = [
    "---",
    `name: ${agent.entry.id}`,
    `description: ${yamlQuoted(agent.entry.description)}`,
  ];

  if (agent.claudeConfig.tools && agent.claudeConfig.tools.length > 0) {
    frontmatterLines.push("tools:");
    for (const tool of agent.claudeConfig.tools) {
      frontmatterLines.push(`  - ${yamlQuoted(tool)}`);
    }
  }
  if (agent.claudeConfig.disallowedTools && agent.claudeConfig.disallowedTools.length > 0) {
    frontmatterLines.push("disallowedTools:");
    for (const tool of agent.claudeConfig.disallowedTools) {
      frontmatterLines.push(`  - ${yamlQuoted(tool)}`);
    }
  }
  if (agent.claudeConfig.model) {
    frontmatterLines.push(`model: ${yamlQuoted(agent.claudeConfig.model)}`);
  }
  if (agent.claudeConfig.permissionMode) {
    frontmatterLines.push(`permissionMode: ${yamlQuoted(agent.claudeConfig.permissionMode)}`);
  }
  if (typeof agent.claudeConfig.maxTurns === "number") {
    frontmatterLines.push(`maxTurns: ${String(agent.claudeConfig.maxTurns)}`);
  }
  if (agent.claudeConfig.skills && agent.claudeConfig.skills.length > 0) {
    frontmatterLines.push("skills:");
    for (const skill of agent.claudeConfig.skills) {
      frontmatterLines.push(`  - ${yamlQuoted(skill)}`);
    }
  }
  if (typeof agent.claudeConfig.background === "boolean") {
    frontmatterLines.push(`background: ${agent.claudeConfig.background ? "true" : "false"}`);
  }
  if (agent.claudeConfig.effort) {
    frontmatterLines.push(`effort: ${yamlQuoted(agent.claudeConfig.effort)}`);
  }
  if (agent.claudeConfig.isolation) {
    frontmatterLines.push(`isolation: ${yamlQuoted(agent.claudeConfig.isolation)}`);
  }
  if (agent.claudeConfig.memory) {
    frontmatterLines.push(`memory: ${yamlQuoted(agent.claudeConfig.memory)}`);
  }

  frontmatterLines.push("---", "", agent.prompt.trim(), "");
  return frontmatterLines.join("\n");
}

function serializeCodexAgentToml(agent: ParsedCatalogAgent): string {
  const lines = [
    `name = ${tomlQuoted(agent.entry.id)}`,
    `description = ${tomlQuoted(agent.entry.description)}`,
    `developer_instructions = ${tomlQuoted(agent.prompt.trim())}`,
  ];
  if (agent.codexConfig.nicknameCandidates && agent.codexConfig.nicknameCandidates.length > 0) {
    lines.push(
      `nickname_candidates = [${agent.codexConfig.nicknameCandidates
        .map((candidate) => tomlQuoted(candidate))
        .join(", ")}]`,
    );
  }
  if (agent.codexConfig.model) {
    lines.push(`model = ${tomlQuoted(agent.codexConfig.model)}`);
  }
  if (agent.codexConfig.modelReasoningEffort) {
    lines.push(`model_reasoning_effort = ${tomlQuoted(agent.codexConfig.modelReasoningEffort)}`);
  }
  if (agent.codexConfig.sandboxMode) {
    lines.push(`sandbox_mode = ${tomlQuoted(agent.codexConfig.sandboxMode)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildInstallState(input: { codex: boolean; claudeAgent: boolean }): AgentInstallState {
  return {
    codex: input.codex,
    claudeAgent: input.claudeAgent,
  };
}

function listActiveSessionThreadIdsByProvider(
  sessions: ReadonlyArray<ProviderSession>,
): Record<ProviderKind, ThreadId[]> {
  return {
    codex: sessions
      .filter((session) => session.provider === "codex" && session.status !== "closed")
      .map((session) => session.threadId),
    claudeAgent: sessions
      .filter((session) => session.provider === "claudeAgent" && session.status !== "closed")
      .map((session) => session.threadId),
  };
}

async function readCatalogEntries(input: {
  cwd: string;
  baseDir: string;
  codexHomePath?: string;
}): Promise<{
  writableCatalogPath: string;
  agentsById: Map<string, ParsedCatalogAgent>;
}> {
  const writableCatalogPath = resolveWritableCatalogPath(input.baseDir);
  await fs.mkdir(writableCatalogPath, { recursive: true });
  const roots = [
    { rootPath: resolveWorkspaceCatalogPath(input.cwd), source: "workspace" as const },
    { rootPath: writableCatalogPath, source: "user" as const },
  ];
  const parsedRoots = await Promise.all(
    roots.map((root) => loadCatalogAgentsFromRoot(root).catch(() => [])),
  );
  const agentsById = new Map<string, ParsedCatalogAgent>();
  for (const catalogEntries of parsedRoots) {
    for (const entry of catalogEntries) {
      agentsById.set(entry.entry.id, entry);
    }
  }
  return {
    writableCatalogPath,
    agentsById,
  };
}

export async function listAgentCatalog(input: {
  cwd: string;
  baseDir: string;
  codexHomePath?: string;
}): Promise<AgentCatalogListResult> {
  const { writableCatalogPath, agentsById } = await readCatalogEntries(input);
  const entries = await Promise.all(
    Array.from(agentsById.values())
      .toSorted((left, right) => left.entry.name.localeCompare(right.entry.name))
      .map(async (agent) => {
        const installState = buildInstallState({
          codex:
            agent.entry.supports.includes("codex") &&
            (await pathExists(resolveCodexInstallPath(agent.entry.id, input.codexHomePath))),
          claudeAgent:
            agent.entry.supports.includes("claudeAgent") &&
            (await pathExists(resolveClaudeInstallPath(agent.entry.id))),
        });
        return Object.assign({}, agent.entry, {
          installState,
        }) satisfies AgentCatalogEntry;
      }),
  );
  return {
    writableCatalogPath,
    entries,
  };
}

function resolveTargets(target: AgentInstallTarget): ProviderKind[] {
  if (target === "all") {
    return ["codex", "claudeAgent"];
  }
  return [target];
}

export async function installCatalogAgent(input: {
  cwd: string;
  baseDir: string;
  agentId: string;
  target: AgentInstallTarget;
  codexHomePath?: string;
  activeSessions: ReadonlyArray<ProviderSession>;
}): Promise<AgentInstallResult> {
  const { agentsById } = await readCatalogEntries(input);
  const agent = agentsById.get(input.agentId);
  if (!agent) {
    throw new Error(`Unknown agent '${input.agentId}'.`);
  }
  for (const provider of resolveTargets(input.target)) {
    if (!agent.entry.supports.includes(provider)) {
      throw new Error(`Agent '${input.agentId}' does not support ${provider}.`);
    }
    if (provider === "codex") {
      await writeFileAtomically(
        resolveCodexInstallPath(agent.entry.id, input.codexHomePath),
        serializeCodexAgentToml(agent),
      );
      continue;
    }
    await writeFileAtomically(
      resolveClaudeInstallPath(agent.entry.id),
      serializeClaudeAgentMarkdown(agent),
    );
  }

  const installState = buildInstallState({
    codex:
      agent.entry.supports.includes("codex") &&
      (await pathExists(resolveCodexInstallPath(agent.entry.id, input.codexHomePath))),
    claudeAgent:
      agent.entry.supports.includes("claudeAgent") &&
      (await pathExists(resolveClaudeInstallPath(agent.entry.id))),
  });

  const activeThreadIdsByProvider = listActiveSessionThreadIdsByProvider(input.activeSessions);
  return {
    agentId: agent.entry.id,
    installState,
    activeSessionThreadIdsByProvider: activeThreadIdsByProvider,
  };
}

export async function uninstallCatalogAgent(input: {
  cwd: string;
  baseDir: string;
  agentId: string;
  target: AgentInstallTarget;
  codexHomePath?: string;
  activeSessions: ReadonlyArray<ProviderSession>;
}): Promise<AgentUninstallResult> {
  const { agentsById } = await readCatalogEntries(input);
  const agent = agentsById.get(input.agentId);
  if (!agent) {
    throw new Error(`Unknown agent '${input.agentId}'.`);
  }
  for (const provider of resolveTargets(input.target)) {
    if (provider === "codex") {
      await fs.rm(resolveCodexInstallPath(agent.entry.id, input.codexHomePath), {
        force: true,
      });
      continue;
    }
    await fs.rm(resolveClaudeInstallPath(agent.entry.id), {
      force: true,
    });
  }

  const installState = buildInstallState({
    codex:
      agent.entry.supports.includes("codex") &&
      (await pathExists(resolveCodexInstallPath(agent.entry.id, input.codexHomePath))),
    claudeAgent:
      agent.entry.supports.includes("claudeAgent") &&
      (await pathExists(resolveClaudeInstallPath(agent.entry.id))),
  });
  const activeThreadIdsByProvider = listActiveSessionThreadIdsByProvider(input.activeSessions);
  return {
    agentId: agent.entry.id,
    installState,
    activeSessionThreadIdsByProvider: activeThreadIdsByProvider,
  };
}
