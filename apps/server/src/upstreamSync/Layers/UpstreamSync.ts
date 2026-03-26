import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type CodexModelOptions,
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderRuntimeEvent,
  type ProviderStartOptions,
  ThreadId,
  UPSTREAM_SYNC_SCHEMA_VERSION,
  type UpstreamSyncAnalysisRun,
  type UpstreamSyncAreaPolicy,
  type UpstreamSyncAreaPolicyFile,
  type UpstreamSyncCandidateCategory,
  type UpstreamSyncForkMetadata,
  type UpstreamSyncImplementationPromptResult,
  type UpstreamSyncReleaseCandidate,
  type UpstreamSyncReleaseCandidateDecision,
  type UpstreamSyncReleaseCandidateIntake,
  type UpstreamSyncReleaseIntake,
  type UpstreamSyncReleaseReport,
  type UpstreamSyncReleaseTriage,
  type UpstreamSyncStatus,
  type UpstreamSyncStatusInput,
  UpstreamSyncAreaPolicyFile as UpstreamSyncAreaPolicyFileSchema,
  UpstreamSyncForkMetadata as UpstreamSyncForkMetadataSchema,
  UpstreamSyncReleaseIntake as UpstreamSyncReleaseIntakeSchema,
  UpstreamSyncReleaseTriage as UpstreamSyncReleaseTriageSchema,
} from "@samscode/contracts";
import { Effect, Fiber, Layer, Schema, Stream } from "effect";

import { runProcess } from "../../processRunner.ts";
import { createLogger } from "../../logger.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  UpstreamSync,
  UpstreamSyncError,
  type UpstreamSyncShape,
} from "../Services/UpstreamSync.ts";

const DEFAULT_UPSTREAM_REPO = "pingdotgg/t3code";
const DEFAULT_UPSTREAM_BRANCH = "main";
const DEFAULT_BASE_RELEASE_TAG = "v0.0.13";
const DEFAULT_BASE_COMMIT_SHA = "2a237c20019af8eae1020511b41256ea93127e4c";
const UPSTREAM_SYNC_DIR = path.join(".samscode", "upstream-sync");
const STABLE_RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const MIRROR_FETCH_TIMEOUT_MS = 120_000;
const GIT_SHOW_TIMEOUT_MS = 30_000;
const TEXT_LIKE_FILE_PATTERN =
  /\.(?:ts|tsx|js|jsx|json|md|css|scss|html|yml|yaml|txt|mjs|cjs|toml)$/i;
const UPSTREAM_ANALYSIS_CHUNK_SIZE = 1;
const UPSTREAM_ANALYSIS_MAX_CHANGED_FILES = 8;
const logger = createLogger("upstream-sync");

type SyncPaths = ReturnType<typeof resolveSyncPaths>;

type MirrorCommit = {
  sha: string;
  date: string | null;
  title: string;
  summary: string;
  changedFiles: string[];
};

type UpstreamSyncAnalysisDecision = "apply" | "ignore" | "defer" | "already-present";

const decodeForkMetadata = Schema.decodeUnknownSync(UpstreamSyncForkMetadataSchema);
const decodeAreaPolicyFile = Schema.decodeUnknownSync(UpstreamSyncAreaPolicyFileSchema);
const decodeReleaseIntake = Schema.decodeUnknownSync(UpstreamSyncReleaseIntakeSchema);
const decodeReleaseTriage = Schema.decodeUnknownSync(UpstreamSyncReleaseTriageSchema);

function resolveSyncPaths(cwd: string) {
  const rootDir = path.join(cwd, UPSTREAM_SYNC_DIR);
  const releasesDir = path.join(rootDir, "releases");
  const cacheDir = path.join(rootDir, "cache");
  const mirrorDir = path.join(cacheDir, "upstream-mirror.git");
  return {
    rootDir,
    releasesDir,
    cacheDir,
    mirrorDir,
    forkMetadataPath: path.join(rootDir, "fork.json"),
    areasPath: path.join(rootDir, "areas.json"),
    intakePath: (tag: string) => path.join(releasesDir, tag, "intake.json"),
    triagePath: (tag: string) => path.join(releasesDir, tag, "triage.json"),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncateText(input: string, maxLength = 180): string {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function extractStructuredJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Analysis returned an empty response.");
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  return trimmed;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toAnalysisCandidatePayload(candidate: UpstreamSyncReleaseCandidateIntake) {
  return {
    id: candidate.id,
    title: candidate.title,
    summary: candidate.summary,
    category: candidate.category,
    areas: candidate.areas,
    changedFiles: candidate.changedFiles.slice(0, UPSTREAM_ANALYSIS_MAX_CHANGED_FILES),
    changedFileCount: candidate.changedFiles.length,
    heuristicDecision: candidate.recommendedDecision,
    heuristicReason: candidate.recommendedReason,
    autoDetectedAlreadyPresent: candidate.recommendedDecision === "already-present",
  };
}

function safeIsoOrNull(input: string | null | undefined): string | null {
  if (!input || Number.isNaN(Date.parse(input))) {
    return null;
  }
  return input;
}

function slugifyCandidateId(commitSha: string): string {
  return `commit-${commitSha.slice(0, 12)}`;
}

function buildDefaultForkMetadata(): UpstreamSyncForkMetadata {
  return {
    schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    upstream: {
      repo: DEFAULT_UPSTREAM_REPO,
      defaultBranch: DEFAULT_UPSTREAM_BRANCH,
      releaseChannel: "stable",
    },
    forkOrigin: {
      baseReleaseTag: DEFAULT_BASE_RELEASE_TAG,
      baseCommitSha: DEFAULT_BASE_COMMIT_SHA,
      confidence: "derived-from-repo-analysis",
      evidence: "Closest upstream snapshot for the local root commit matches T3 Code v0.0.13.",
    },
    tracking: {
      lastFullyTriagedReleaseTag: DEFAULT_BASE_RELEASE_TAG,
      lastFetchedReleaseTag: null,
    },
    defaults: {
      implementationMode: "logic-first",
    },
  };
}

function buildDefaultAreaPolicyFile(): UpstreamSyncAreaPolicyFile {
  return {
    schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    areas: [
      {
        id: "web",
        label: "Web UI",
        pathPrefixes: ["apps/web/"],
        titleKeywords: ["web", "chat", "sidebar", "settings", "ui"],
        defaultDecision: "apply",
      },
      {
        id: "server",
        label: "Server runtime",
        pathPrefixes: ["apps/server/"],
        titleKeywords: ["server", "provider", "codex", "claude", "session"],
        defaultDecision: "apply",
      },
      {
        id: "contracts",
        label: "Contracts",
        pathPrefixes: ["packages/contracts/"],
        titleKeywords: ["contract", "schema", "protocol"],
        defaultDecision: "apply",
      },
      {
        id: "shared",
        label: "Shared runtime",
        pathPrefixes: ["packages/shared/"],
        titleKeywords: ["shared", "util"],
        defaultDecision: "apply",
      },
      {
        id: "desktop",
        label: "Desktop app",
        pathPrefixes: ["apps/desktop/"],
        titleKeywords: ["desktop", "electron", "mac", "windows"],
        defaultDecision: "apply",
      },
      {
        id: "ci",
        label: "Release and CI",
        pathPrefixes: [".github/", "docs/release", "scripts/release"],
        titleKeywords: ["ci", "workflow", "release"],
        defaultDecision: "ignore",
        reason: "Upstream release automation rarely maps cleanly to the fork.",
      },
      {
        id: "docs",
        label: "Docs",
        pathPrefixes: ["README.md", "docs/"],
        titleKeywords: ["docs", "readme", "contributing"],
        defaultDecision: "ignore",
        reason: "Documentation is maintained separately in the fork.",
      },
      {
        id: "assets",
        label: "Branding and assets",
        pathPrefixes: ["assets/", "apps/web/public/", "apps/desktop/resources/"],
        titleKeywords: ["icon", "branding", "logo", "asset"],
        defaultDecision: "ignore",
        reason: "Fork branding intentionally diverges from upstream.",
      },
    ],
  };
}

async function readJsonFile<T>(filePath: string, decode: (input: unknown) => T): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return decode(JSON.parse(raw));
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureSyncConfig(cwd: string): Promise<{
  paths: SyncPaths;
  forkMetadata: UpstreamSyncForkMetadata;
  areaPolicies: UpstreamSyncAreaPolicyFile;
}> {
  const paths = resolveSyncPaths(cwd);
  await fs.mkdir(paths.releasesDir, { recursive: true });
  await fs.mkdir(paths.cacheDir, { recursive: true });

  let forkMetadata = await readJsonFile(paths.forkMetadataPath, decodeForkMetadata);
  if (!forkMetadata) {
    forkMetadata = buildDefaultForkMetadata();
    await writeJsonFile(paths.forkMetadataPath, forkMetadata);
  }

  let areaPolicies = await readJsonFile(paths.areasPath, decodeAreaPolicyFile);
  if (!areaPolicies) {
    areaPolicies = buildDefaultAreaPolicyFile();
    await writeJsonFile(paths.areasPath, areaPolicies);
  }

  return {
    paths,
    forkMetadata,
    areaPolicies,
  };
}

async function runGit(args: string[], options?: { cwd?: string; allowNonZeroExit?: boolean }) {
  return runProcess("git", args, {
    cwd: options?.cwd,
    allowNonZeroExit: options?.allowNonZeroExit,
    timeoutMs: MIRROR_FETCH_TIMEOUT_MS,
    maxBufferBytes: 16 * 1024 * 1024,
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureMirror(paths: SyncPaths, repo: string): Promise<void> {
  const mirrorExists = await pathExists(paths.mirrorDir);
  if (!mirrorExists) {
    await runGit(["init", "--bare", paths.mirrorDir]);
    await runGit([
      "-C",
      paths.mirrorDir,
      "remote",
      "add",
      "origin",
      `https://github.com/${repo}.git`,
    ]);
  }

  await runGit([
    "-C",
    paths.mirrorDir,
    "fetch",
    "--force",
    "--tags",
    "--prune",
    "origin",
    "+refs/heads/*:refs/remotes/origin/*",
  ]);
}

async function listStableReleaseTags(paths: SyncPaths, repo: string): Promise<string[]> {
  await ensureMirror(paths, repo);
  const result = await runGit([
    "-C",
    paths.mirrorDir,
    "tag",
    "--list",
    "v*",
    "--sort=version:refname",
  ]);
  return result.stdout
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => STABLE_RELEASE_TAG_PATTERN.test(value));
}

async function readTagDate(paths: SyncPaths, tag: string): Promise<string | null> {
  const result = await runGit([
    "-C",
    paths.mirrorDir,
    "log",
    "-1",
    "--format=%cI",
    `refs/tags/${tag}`,
  ]);
  return safeIsoOrNull(result.stdout.trim());
}

async function listReleaseCommits(
  paths: SyncPaths,
  previousTag: string,
  nextTag: string,
): Promise<string[]> {
  const result = await runGit([
    "-C",
    paths.mirrorDir,
    "rev-list",
    "--reverse",
    `${previousTag}..${nextTag}`,
  ]);
  return result.stdout
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseCommitMessage(message: string): { title: string; summary: string } {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const [firstLine = "Review upstream change", ...rest] = normalized.split("\n");
  return {
    title: truncateText(firstLine, 120) || "Review upstream change",
    summary: rest.join("\n").trim(),
  };
}

function inferCategory(title: string): UpstreamSyncCandidateCategory {
  const normalized = title.toLowerCase();
  if (normalized.startsWith("feat") || normalized.startsWith("add ")) {
    return "feature";
  }
  if (normalized.startsWith("fix") || normalized.startsWith("bug")) {
    return "fix";
  }
  if (normalized.startsWith("refactor") || normalized.startsWith("cleanup")) {
    return "refactor";
  }
  if (normalized.startsWith("docs") || normalized.includes("readme")) {
    return "docs";
  }
  if (
    normalized.startsWith("ci") ||
    normalized.startsWith("chore") ||
    normalized.includes("workflow") ||
    normalized.includes("release")
  ) {
    return "infra";
  }
  return "maintenance";
}

async function readCommit(paths: SyncPaths, commitSha: string): Promise<MirrorCommit> {
  const metadata = await runGit([
    "-C",
    paths.mirrorDir,
    "show",
    "-s",
    "--format=%H%x00%cI%x00%B",
    commitSha,
  ]);
  const [sha = commitSha, committedAt = "", rawMessage = ""] = metadata.stdout.split("\u0000");
  const changedFilesResult = await runGit([
    "-C",
    paths.mirrorDir,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commitSha,
  ]);
  const changedFiles = changedFilesResult.stdout
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .toSorted((left, right) => left.localeCompare(right));
  const parsedMessage = parseCommitMessage(rawMessage);
  return {
    sha,
    date: safeIsoOrNull(committedAt),
    title: parsedMessage.title,
    summary: parsedMessage.summary,
    changedFiles,
  };
}

function resolveMatchedAreas(
  areaPolicies: readonly UpstreamSyncAreaPolicy[],
  title: string,
  changedFiles: readonly string[],
): UpstreamSyncAreaPolicy[] {
  const normalizedTitle = title.toLowerCase();
  return areaPolicies.filter((area) => {
    const fileMatch = area.pathPrefixes.some((prefix) =>
      changedFiles.some((filePath) => filePath === prefix || filePath.startsWith(prefix)),
    );
    if (fileMatch) {
      return true;
    }
    return area.titleKeywords.some((keyword) => normalizedTitle.includes(keyword.toLowerCase()));
  });
}

function heuristicDecisionForCandidate(input: {
  category: UpstreamSyncCandidateCategory;
  matchedAreas: readonly UpstreamSyncAreaPolicy[];
  autoDetectedAlreadyPresent: boolean;
}): { decision: UpstreamSyncAnalysisDecision; reason: string } {
  if (input.autoDetectedAlreadyPresent) {
    return {
      decision: "already-present",
      reason: "Current local files already match the upstream release state for the changed paths.",
    };
  }

  if (
    input.matchedAreas.length > 0 &&
    input.matchedAreas.every((area) => area.defaultDecision === "ignore")
  ) {
    return {
      decision: "ignore",
      reason:
        input.matchedAreas.find((area) => area.reason)?.reason ??
        "This area is intentionally fork-specific or out of scope for Sam's Code.",
    };
  }

  if (input.category === "docs" || input.category === "infra") {
    const ignoredArea = input.matchedAreas.find((area) => area.defaultDecision === "ignore");
    if (ignoredArea?.reason) {
      return {
        decision: "ignore",
        reason: ignoredArea.reason,
      };
    }
  }

  return {
    decision: "apply",
    reason: "This upstream intent appears relevant and should be adapted into Sam's Code.",
  };
}

async function readMirrorFileAtRef(
  paths: SyncPaths,
  ref: string,
  filePath: string,
): Promise<string | null> {
  const result = await runProcess("git", ["-C", paths.mirrorDir, "show", `${ref}:${filePath}`], {
    allowNonZeroExit: true,
    timeoutMs: GIT_SHOW_TIMEOUT_MS,
    maxBufferBytes: 4 * 1024 * 1024,
    outputMode: "truncate",
  });
  if (result.code !== 0) {
    return null;
  }
  return result.stdout;
}

async function autoDetectAlreadyPresent(
  cwd: string,
  paths: SyncPaths,
  releaseTag: string,
  changedFiles: readonly string[],
): Promise<boolean> {
  const comparableFiles = changedFiles.filter((filePath) => TEXT_LIKE_FILE_PATTERN.test(filePath));
  if (comparableFiles.length === 0 || comparableFiles.length !== changedFiles.length) {
    return false;
  }

  for (const relativeFilePath of comparableFiles) {
    const upstreamContent = await readMirrorFileAtRef(paths, releaseTag, relativeFilePath);
    if (upstreamContent === null) {
      return false;
    }
    const localPath = path.join(cwd, relativeFilePath);
    let localContent: string;
    try {
      localContent = await fs.readFile(localPath, "utf8");
    } catch {
      return false;
    }
    if (localContent !== upstreamContent) {
      return false;
    }
  }

  return true;
}

async function buildCandidates(input: {
  cwd: string;
  paths: SyncPaths;
  repo: string;
  releaseTag: string;
  commits: readonly MirrorCommit[];
  areaPolicies: readonly UpstreamSyncAreaPolicy[];
}): Promise<UpstreamSyncReleaseCandidateIntake[]> {
  const candidates: UpstreamSyncReleaseCandidateIntake[] = [];
  for (const commit of input.commits) {
    const matchedAreas = resolveMatchedAreas(input.areaPolicies, commit.title, commit.changedFiles);
    const autoDetected = await autoDetectAlreadyPresent(
      input.cwd,
      input.paths,
      input.releaseTag,
      commit.changedFiles,
    );
    const heuristic = heuristicDecisionForCandidate({
      category: inferCategory(commit.title),
      matchedAreas,
      autoDetectedAlreadyPresent: autoDetected,
    });
    candidates.push({
      id: slugifyCandidateId(commit.sha),
      commitSha: commit.sha,
      commitUrl: `https://github.com/${input.repo}/commit/${commit.sha}`,
      title: commit.title,
      summary: commit.summary,
      authoredAt: commit.date,
      category: inferCategory(commit.title),
      areas: (matchedAreas.length > 0
        ? matchedAreas.map((area) => area.label)
        : ["General"]
      ).toSorted((left, right) => left.localeCompare(right)),
      changedFiles: commit.changedFiles,
      changeSummary:
        commit.summary.trim().length > 0
          ? truncateText(`${commit.title}. ${commit.summary}`, 280)
          : truncateText(commit.title, 280),
      forkValueSummary: heuristic.reason,
      recommendedDecision: heuristic.decision,
      recommendedReason: heuristic.reason,
    });
  }
  return candidates;
}

const UPSTREAM_ANALYSIS_PROVIDER_TIMEOUT_MS = 90_000;

async function runProviderBackedAnalysis(input: {
  providerService: typeof ProviderService.Service;
  cwd: string;
  model: string;
  modelOptions?: CodexModelOptions;
  providerOptions?: ProviderStartOptions;
  prompt: string;
  label: string;
}): Promise<string> {
  const threadId = ThreadId.makeUnsafe(`upstream-sync:${randomUUID()}`);
  let assistantText = "";
  let taskSummary: string | null = null;
  let lastTaskProgress: string | null = null;
  let settled = false;
  let contentDeltaEvents = 0;
  let taskProgressEvents = 0;
  let sawTurnCompleted = false;
  let sawRuntimeError = false;
  let nextAssistantLogThreshold = 1_000;

  logger.info("upstream provider analysis session starting", {
    label: input.label,
    threadId,
    model: input.model,
    reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
  });
  let resolveResult: ((value: string) => void) | null = null;
  let rejectResult: ((reason?: unknown) => void) | null = null;
  const resultPromise = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const succeed = (value: string) => {
    if (settled) {
      return;
    }
    settled = true;
    resolveResult?.(value);
  };
  const fail = (error: Error) => {
    if (settled) {
      return;
    }
    settled = true;
    rejectResult?.(error);
  };

  const eventFiber = Effect.runFork(
    Stream.runForEach(input.providerService.streamEvents, (event: ProviderRuntimeEvent) =>
      Effect.sync(() => {
        if (event.threadId !== threadId) {
          return;
        }
        switch (event.type) {
          case "content.delta": {
            if (event.payload.streamKind === "assistant_text") {
              contentDeltaEvents += 1;
              assistantText += event.payload.delta;
              if (assistantText.length >= nextAssistantLogThreshold) {
                logger.info("upstream provider analysis assistant output", {
                  label: input.label,
                  threadId,
                  chars: assistantText.length,
                  events: contentDeltaEvents,
                });
                nextAssistantLogThreshold += 1_000;
              }
            }
            return;
          }
          case "task.progress": {
            taskProgressEvents += 1;
            lastTaskProgress = event.payload.description;
            logger.info("upstream provider analysis task progress", {
              label: input.label,
              threadId,
              progress: truncateText(event.payload.description, 180),
            });
            return;
          }
          case "task.completed": {
            if (event.payload.summary) {
              taskSummary = event.payload.summary;
              logger.info("upstream provider analysis task completed", {
                label: input.label,
                threadId,
                summary: truncateText(event.payload.summary, 180),
              });
            }
            return;
          }
          case "runtime.error": {
            sawRuntimeError = true;
            logger.warn("upstream provider analysis runtime error", {
              label: input.label,
              threadId,
              message: truncateText(event.payload.message, 180),
            });
            fail(new Error(event.payload.message));
            return;
          }
          case "user-input.requested": {
            fail(new Error("Upstream analysis unexpectedly requested interactive user input."));
            return;
          }
          case "turn.aborted": {
            fail(new Error(event.payload.reason));
            return;
          }
          case "turn.completed": {
            sawTurnCompleted = true;
            const finalText =
              assistantText.trim().length > 0 ? assistantText.trim() : taskSummary?.trim();
            logger.info("upstream provider analysis turn completed", {
              label: input.label,
              threadId,
              state: event.payload.state,
              assistantChars: assistantText.length,
              hasTaskSummary: Boolean(taskSummary?.trim()),
              contentDeltaEvents,
              taskProgressEvents,
            });
            if (event.payload.state === "completed" && finalText && finalText.length > 0) {
              succeed(finalText);
              return;
            }
            fail(
              new Error(
                event.payload.errorMessage ??
                  `Analysis turn completed without usable assistant output (state: ${event.payload.state}).`,
              ),
            );
            return;
          }
          default:
            return;
        }
      }),
    ),
  );

  const timeout = setTimeout(() => {
    logger.warn("upstream provider analysis timeout", {
      label: input.label,
      threadId,
      model: input.model,
      reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
      assistantChars: assistantText.length,
      contentDeltaEvents,
      taskProgressEvents,
      lastTaskProgress: lastTaskProgress ? truncateText(lastTaskProgress, 180) : null,
      hasTaskSummary: Boolean(taskSummary?.trim()),
      sawTurnCompleted,
      sawRuntimeError,
    });
    fail(new Error("Provider-backed upstream analysis timed out."));
  }, UPSTREAM_ANALYSIS_PROVIDER_TIMEOUT_MS);
  timeout.unref?.();

  try {
    await Effect.runPromise(
      input.providerService.startSession(threadId, {
        threadId,
        provider: "codex",
        cwd: input.cwd,
        model: input.model,
        ...(input.modelOptions ? { modelOptions: { codex: input.modelOptions } } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      }),
    );
    logger.info("upstream provider analysis session ready", {
      label: input.label,
      threadId,
    });
    await Effect.runPromise(
      input.providerService.sendTurn({
        threadId,
        input: input.prompt,
        model: input.model,
        ...(input.modelOptions ? { modelOptions: { codex: input.modelOptions } } : {}),
        interactionMode: "plan",
      }),
    );
    logger.info("upstream provider analysis turn dispatched", {
      label: input.label,
      threadId,
      promptChars: input.prompt.length,
    });
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  }

  try {
    return await resultPromise;
  } finally {
    clearTimeout(timeout);
    await Effect.runPromiseExit(Fiber.interrupt(eventFiber));
    await Effect.runPromiseExit(input.providerService.stopSession({ threadId }));
  }
}

async function enrichCandidatesWithModelAnalysis(input: {
  cwd: string;
  releaseTag: string;
  previousTag: string | null;
  releaseNotes: string;
  candidates: readonly UpstreamSyncReleaseCandidateIntake[];
  model: string;
  modelOptions?: CodexModelOptions;
  providerOptions?: ProviderStartOptions;
  providerService: typeof ProviderService.Service;
}): Promise<{
  candidates: UpstreamSyncReleaseCandidateIntake[];
  analysis: UpstreamSyncAnalysisRun;
}> {
  const outputSchema = Schema.Struct({
    candidates: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        changeSummary: Schema.String,
        forkValueSummary: Schema.String,
        recommendedDecision: Schema.Literals(["apply", "ignore", "defer", "already-present"]),
        recommendedReason: Schema.String,
      }),
    ),
  });
  const decodeOutput = Schema.decodeUnknownSync(outputSchema);
  const startedAt = new Date();
  const candidateChunks = chunkArray(input.candidates, UPSTREAM_ANALYSIS_CHUNK_SIZE);
  const analyzedById = new Map<string, (typeof input.candidates)[number]>();
  const notes: string[] = [
    `Processed ${input.candidates.length} candidate changes in ${candidateChunks.length} model request(s).`,
  ];
  logger.info("starting upstream analysis", {
    releaseTag: input.releaseTag,
    model: input.model,
    reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
    candidateCount: input.candidates.length,
    chunkCount: candidateChunks.length,
  });
  let failedChunkCount = 0;
  let heuristicCandidateCount = 0;
  for (const [chunkIndex, chunk] of candidateChunks.entries()) {
    try {
      const prompt = [
        "You review upstream release changes for Sam's Code, a fork of T3 Code.",
        "Use the current repository as source of truth and return ONLY JSON.",
        "Stay in planning mode: do not run commands, do not edit files, and do not use tools unless absolutely necessary.",
        "Return a JSON object with key `candidates`.",
        "Each candidate must include: id, changeSummary, forkValueSummary, recommendedDecision, recommendedReason.",
        "Allowed recommendedDecision values: apply, ignore, defer, already-present.",
        "- `apply` means the upstream intent should land in the fork, even if implementation differs.",
        "- `already-present` means the fork already has the behavior and no sync work is needed.",
        "- `ignore` means the change should not be pulled into the fork.",
        "- `defer` means the change may matter later but should not be pulled now.",
        "- `changeSummary` should explain in 1-2 short sentences what changed upstream.",
        "- `forkValueSummary` should explain in 1-2 short sentences why this is or is not a good fit for Sam's Code.",
        "- Do not include markdown fences or prose outside the JSON.",
        "",
        `Release tag: ${input.releaseTag}`,
        ...(input.previousTag ? [`Previous tag: ${input.previousTag}`] : []),
        input.releaseNotes.trim().length > 0
          ? ["", "Release notes:", limitSection(input.releaseNotes, 8_000)].join("\n")
          : "",
        "",
        "Candidates:",
        limitSection(JSON.stringify(chunk.map(toAnalysisCandidatePayload), null, 2), 8_000),
      ]
        .filter((section) => section.length > 0)
        .join("\n");

      const rawOutput = await runProviderBackedAnalysis({
        providerService: input.providerService,
        cwd: input.cwd,
        model: input.model,
        ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
        prompt,
        label: `chunk ${chunkIndex + 1}/${candidateChunks.length}`,
      });
      const analysis = decodeOutput(JSON.parse(extractStructuredJson(rawOutput)));
      for (const candidate of chunk) {
        const analyzed = analysis.candidates.find((entry) => entry.id === candidate.id);
        if (!analyzed) {
          analyzedById.set(candidate.id, candidate);
          continue;
        }
        analyzedById.set(candidate.id, {
          ...candidate,
          changeSummary: analyzed.changeSummary,
          forkValueSummary: analyzed.forkValueSummary,
          recommendedDecision: analyzed.recommendedDecision,
          recommendedReason: analyzed.recommendedReason,
        });
      }
    } catch (error) {
      failedChunkCount += 1;
      notes.push(
        `Chunk ${chunkIndex + 1}/${candidateChunks.length} fell back to heuristics: ${truncateText(error instanceof Error ? error.message : String(error), 220)}`,
      );
      logger.warn("upstream analysis chunk fell back to heuristics", {
        releaseTag: input.releaseTag,
        model: input.model,
        reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
        chunkIndex: chunkIndex + 1,
        chunkSize: chunk.length,
        error: error instanceof Error ? error.message : String(error),
      });

      for (const candidate of chunk) {
        try {
          const retryPrompt = [
            "You review a single upstream T3 Code change for Sam's Code.",
            "Stay in planning mode: do not run commands, do not edit files, and do not use tools unless absolutely necessary.",
            "Return ONLY JSON with key `candidates` and exactly one object inside it.",
            "Fields: id, changeSummary, forkValueSummary, recommendedDecision, recommendedReason.",
            "Allowed recommendedDecision values: apply, ignore, defer, already-present.",
            "",
            `Release tag: ${input.releaseTag}`,
            ...(input.previousTag ? [`Previous tag: ${input.previousTag}`] : []),
            "",
            "Candidate:",
            JSON.stringify(toAnalysisCandidatePayload(candidate), null, 2),
          ].join("\n");

          const rawRetry = await runProviderBackedAnalysis({
            providerService: input.providerService,
            cwd: input.cwd,
            model: input.model,
            ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
            ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
            prompt: retryPrompt,
            label: `candidate ${candidate.id}`,
          });
          const retry = decodeOutput(JSON.parse(extractStructuredJson(rawRetry)));
          const analyzed = retry.candidates[0];
          if (!analyzed) {
            analyzedById.set(candidate.id, candidate);
            continue;
          }
          analyzedById.set(candidate.id, {
            ...candidate,
            changeSummary: analyzed.changeSummary,
            forkValueSummary: analyzed.forkValueSummary,
            recommendedDecision: analyzed.recommendedDecision,
            recommendedReason: analyzed.recommendedReason,
          });
          notes.push(`Recovered ${candidate.id} with a single-candidate retry.`);
        } catch (retryError) {
          analyzedById.set(candidate.id, candidate);
          heuristicCandidateCount += 1;
          notes.push(
            `Single-candidate retry for ${candidate.id} also fell back: ${truncateText(retryError instanceof Error ? retryError.message : String(retryError), 180)}`,
          );
          logger.warn("upstream single-candidate retry fell back to heuristics", {
            releaseTag: input.releaseTag,
            model: input.model,
            reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
            candidateId: candidate.id,
            error: retryError instanceof Error ? retryError.message : String(retryError),
          });
        }
      }
    }
  }
  const completedAt = new Date();
  logger.info("completed upstream analysis", {
    releaseTag: input.releaseTag,
    model: input.model,
    reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
    candidateCount: input.candidates.length,
    failedChunkCount,
    heuristicCandidateCount,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  });
  const modeledCandidateCount = input.candidates.length - heuristicCandidateCount;
  if (failedChunkCount === 0) {
    notes.push("All chunks completed with model-assisted analysis.");
  } else if (modeledCandidateCount > 0) {
    notes.push(
      `Model analysis covered ${modeledCandidateCount}/${input.candidates.length} candidates; ${heuristicCandidateCount} remained heuristic.`,
    );
  } else {
    notes.push("All candidates fell back to heuristics.");
  }
  return {
    candidates: input.candidates.map((candidate) => analyzedById.get(candidate.id) ?? candidate),
    analysis: {
      source:
        heuristicCandidateCount === 0
          ? "model"
          : modeledCandidateCount > 0
            ? "partial-model"
            : "heuristic-fallback",
      model: input.model,
      ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      modeledCandidateCount,
      heuristicCandidateCount,
      notes,
    },
  };
}

async function readReleaseIntake(
  paths: SyncPaths,
  tag: string,
): Promise<UpstreamSyncReleaseIntake | null> {
  try {
    return await readJsonFile(paths.intakePath(tag), decodeReleaseIntake);
  } catch {
    await fs.rm(paths.intakePath(tag), { force: true });
    return null;
  }
}

async function readReleaseTriage(
  paths: SyncPaths,
  tag: string,
): Promise<UpstreamSyncReleaseTriage | null> {
  try {
    return await readJsonFile(paths.triagePath(tag), decodeReleaseTriage);
  } catch {
    await fs.rm(paths.triagePath(tag), { force: true });
    return null;
  }
}

function buildEmptyTriage(tag: string): UpstreamSyncReleaseTriage {
  return {
    schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    tag,
    updatedAt: nowIso(),
    decisions: [],
  };
}

function mergeReleaseReport(
  intake: UpstreamSyncReleaseIntake,
  triage: UpstreamSyncReleaseTriage,
): UpstreamSyncReleaseReport {
  const decisionByCandidateId = new Map(
    triage.decisions.map((decision) => [decision.candidateId, decision] as const),
  );
  const candidates: UpstreamSyncReleaseCandidate[] = intake.candidates.map((candidate) => {
    const savedDecision = decisionByCandidateId.get(candidate.id);
    return {
      ...candidate,
      decision: savedDecision?.decision ?? "pending",
      note: savedDecision?.note ?? null,
    };
  });
  const triagedAt = candidates.every((candidate) => candidate.decision !== "pending")
    ? triage.updatedAt
    : null;
  return {
    tag: intake.tag,
    name: intake.name,
    url: intake.url,
    publishedAt: intake.publishedAt,
    previousTag: intake.previousTag,
    compareUrl: intake.compareUrl,
    fetchedAt: intake.fetchedAt,
    releaseNotes: intake.releaseNotes,
    analysis: intake.analysis,
    candidates,
    triagedAt,
  };
}

async function writeReleaseTriage(
  paths: SyncPaths,
  triage: UpstreamSyncReleaseTriage,
): Promise<void> {
  await writeJsonFile(paths.triagePath(triage.tag), triage);
}

async function writeForkMetadata(paths: SyncPaths, value: UpstreamSyncForkMetadata): Promise<void> {
  await writeJsonFile(paths.forkMetadataPath, value);
}

async function loadReleaseReportFromDisk(
  paths: SyncPaths,
  tag: string,
): Promise<UpstreamSyncReleaseReport | null> {
  const intake = await readReleaseIntake(paths, tag);
  if (!intake) {
    return null;
  }
  const triage = (await readReleaseTriage(paths, tag)) ?? buildEmptyTriage(tag);
  return mergeReleaseReport(intake, triage);
}

async function resolveReleaseData(input: {
  cwd: string;
  tag: string;
  forceRefresh?: boolean;
  analysisModel?: string;
  analysisModelOptions?: CodexModelOptions;
  analysisProviderOptions?: ProviderStartOptions;
  providerService: typeof ProviderService.Service;
}): Promise<UpstreamSyncReleaseReport> {
  const ensured = await ensureSyncConfig(input.cwd);
  if (!input.forceRefresh) {
    const cached = await loadReleaseReportFromDisk(ensured.paths, input.tag);
    if (cached) {
      return cached;
    }
  }

  const tags = await listStableReleaseTags(ensured.paths, ensured.forkMetadata.upstream.repo);
  const tagIndex = tags.indexOf(input.tag);
  if (tagIndex === -1) {
    throw new Error(`No upstream release tag named ${input.tag} was found.`);
  }
  if (tagIndex === 0) {
    throw new Error(`Release ${input.tag} has no earlier stable release to compare against.`);
  }
  const previousTag = tags[tagIndex - 1] ?? null;
  if (!previousTag) {
    throw new Error(`Release ${input.tag} has no earlier stable release to compare against.`);
  }

  const commitShas = await listReleaseCommits(ensured.paths, previousTag, input.tag);
  const commits = await Promise.all(
    commitShas.map((commitSha) => readCommit(ensured.paths, commitSha)),
  );
  let candidates = await buildCandidates({
    cwd: input.cwd,
    paths: ensured.paths,
    repo: ensured.forkMetadata.upstream.repo,
    releaseTag: input.tag,
    commits,
    areaPolicies: ensured.areaPolicies.areas,
  });
  const analysisStartedAt = new Date();
  let analysis: UpstreamSyncAnalysisRun = {
    source: "heuristic-fallback",
    model: input.analysisModel?.trim() || DEFAULT_MODEL_BY_PROVIDER.codex,
    ...(input.analysisModelOptions ? { modelOptions: input.analysisModelOptions } : {}),
    startedAt: analysisStartedAt.toISOString(),
    completedAt: analysisStartedAt.toISOString(),
    durationMs: 0,
    modeledCandidateCount: 0,
    heuristicCandidateCount: candidates.length,
    notes: ["Using heuristic release review until model-assisted analysis completes successfully."],
  };

  const analysisModel = input.analysisModel?.trim() || DEFAULT_MODEL_BY_PROVIDER.codex;
  try {
    const enriched = await enrichCandidatesWithModelAnalysis({
      cwd: input.cwd,
      releaseTag: input.tag,
      previousTag,
      releaseNotes: "",
      candidates,
      model: analysisModel,
      ...(input.analysisModelOptions ? { modelOptions: input.analysisModelOptions } : {}),
      ...(input.analysisProviderOptions ? { providerOptions: input.analysisProviderOptions } : {}),
      providerService: input.providerService,
    });
    candidates = enriched.candidates;
    analysis = enriched.analysis;
  } catch (error) {
    const completedAt = new Date();
    analysis = {
      ...analysis,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - analysisStartedAt.getTime(),
      modeledCandidateCount: 0,
      heuristicCandidateCount: candidates.length,
      notes: [
        "Model-assisted review failed, so heuristic recommendations are shown instead.",
        error instanceof Error
          ? truncateText(error.message, 220)
          : "Unknown model analysis failure.",
      ],
    };
    logger.warn("upstream analysis fell back to heuristics", {
      releaseTag: input.tag,
      model: analysisModel,
      reasoningEffort: input.analysisModelOptions?.reasoningEffort ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const intake: UpstreamSyncReleaseIntake = {
    schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    tag: input.tag,
    name: input.tag,
    url: `https://github.com/${ensured.forkMetadata.upstream.repo}/releases/tag/${input.tag}`,
    publishedAt: await readTagDate(ensured.paths, input.tag),
    previousTag,
    compareUrl: `https://github.com/${ensured.forkMetadata.upstream.repo}/compare/${previousTag}...${input.tag}`,
    fetchedAt: nowIso(),
    releaseNotes: "",
    analysis,
    candidates,
  };
  await writeJsonFile(ensured.paths.intakePath(input.tag), intake);

  const triage = (await readReleaseTriage(ensured.paths, input.tag)) ?? buildEmptyTriage(input.tag);
  const validIds = new Set(candidates.map((candidate) => candidate.id));
  const existingDecisions = triage.decisions.filter((decision) =>
    validIds.has(decision.candidateId),
  );
  const autoDetectedAlreadyPresentDecisions = candidates
    .filter((candidate) => candidate.recommendedDecision === "already-present")
    .filter(
      (candidate) => !existingDecisions.some((decision) => decision.candidateId === candidate.id),
    )
    .map<UpstreamSyncReleaseCandidateDecision>((candidate) => ({
      candidateId: candidate.id,
      decision: "already-present",
      note: null,
    }));
  const normalizedTriage: UpstreamSyncReleaseTriage = {
    ...triage,
    decisions: [...existingDecisions, ...autoDetectedAlreadyPresentDecisions],
  };
  await writeReleaseTriage(ensured.paths, normalizedTriage);

  const nextMetadata: UpstreamSyncForkMetadata = {
    ...ensured.forkMetadata,
    tracking: {
      ...ensured.forkMetadata.tracking,
      lastFetchedReleaseTag: input.tag,
    },
  };
  await writeForkMetadata(ensured.paths, nextMetadata);

  return mergeReleaseReport(intake, normalizedTriage);
}

function collectCachedReleaseTags(paths: SyncPaths): Promise<string[]> {
  return fs
    .readdir(paths.releasesDir, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((entry) => STABLE_RELEASE_TAG_PATTERN.test(entry))
        .toSorted((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    )
    .catch(() => []);
}

async function buildStatus(input: UpstreamSyncStatusInput): Promise<UpstreamSyncStatus> {
  const ensured = await ensureSyncConfig(input.cwd);
  let tags: string[] = [];
  try {
    tags = await listStableReleaseTags(ensured.paths, ensured.forkMetadata.upstream.repo);
  } catch {
    tags = await collectCachedReleaseTags(ensured.paths);
  }

  const latestReleaseTag = tags[tags.length - 1] ?? null;
  const currentIndex = tags.indexOf(ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag);
  const nextReleaseTag = currentIndex >= 0 ? (tags[currentIndex + 1] ?? null) : null;
  const activeReleaseTag =
    ensured.forkMetadata.tracking.lastFetchedReleaseTag &&
    ensured.forkMetadata.tracking.lastFetchedReleaseTag !==
      ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag
      ? ensured.forkMetadata.tracking.lastFetchedReleaseTag
      : null;

  return {
    cwd: input.cwd,
    metadataPath: ensured.paths.forkMetadataPath,
    areasPath: ensured.paths.areasPath,
    upstreamRepo: ensured.forkMetadata.upstream.repo,
    baseReleaseTag: ensured.forkMetadata.forkOrigin.baseReleaseTag,
    lastFullyTriagedReleaseTag: ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag,
    lastFetchedReleaseTag: ensured.forkMetadata.tracking.lastFetchedReleaseTag,
    activeReleaseTag,
    latestReleaseTag,
    nextReleaseTag,
  };
}

function upsertDecision(
  decisions: readonly UpstreamSyncReleaseCandidateDecision[],
  nextDecision: UpstreamSyncReleaseCandidateDecision,
): UpstreamSyncReleaseCandidateDecision[] {
  const existingIndex = decisions.findIndex(
    (decision) => decision.candidateId === nextDecision.candidateId,
  );
  if (existingIndex === -1) {
    return [...decisions, nextDecision];
  }
  return decisions.map((decision, index) => (index === existingIndex ? nextDecision : decision));
}

function truncateThreadTitle(value: string, maxLength = 50): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildImplementationPrompt(
  report: UpstreamSyncReleaseReport,
): UpstreamSyncImplementationPromptResult {
  const selectedCandidates = report.candidates.filter(
    (candidate) => candidate.decision === "apply",
  );
  if (selectedCandidates.length === 0) {
    throw new Error("Mark at least one upstream change as Apply before starting implementation.");
  }

  const skippedCandidates = report.candidates.filter((candidate) => candidate.decision !== "apply");
  const promptSections = [
    `Implement the selected upstream sync items for T3 Code ${report.tag} in Sam's Code.`,
    "",
    "Context:",
    "- Sam's Code is a fork of pingdotgg/t3code.",
    "- Treat upstream commits as behavioral references, not patches to copy verbatim.",
    "- Preserve fork-specific decisions, especially branding and intentional product divergence.",
    "- Prefer logic-first adaptation over cherry-picking or wholesale file replacement.",
    "- Before finishing, run `bun fmt`, `bun lint`, and `bun typecheck`.",
    "",
    `Target release: ${report.tag}`,
    ...(report.previousTag ? [`Previous upstream anchor: ${report.previousTag}`] : []),
    ...(report.compareUrl ? [`Compare URL: ${report.compareUrl}`] : []),
    "",
    "Selected upstream items:",
    ...selectedCandidates.flatMap((candidate, index) => [
      `${index + 1}. ${candidate.title}`,
      `   - commit: ${candidate.commitSha}`,
      `   - url: ${candidate.commitUrl}`,
      `   - category: ${candidate.category}`,
      `   - areas: ${candidate.areas.join(", ")}`,
      ...(candidate.changeSummary.trim().length > 0
        ? [`   - what changed: ${truncateText(candidate.changeSummary, 280)}`]
        : []),
      ...(candidate.forkValueSummary.trim().length > 0
        ? [`   - why it may fit: ${truncateText(candidate.forkValueSummary, 280)}`]
        : []),
      ...(candidate.summary.trim().length > 0
        ? [`   - summary: ${truncateText(candidate.summary, 280)}`]
        : []),
      ...(candidate.note?.trim() ? [`   - fork notes: ${truncateText(candidate.note, 280)}`] : []),
      ...(candidate.changedFiles.length > 0
        ? [
            "   - touched files:",
            ...candidate.changedFiles.slice(0, 12).map((filePath) => `     - ${filePath}`),
            ...(candidate.changedFiles.length > 12
              ? [`     - ...and ${candidate.changedFiles.length - 12} more`]
              : []),
          ]
        : []),
    ]),
    "",
    "Skipped items:",
    ...skippedCandidates.map(
      (candidate) =>
        `- ${candidate.title} (${candidate.decision})${candidate.note?.trim() ? ` - ${truncateText(candidate.note, 180)}` : ""}`,
    ),
    "",
    "Implementation guidance:",
    "- Inspect the relevant local files first and align with current Sam's Code architecture.",
    "- Recreate the upstream intent in the local codebase instead of mirroring upstream structure blindly.",
    "- Skip upstream-only release automation, branding, or intentionally removed fork features unless explicitly required.",
    "- If an upstream change conflicts with current local architecture, prefer extracting or adapting shared logic.",
    "- Summarize what changed and why after implementation.",
  ];

  return {
    releaseTag: report.tag,
    threadTitle: truncateThreadTitle(`Apply T3 ${report.tag} updates`),
    prompt: promptSections.join("\n").trim(),
    selectedCandidateIds: selectedCandidates.map((candidate) => candidate.id),
    skippedCandidateIds: skippedCandidates.map((candidate) => candidate.id),
  };
}

function toUpstreamSyncError(error: unknown): UpstreamSyncError {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag?: unknown })._tag === "UpstreamSyncError"
  ) {
    return error as UpstreamSyncError;
  }
  if (error instanceof Error) {
    return new UpstreamSyncError({
      message: error.message,
      cause: error,
    });
  }
  return new UpstreamSyncError({
    message: "Upstream sync failed.",
    cause: error,
  });
}

const makeUpstreamSync = Effect.gen(function* () {
  const providerService = yield* ProviderService;

  const service: UpstreamSyncShape = {
    getStatus: (input) =>
      Effect.tryPromise({
        try: () => buildStatus(input),
        catch: toUpstreamSyncError,
      }),
    fetchNextRelease: (input) =>
      Effect.tryPromise({
        try: async () => {
          const ensured = await ensureSyncConfig(input.cwd);
          const tags = await listStableReleaseTags(
            ensured.paths,
            ensured.forkMetadata.upstream.repo,
          );
          const currentIndex = tags.indexOf(
            ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag,
          );
          const nextTag = currentIndex >= 0 ? (tags[currentIndex + 1] ?? null) : null;
          if (!nextTag) {
            return null;
          }
          return resolveReleaseData({
            cwd: input.cwd,
            tag: nextTag,
            ...(input.forceRefresh !== undefined ? { forceRefresh: input.forceRefresh } : {}),
            ...(input.analysisModel ? { analysisModel: input.analysisModel } : {}),
            ...(input.analysisModelOptions
              ? { analysisModelOptions: input.analysisModelOptions }
              : {}),
            ...(input.analysisProviderOptions
              ? { analysisProviderOptions: input.analysisProviderOptions }
              : {}),
            providerService,
          });
        },
        catch: toUpstreamSyncError,
      }),
    getRelease: (input) =>
      Effect.tryPromise({
        try: async () => {
          const ensured = await ensureSyncConfig(input.cwd);
          const cached = await loadReleaseReportFromDisk(ensured.paths, input.tag);
          if (cached) {
            return cached;
          }
          return resolveReleaseData({
            cwd: input.cwd,
            tag: input.tag,
            providerService,
          });
        },
        catch: toUpstreamSyncError,
      }),
    updateCandidate: (input) =>
      Effect.tryPromise({
        try: async () => {
          const ensured = await ensureSyncConfig(input.cwd);
          const intake = await readReleaseIntake(ensured.paths, input.tag);
          if (!intake) {
            throw new Error(
              `No fetched upstream intake found for ${input.tag}. Review the release first.`,
            );
          }
          if (!intake.candidates.some((candidate) => candidate.id === input.candidateId)) {
            throw new Error(`Unknown upstream change candidate: ${input.candidateId}.`);
          }
          const triage =
            (await readReleaseTriage(ensured.paths, input.tag)) ?? buildEmptyTriage(input.tag);
          const nextTriage: UpstreamSyncReleaseTriage = {
            ...triage,
            updatedAt: nowIso(),
            decisions: upsertDecision(triage.decisions, {
              candidateId: input.candidateId,
              decision: input.decision,
              note: input.note ?? null,
            }),
          };
          await writeReleaseTriage(ensured.paths, nextTriage);
          const report = mergeReleaseReport(intake, nextTriage);
          await writeForkMetadata(ensured.paths, {
            ...ensured.forkMetadata,
            tracking: {
              ...ensured.forkMetadata.tracking,
              lastFetchedReleaseTag: input.tag,
              lastFullyTriagedReleaseTag: report.triagedAt
                ? input.tag
                : ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag,
            },
          });
          return report;
        },
        catch: toUpstreamSyncError,
      }),
    generateImplementationPrompt: (input) =>
      Effect.tryPromise({
        try: async () => {
          const ensured = await ensureSyncConfig(input.cwd);
          const report =
            (await loadReleaseReportFromDisk(ensured.paths, input.tag)) ??
            (await resolveReleaseData({
              cwd: input.cwd,
              tag: input.tag,
              providerService,
            }));
          return buildImplementationPrompt(report);
        },
        catch: toUpstreamSyncError,
      }),
  };

  return service;
});

export const UpstreamSyncLive = Layer.effect(UpstreamSync, makeUpstreamSync);
