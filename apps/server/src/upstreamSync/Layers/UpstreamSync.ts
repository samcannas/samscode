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
  type UpstreamSyncActiveCandidate,
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
  type UpstreamSyncReviewPhase,
  type UpstreamSyncReviewState,
  type UpstreamSyncReleaseTriage,
  type UpstreamSyncStartNextReleaseReviewInput,
  type UpstreamSyncStatus,
  type UpstreamSyncStatusInput,
  UpstreamSyncAreaPolicyFile as UpstreamSyncAreaPolicyFileSchema,
  UpstreamSyncForkMetadata as UpstreamSyncForkMetadataSchema,
  UpstreamSyncReleaseIntake as UpstreamSyncReleaseIntakeSchema,
  UpstreamSyncReleaseTriage as UpstreamSyncReleaseTriageSchema,
} from "@samscode/contracts";
import { Effect, Fiber, Layer, PubSub, Schema, Stream } from "effect";

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
const DEFAULT_UPSTREAM_ANALYSIS_CONCURRENCY = 4;
const UPSTREAM_ANALYSIS_MAX_CHANGED_FILES = 8;
const logger = createLogger("upstream-sync");

type SyncPaths = ReturnType<typeof resolveSyncPaths>;

type MirrorCommit = {
  sha: string;
  date: string | null;
  title: string;
  summary: string;
  changedFiles: string[];
  patchText: string;
  fileDiffs: Record<string, string>;
};

type UpstreamSyncAnalysisDecision = "apply" | "ignore" | "already-present";

type CandidateAnalysisContext = {
  candidate: UpstreamSyncReleaseCandidateIntake;
  commit: MirrorCommit;
  autoDetectedAlreadyPresent: boolean;
  localFileSnapshots: Array<{
    path: string;
    content: string;
  }>;
};

type ReviewProgressCallbacks = {
  onCandidateCount?: (count: number) => void;
  onCandidateStarted?: (input: {
    candidate: UpstreamSyncReleaseCandidateIntake;
    index: number;
    total: number;
  }) => void;
  onCandidateCompleted?: (input: {
    candidate: UpstreamSyncReleaseCandidateIntake;
    index: number;
    total: number;
    completedCount: number;
  }) => void;
  onProviderProgress?: (input: {
    candidate: UpstreamSyncReleaseCandidateIntake;
    index: number;
    total: number;
    message: string;
  }) => void;
};

type BuildReleaseDataResult = {
  intake: UpstreamSyncReleaseIntake;
  triage: UpstreamSyncReleaseTriage;
  metadata: UpstreamSyncForkMetadata;
  report: UpstreamSyncReleaseReport;
};

type ActiveReviewJob = {
  state: UpstreamSyncReviewState;
  promise: Promise<void> | null;
};

type ActiveCandidateRuntimeState = UpstreamSyncActiveCandidate;

const UPSTREAM_ANALYSIS_PROVIDER_STALL_WARNING_MS = 120_000;
const UPSTREAM_ANALYSIS_PROVIDER_MAX_TIMEOUT_MS = 20 * 60_000;
const UPSTREAM_ANALYSIS_REVIEW_MAX_TIMEOUT_MS = 2 * 60 * 60_000;
const UPSTREAM_ANALYSIS_MAX_PATCH_CHARS = 16_000;
const UPSTREAM_ANALYSIS_MAX_LOCAL_FILE_CHARS = 8_000;
const UPSTREAM_ANALYSIS_MAX_LOCAL_FILES = 4;

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
    debugLogPath: path.join(rootDir, "debug.log"),
    forkMetadataPath: path.join(rootDir, "fork.json"),
    areasPath: path.join(rootDir, "areas.json"),
    intakePath: (tag: string) => path.join(releasesDir, tag, "intake.json"),
    triagePath: (tag: string) => path.join(releasesDir, tag, "triage.json"),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function appendUpstreamDebugLog(
  cwd: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const paths = resolveSyncPaths(cwd);
    await fs.mkdir(paths.rootDir, { recursive: true });
    const contextSuffix =
      context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
    await fs.appendFile(paths.debugLogPath, `${nowIso()} ${message}${contextSuffix}\n`, "utf8");
  } catch {
    // Best-effort debug logging only.
  }
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
        id: "desktop-renderer",
        label: "Desktop renderer",
        pathPrefixes: ["apps/desktop-renderer/"],
        titleKeywords: ["renderer", "chat", "sidebar", "settings", "ui"],
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
        pathPrefixes: ["assets/", "apps/desktop/resources/"],
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

async function readJsonValue(filePath: string): Promise<unknown | null> {
  return readJsonFile(filePath, (value) => value);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readForkMetadata(paths: SyncPaths): Promise<UpstreamSyncForkMetadata | null> {
  try {
    const raw = await readJsonValue(paths.forkMetadataPath);
    if (!raw) {
      return null;
    }
    const migrated = {
      ...(raw as Record<string, unknown>),
      schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    };
    const decoded = decodeForkMetadata(migrated);
    if ((raw as { schemaVersion?: unknown }).schemaVersion !== UPSTREAM_SYNC_SCHEMA_VERSION) {
      await writeJsonFile(paths.forkMetadataPath, decoded);
    }
    return decoded;
  } catch {
    await fs.rm(paths.forkMetadataPath, { force: true });
    return null;
  }
}

async function readAreaPolicies(paths: SyncPaths): Promise<UpstreamSyncAreaPolicyFile | null> {
  try {
    const raw = await readJsonValue(paths.areasPath);
    if (!raw) {
      return null;
    }
    const migrated = {
      ...(raw as Record<string, unknown>),
      schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    };
    const decoded = decodeAreaPolicyFile(migrated);
    if ((raw as { schemaVersion?: unknown }).schemaVersion !== UPSTREAM_SYNC_SCHEMA_VERSION) {
      await writeJsonFile(paths.areasPath, decoded);
    }
    return decoded;
  } catch {
    await fs.rm(paths.areasPath, { force: true });
    return null;
  }
}

async function ensureSyncConfig(cwd: string): Promise<{
  paths: SyncPaths;
  forkMetadata: UpstreamSyncForkMetadata;
  areaPolicies: UpstreamSyncAreaPolicyFile;
}> {
  const paths = resolveSyncPaths(cwd);
  await fs.mkdir(paths.releasesDir, { recursive: true });
  await fs.mkdir(paths.cacheDir, { recursive: true });

  let forkMetadata = await readForkMetadata(paths);
  if (!forkMetadata) {
    forkMetadata = buildDefaultForkMetadata();
    await writeJsonFile(paths.forkMetadataPath, forkMetadata);
  }

  let areaPolicies = await readAreaPolicies(paths);
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

async function runGit(
  args: string[],
  options?: { cwd?: string; allowNonZeroExit?: boolean; timeoutMs?: number },
) {
  return runProcess("git", args, {
    cwd: options?.cwd,
    allowNonZeroExit: options?.allowNonZeroExit,
    timeoutMs: options?.timeoutMs ?? MIRROR_FETCH_TIMEOUT_MS,
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
  const patchResult = await runGit(
    ["-C", paths.mirrorDir, "show", "--format=", "--unified=3", commitSha],
    {
      timeoutMs: GIT_SHOW_TIMEOUT_MS,
    },
  );
  const parsedMessage = parseCommitMessage(rawMessage);
  const fileDiffs: Record<string, string> = {};
  for (const changedFile of changedFiles
    .filter((filePath) => TEXT_LIKE_FILE_PATTERN.test(filePath))
    .slice(0, UPSTREAM_ANALYSIS_MAX_CHANGED_FILES)) {
    const filePatch = await runGit(
      ["-C", paths.mirrorDir, "show", "--format=", "--unified=3", commitSha, "--", changedFile],
      {
        allowNonZeroExit: true,
        timeoutMs: GIT_SHOW_TIMEOUT_MS,
      },
    );
    if (filePatch.code === 0 && filePatch.stdout.trim().length > 0) {
      fileDiffs[changedFile] = limitSection(filePatch.stdout.trim(), 4_000);
    }
  }
  return {
    sha,
    date: safeIsoOrNull(committedAt),
    title: parsedMessage.title,
    summary: parsedMessage.summary,
    changedFiles,
    patchText: limitSection(patchResult.stdout.trim(), UPSTREAM_ANALYSIS_MAX_PATCH_CHARS),
    fileDiffs,
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

async function readLocalFileSnapshot(
  cwd: string,
  filePath: string,
): Promise<{ path: string; content: string } | null> {
  const absolutePath = path.join(cwd, filePath);
  try {
    const content = await fs.readFile(absolutePath, "utf8");
    return {
      path: filePath,
      content: limitSection(content, UPSTREAM_ANALYSIS_MAX_LOCAL_FILE_CHARS),
    };
  } catch {
    return null;
  }
}

async function buildCandidateAnalysisContext(input: {
  cwd: string;
  paths: SyncPaths;
  releaseTag: string;
  candidate: UpstreamSyncReleaseCandidateIntake;
  commit: MirrorCommit;
}): Promise<CandidateAnalysisContext> {
  const localFileSnapshots = (
    await Promise.all(
      input.candidate.changedFiles
        .filter((filePath) => TEXT_LIKE_FILE_PATTERN.test(filePath))
        .slice(0, UPSTREAM_ANALYSIS_MAX_LOCAL_FILES)
        .map((filePath) => readLocalFileSnapshot(input.cwd, filePath)),
    )
  ).filter((value) => value !== null);

  return {
    candidate: input.candidate,
    commit: input.commit,
    autoDetectedAlreadyPresent: await autoDetectAlreadyPresent(
      input.cwd,
      input.paths,
      input.releaseTag,
      input.candidate.changedFiles,
    ),
    localFileSnapshots,
  };
}

function buildIdleReviewState(cwd: string): UpstreamSyncReviewState {
  const updatedAt = nowIso();
  return {
    cwd,
    status: "idle",
    phase: "idle",
    releaseTag: null,
    previousTag: null,
    startedAt: null,
    updatedAt,
    completedAt: null,
    candidateCount: null,
    completedCandidateCount: 0,
    maxConcurrency: null,
    runningCandidateCount: 0,
    queuedCandidateCount: null,
    activeCandidates: [],
    currentCandidateId: null,
    currentCandidateTitle: null,
    currentCandidateIndex: null,
    lastProviderProgress: null,
    message: null,
    error: null,
  };
}

function buildStartingReviewState(cwd: string, startedAt = nowIso()): UpstreamSyncReviewState {
  return {
    ...buildIdleReviewState(cwd),
    status: "running",
    phase: "fetching-upstream",
    startedAt,
    message: "Checking for the next upstream release.",
  };
}

function updateReviewState(
  current: UpstreamSyncReviewState,
  patch: Partial<UpstreamSyncReviewState> & {
    phase?: UpstreamSyncReviewPhase;
  },
): UpstreamSyncReviewState {
  return {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
}

function clampAnalysisConcurrency(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_UPSTREAM_ANALYSIS_CONCURRENCY;
  }
  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function wrapCandidateAnalysisError(
  candidate: UpstreamSyncReleaseCandidateIntake,
  error: unknown,
): Error {
  const cause = error instanceof Error ? error.message : String(error);
  return new Error(`Candidate ${candidate.id} ("${candidate.title}") failed: ${cause}`);
}

function buildSingleCandidateAnalysisPrompt(input: {
  releaseTag: string;
  previousTag: string | null;
  context: CandidateAnalysisContext;
}): string {
  const { candidate, commit, autoDetectedAlreadyPresent, localFileSnapshots } = input.context;
  return [
    "You review a single upstream T3 Code change for Sam's Code.",
    "Inspect the upstream diff context first, then inspect corresponding local files when needed, and do not edit files.",
    "Return ONLY JSON with key `candidates` and exactly one object inside it.",
    "Fields: id, changeSummary, forkValueSummary, recommendedDecision, recommendedReason.",
    "Allowed recommendedDecision values: apply, ignore, already-present.",
    "The response must be valid JSON that parses with JSON.parse.",
    "Use double-quoted JSON keys and double-quoted string values.",
    "Do not use markdown fences, comments, trailing commas, ellipses, placeholders, or explanatory text before or after the JSON object.",
    "Choose exactly one concrete side. `defer` is invalid.",
    "If uncertain, inspect more local code until a concrete side is justified.",
    "`recommendedReason` must cite concrete local evidence, specific fork architecture, or a precise mismatch with the upstream intent.",
    "Generic rationale is invalid.",
    "",
    "Valid JSON example for an `apply` decision:",
    JSON.stringify(
      {
        candidates: [
          {
            id: candidate.id,
            changeSummary:
              "Upstream refactors provider model selection so the provider-owned model catalog drives the chosen model.",
            forkValueSummary:
              "Sam's Code also selects provider-backed models and would benefit from the same consistency and reduced duplication.",
            recommendedDecision: "apply" satisfies UpstreamSyncAnalysisDecision,
            recommendedReason:
              "The local renderer and server both maintain provider/model selection paths, so aligning selection logic with provider-owned metadata would reduce drift and keep behavior predictable.",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Valid JSON example for an `already-present` decision:",
    JSON.stringify(
      {
        candidates: [
          {
            id: candidate.id,
            changeSummary:
              "Upstream adds reconnect backoff handling for transient websocket disconnects.",
            forkValueSummary:
              "The fork already preserves reconnect stability, so the upstream intent is already covered.",
            recommendedDecision: "already-present" satisfies UpstreamSyncAnalysisDecision,
            recommendedReason:
              "Local websocket session handling already tracks reconnect state and applies bounded retry behavior, so this upstream change would duplicate existing fork logic.",
          },
        ],
      },
      null,
      2,
    ),
    "",
    `Release tag: ${input.releaseTag}`,
    ...(input.previousTag ? [`Previous tag: ${input.previousTag}`] : []),
    "",
    "Candidate metadata:",
    JSON.stringify(toAnalysisCandidatePayload(candidate), null, 2),
    "",
    "Upstream commit:",
    JSON.stringify(
      {
        sha: commit.sha,
        title: commit.title,
        body: commit.summary,
        changedFiles: commit.changedFiles,
        autoDetectedAlreadyPresentHint: autoDetectedAlreadyPresent,
      },
      null,
      2,
    ),
    "",
    "Upstream patch excerpt:",
    commit.patchText || "[no patch excerpt available]",
    "",
    "Per-file diff excerpts:",
    Object.keys(commit.fileDiffs).length > 0
      ? JSON.stringify(commit.fileDiffs, null, 2)
      : "[no text diff excerpts available]",
    "",
    "Local file snapshots:",
    localFileSnapshots.length > 0
      ? JSON.stringify(localFileSnapshots, null, 2)
      : "[no corresponding local text files available]",
  ].join("\n");
}

async function runProviderBackedAnalysis(input: {
  providerService: typeof ProviderService.Service;
  cwd: string;
  model: string;
  modelOptions?: CodexModelOptions;
  providerOptions?: ProviderStartOptions;
  prompt: string;
  label: string;
  onProgress?: (message: string) => void;
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
  let lastActivityAt = Date.now();
  let stallWarnings = 0;
  let stallWarningTimeout: ReturnType<typeof setTimeout> | null = null;
  let maxTimeout: ReturnType<typeof setTimeout> | null = null;

  const diagnostics = () =>
    [
      `contentDeltaEvents=${contentDeltaEvents}`,
      `taskProgressEvents=${taskProgressEvents}`,
      `assistantChars=${assistantText.length}`,
      `lastTaskProgress=${lastTaskProgress ? truncateText(lastTaskProgress, 180) : "none"}`,
      `sawTurnCompleted=${sawTurnCompleted}`,
      `sawRuntimeError=${sawRuntimeError}`,
    ].join(", ");

  const scheduleStallWarning = () => {
    if (stallWarningTimeout) {
      clearTimeout(stallWarningTimeout);
    }
    stallWarningTimeout = setTimeout(() => {
      const stalledForMs = Date.now() - lastActivityAt;
      stallWarnings += 1;
      logger.warn("upstream provider analysis idle timeout", {
        label: input.label,
        threadId,
        model: input.model,
        reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
        stalledForMs,
        diagnostics: diagnostics(),
        stallWarnings,
      });
      scheduleStallWarning();
    }, UPSTREAM_ANALYSIS_PROVIDER_STALL_WARNING_MS);
    stallWarningTimeout.unref?.();
  };

  const noteActivity = () => {
    lastActivityAt = Date.now();
    scheduleStallWarning();
  };

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
              noteActivity();
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
            noteActivity();
            input.onProgress?.(event.payload.description);
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
              noteActivity();
              input.onProgress?.(event.payload.summary);
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
            fail(
              new Error(
                `Provider-backed upstream analysis failed: ${event.payload.message} (${diagnostics()}).`,
              ),
            );
            return;
          }
          case "user-input.requested": {
            fail(
              new Error(
                `Upstream analysis unexpectedly requested interactive user input (${diagnostics()}).`,
              ),
            );
            return;
          }
          case "turn.aborted": {
            fail(new Error(`Provider turn aborted: ${event.payload.reason} (${diagnostics()}).`));
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
                event.payload.errorMessage
                  ? `Analysis turn failed: ${event.payload.errorMessage} (${diagnostics()}).`
                  : `Analysis turn completed without usable assistant output (state: ${event.payload.state}; ${diagnostics()}).`,
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

  scheduleStallWarning();
  maxTimeout = setTimeout(() => {
    logger.warn("upstream provider analysis max timeout", {
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
    fail(
      new Error(
        `Provider-backed upstream analysis timed out after ${Math.round(UPSTREAM_ANALYSIS_PROVIDER_MAX_TIMEOUT_MS / 60_000)} minutes (${diagnostics()}).`,
      ),
    );
  }, UPSTREAM_ANALYSIS_PROVIDER_MAX_TIMEOUT_MS);
  maxTimeout.unref?.();

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
    if (stallWarningTimeout) {
      clearTimeout(stallWarningTimeout);
    }
    if (maxTimeout) {
      clearTimeout(maxTimeout);
    }
    await Effect.runPromiseExit(Fiber.interrupt(eventFiber));
    await Effect.runPromiseExit(input.providerService.stopSession({ threadId }));
  }
}

async function enrichCandidatesWithModelAnalysis(input: {
  cwd: string;
  paths: SyncPaths;
  releaseTag: string;
  previousTag: string | null;
  releaseNotes: string;
  candidates: readonly UpstreamSyncReleaseCandidateIntake[];
  commits: readonly MirrorCommit[];
  model: string;
  modelOptions?: CodexModelOptions;
  providerOptions?: ProviderStartOptions;
  analysisConcurrency: number;
  providerService: typeof ProviderService.Service;
  progress?: ReviewProgressCallbacks;
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
        recommendedDecision: Schema.Literals(["apply", "ignore", "already-present"]),
        recommendedReason: Schema.String,
      }),
    ),
  });
  const decodeOutput = Schema.decodeUnknownSync(outputSchema);
  const startedAt = new Date();
  const commitBySha = new Map(input.commits.map((commit) => [commit.sha, commit] as const));
  const analyzedById = new Map<string, (typeof input.candidates)[number]>();
  const workItems = input.candidates.map((candidate, index) => {
    const commit = commitBySha.get(candidate.commitSha);
    if (!commit) {
      throw new Error(`Missing upstream commit context for ${candidate.id}.`);
    }
    return {
      candidate,
      commit,
      index,
      total: input.candidates.length,
    };
  });
  const notes: string[] = [`Processed ${input.candidates.length} candidate changes.`];
  logger.info("starting upstream analysis", {
    releaseTag: input.releaseTag,
    model: input.model,
    reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
    candidateCount: input.candidates.length,
    concurrency: input.analysisConcurrency,
  });
  input.progress?.onCandidateCount?.(input.candidates.length);
  const onProviderProgress = input.progress?.onProviderProgress;
  let nextIndex = 0;
  let abortRequested = false;
  let failure: Error | null = null;
  let completedCandidateCount = 0;

  const worker = async () => {
    while (!abortRequested) {
      const workItem = workItems[nextIndex];
      if (!workItem) {
        return;
      }
      nextIndex += 1;
      input.progress?.onCandidateStarted?.({
        candidate: workItem.candidate,
        index: workItem.index,
        total: workItem.total,
      });
      try {
        const analysisContext = await buildCandidateAnalysisContext({
          cwd: input.cwd,
          paths: input.paths,
          releaseTag: input.releaseTag,
          candidate: workItem.candidate,
          commit: workItem.commit,
        });
        if (abortRequested) {
          return;
        }
        const rawOutput = await runProviderBackedAnalysis({
          providerService: input.providerService,
          cwd: input.cwd,
          model: input.model,
          ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
          ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
          prompt: buildSingleCandidateAnalysisPrompt({
            releaseTag: input.releaseTag,
            previousTag: input.previousTag,
            context: analysisContext,
          }),
          label: `candidate ${workItem.candidate.id}`,
          ...(onProviderProgress
            ? {
                onProgress: (message) => {
                  if (abortRequested) {
                    return;
                  }
                  onProviderProgress({
                    candidate: workItem.candidate,
                    index: workItem.index,
                    total: workItem.total,
                    message,
                  });
                },
              }
            : {}),
        });
        if (abortRequested) {
          return;
        }
        const analysis = decodeOutput(JSON.parse(extractStructuredJson(rawOutput)));
        const analyzed = analysis.candidates.find((entry) => entry.id === workItem.candidate.id);
        if (!analyzed) {
          throw new Error(
            `Model analysis did not return a result for candidate ${workItem.candidate.id}.`,
          );
        }
        if (analyzed.recommendedReason.trim().length === 0) {
          throw new Error(
            `Model analysis returned an empty rationale for candidate ${workItem.candidate.id}.`,
          );
        }
        analyzedById.set(workItem.candidate.id, {
          ...workItem.candidate,
          changeSummary: analyzed.changeSummary,
          forkValueSummary: analyzed.forkValueSummary,
          recommendedDecision: analyzed.recommendedDecision,
          recommendedReason: analyzed.recommendedReason.trim(),
        });
        completedCandidateCount += 1;
        input.progress?.onCandidateCompleted?.({
          candidate: workItem.candidate,
          index: workItem.index,
          total: workItem.total,
          completedCount: completedCandidateCount,
        });
      } catch (error) {
        const wrapped = wrapCandidateAnalysisError(workItem.candidate, error);
        if (!failure) {
          abortRequested = true;
          failure = wrapped;
        }
        throw wrapped;
      }
    }
  };

  const workerCount = Math.min(input.analysisConcurrency, Math.max(workItems.length, 1));
  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker()),
  );
  const rejectedWorker = workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    throw failure;
  }
  if (rejectedWorker) {
    throw rejectedWorker.reason instanceof Error
      ? rejectedWorker.reason
      : new Error(String(rejectedWorker.reason));
  }
  const completedAt = new Date();
  logger.info("completed upstream analysis", {
    releaseTag: input.releaseTag,
    model: input.model,
    reasoningEffort: input.modelOptions?.reasoningEffort ?? null,
    candidateCount: input.candidates.length,
    concurrency: input.analysisConcurrency,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  });
  const modeledCandidateCount = input.candidates.length;
  notes.push("All candidates completed with model-backed analysis.");
  return {
    candidates: input.candidates.map((candidate) => analyzedById.get(candidate.id) ?? candidate),
    analysis: {
      source: "model",
      model: input.model,
      ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      modeledCandidateCount,
      heuristicCandidateCount: 0,
      notes,
    },
  };
}

async function readReleaseIntake(
  paths: SyncPaths,
  tag: string,
): Promise<UpstreamSyncReleaseIntake | null> {
  try {
    const raw = await readJsonFile(paths.intakePath(tag), (value) => value);
    if (!raw) {
      return null;
    }
    const candidateHasDefer =
      Array.isArray((raw as { candidates?: unknown }).candidates) &&
      (raw as { candidates: Array<{ recommendedDecision?: unknown }> }).candidates.some(
        (candidate) => candidate.recommendedDecision === "defer",
      );
    const analysisSource = (raw as { analysis?: { source?: unknown } }).analysis?.source;
    const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (
      schemaVersion !== UPSTREAM_SYNC_SCHEMA_VERSION ||
      analysisSource !== "model" ||
      candidateHasDefer
    ) {
      await fs.rm(paths.intakePath(tag), { force: true });
      return null;
    }
    return decodeReleaseIntake(raw);
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
    const raw = await readJsonFile(paths.triagePath(tag), (value) => value);
    if (!raw) {
      return null;
    }
    let didMigrate = false;
    const decisions = Array.isArray((raw as { decisions?: unknown }).decisions)
      ? (
          raw as {
            decisions: Array<{ candidateId: string; decision: string; note?: string | null }>;
          }
        ).decisions.map((decision) => {
          if (decision.decision !== "defer") {
            return decision;
          }
          didMigrate = true;
          return {
            candidateId: decision.candidateId,
            decision: "pending",
            note: decision.note ?? null,
          };
        })
      : [];
    const migrated = {
      ...(raw as Record<string, unknown>),
      schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
      decisions,
    };
    const decoded = decodeReleaseTriage(migrated);
    if (
      didMigrate ||
      (raw as { schemaVersion?: unknown }).schemaVersion !== UPSTREAM_SYNC_SCHEMA_VERSION
    ) {
      await writeReleaseTriage(paths, decoded);
    }
    return decoded;
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

async function buildReleaseData(input: {
  cwd: string;
  tag: string;
  forceRefresh?: boolean;
  analysisModel?: string;
  analysisConcurrency?: number;
  analysisModelOptions?: CodexModelOptions;
  analysisProviderOptions?: ProviderStartOptions;
  providerService: typeof ProviderService.Service;
  progress?: ReviewProgressCallbacks;
}): Promise<BuildReleaseDataResult> {
  const ensured = await ensureSyncConfig(input.cwd);
  if (!input.forceRefresh) {
    const cached = await loadReleaseReportFromDisk(ensured.paths, input.tag);
    if (cached) {
      return {
        intake: {
          schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
          tag: cached.tag,
          name: cached.name,
          url: cached.url,
          publishedAt: cached.publishedAt,
          previousTag: cached.previousTag,
          compareUrl: cached.compareUrl,
          fetchedAt: cached.fetchedAt,
          releaseNotes: cached.releaseNotes,
          analysis: cached.analysis,
          candidates: cached.candidates.map(
            ({ decision: _decision, note: _note, ...candidate }) => candidate,
          ),
        },
        triage: {
          schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
          tag: cached.tag,
          updatedAt: cached.triagedAt ?? nowIso(),
          decisions: cached.candidates
            .filter((candidate) => candidate.decision !== "pending")
            .map((candidate) => ({
              candidateId: candidate.id,
              decision: candidate.decision,
              note: candidate.note,
            })),
        },
        metadata: ensured.forkMetadata,
        report: cached,
      };
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
  const candidates = await buildCandidates({
    cwd: input.cwd,
    paths: ensured.paths,
    repo: ensured.forkMetadata.upstream.repo,
    releaseTag: input.tag,
    commits,
    areaPolicies: ensured.areaPolicies.areas,
  });
  const analysisModel = input.analysisModel?.trim() || DEFAULT_MODEL_BY_PROVIDER.codex;
  const analysisConcurrency = clampAnalysisConcurrency(input.analysisConcurrency);
  const enriched = await enrichCandidatesWithModelAnalysis({
    cwd: input.cwd,
    paths: ensured.paths,
    releaseTag: input.tag,
    previousTag,
    releaseNotes: "",
    candidates,
    commits,
    model: analysisModel,
    analysisConcurrency,
    ...(input.analysisModelOptions ? { modelOptions: input.analysisModelOptions } : {}),
    ...(input.analysisProviderOptions ? { providerOptions: input.analysisProviderOptions } : {}),
    providerService: input.providerService,
    ...(input.progress ? { progress: input.progress } : {}),
  });

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
    analysis: enriched.analysis,
    candidates: enriched.candidates,
  };
  const triage = (await readReleaseTriage(ensured.paths, input.tag)) ?? buildEmptyTriage(input.tag);
  const validIds = new Set(enriched.candidates.map((candidate) => candidate.id));
  const existingDecisions = triage.decisions.filter((decision) =>
    validIds.has(decision.candidateId),
  );
  const autoDetectedAlreadyPresentDecisions = enriched.candidates
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
  const nextMetadata: UpstreamSyncForkMetadata = {
    ...ensured.forkMetadata,
    tracking: {
      ...ensured.forkMetadata.tracking,
      lastFetchedReleaseTag: input.tag,
    },
  };
  return {
    intake,
    triage: normalizedTriage,
    metadata: nextMetadata,
    report: mergeReleaseReport(intake, normalizedTriage),
  };
}

async function persistReleaseData(paths: SyncPaths, data: BuildReleaseDataResult): Promise<void> {
  await writeJsonFile(paths.intakePath(data.intake.tag), data.intake);
  await writeReleaseTriage(paths, data.triage);
  await writeForkMetadata(paths, data.metadata);
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

async function resolveNextReleaseTag(cwd: string): Promise<{
  paths: SyncPaths;
  forkMetadata: UpstreamSyncForkMetadata;
  nextTag: string | null;
}> {
  await appendUpstreamDebugLog(cwd, "resolveNextReleaseTag:start");
  const ensured = await ensureSyncConfig(cwd);
  const tags = await listStableReleaseTags(ensured.paths, ensured.forkMetadata.upstream.repo);
  const currentIndex = tags.indexOf(ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag);
  const result = {
    paths: ensured.paths,
    forkMetadata: ensured.forkMetadata,
    nextTag: currentIndex >= 0 ? (tags[currentIndex + 1] ?? null) : null,
  };
  await appendUpstreamDebugLog(cwd, "resolveNextReleaseTag:completed", {
    nextTag: result.nextTag,
    currentIndex,
    lastFullyTriagedReleaseTag: ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag,
  });
  return result;
}

async function withPromiseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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

export const UpstreamSyncTestHelpers = {
  buildIdleReviewState,
  buildStartingReviewState,
  ensureSyncConfig,
  readReleaseIntake,
  readReleaseTriage,
  resolveSyncPaths,
  updateReviewState,
  writeJsonFile,
};

const makeUpstreamSync = Effect.gen(function* () {
  const providerService = yield* ProviderService;
  const reviewStatePubSub = yield* PubSub.unbounded<UpstreamSyncReviewState>();
  const jobs = new Map<string, ActiveReviewJob>();

  const publishReviewState = (state: UpstreamSyncReviewState): void => {
    void Effect.runPromise(PubSub.publish(reviewStatePubSub, state)).catch((error) => {
      logger.warn("failed to publish upstream review state", {
        cwd: state.cwd,
        status: state.status,
        phase: state.phase,
        releaseTag: state.releaseTag,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const updateJobState = async (
    cwd: string,
    patch: Partial<UpstreamSyncReviewState> & { phase?: UpstreamSyncReviewPhase },
  ): Promise<UpstreamSyncReviewState> => {
    const current = jobs.get(cwd)?.state ?? buildIdleReviewState(cwd);
    const next = updateReviewState(current, patch);
    jobs.set(cwd, {
      state: next,
      promise: jobs.get(cwd)?.promise ?? null,
    });
    publishReviewState(next);
    return next;
  };

  const setJob = (cwd: string, state: UpstreamSyncReviewState, promise: Promise<void> | null) => {
    jobs.set(cwd, { state, promise });
  };

  const runReviewJob = async (input: UpstreamSyncStartNextReleaseReviewInput): Promise<void> => {
    const initialState = jobs.get(input.cwd)?.state ?? buildIdleReviewState(input.cwd);
    const analysisConcurrency = clampAnalysisConcurrency(input.analysisConcurrency);
    const activeCandidatesById = new Map<string, ActiveCandidateRuntimeState>();
    let candidateCount: number | null = null;
    let completedCandidateCount = 0;
    let lastActiveCandidateId: string | null = null;

    const publishAnalyzingState = (
      patch: Partial<UpstreamSyncReviewState> & { phase?: UpstreamSyncReviewPhase } = {},
    ) => {
      const activeCandidates = [...activeCandidatesById.values()].toSorted(
        (left, right) => left.index - right.index,
      );
      const currentCandidate =
        (lastActiveCandidateId ? activeCandidatesById.get(lastActiveCandidateId) : null) ??
        activeCandidates[0] ??
        null;
      const queuedCandidateCount =
        candidateCount === null
          ? null
          : Math.max(candidateCount - completedCandidateCount - activeCandidates.length, 0);
      void updateJobState(input.cwd, {
        phase: "analyzing",
        candidateCount,
        completedCandidateCount,
        maxConcurrency: analysisConcurrency,
        runningCandidateCount: activeCandidates.length,
        queuedCandidateCount,
        activeCandidates,
        currentCandidateId: currentCandidate?.id ?? null,
        currentCandidateTitle: currentCandidate?.title ?? null,
        currentCandidateIndex: currentCandidate?.index ?? null,
        lastProviderProgress: currentCandidate?.lastProviderProgress ?? null,
        ...patch,
      });
    };

    try {
      await appendUpstreamDebugLog(input.cwd, "runReviewJob:start", {
        startedAt: initialState.startedAt,
      });
      const reviewPromise = (async () => {
        const { paths, nextTag } = await resolveNextReleaseTag(input.cwd);
        if (!nextTag) {
          await appendUpstreamDebugLog(input.cwd, "runReviewJob:no-next-tag");
          await updateJobState(input.cwd, {
            status: "completed",
            phase: "completed",
            releaseTag: null,
            previousTag: null,
            completedAt: nowIso(),
            candidateCount: null,
            completedCandidateCount: 0,
            maxConcurrency: analysisConcurrency,
            runningCandidateCount: 0,
            queuedCandidateCount: null,
            activeCandidates: [],
            currentCandidateId: null,
            currentCandidateTitle: null,
            currentCandidateIndex: null,
            lastProviderProgress: null,
            message: "No newer upstream release is available to review.",
            error: null,
          });
          return;
        }
        await appendUpstreamDebugLog(input.cwd, "runReviewJob:next-tag", {
          nextTag,
        });
        await updateJobState(input.cwd, {
          status: "running",
          phase: "fetching-upstream",
          releaseTag: nextTag,
          previousTag: null,
          startedAt: initialState.startedAt ?? nowIso(),
          completedAt: null,
          candidateCount: null,
          completedCandidateCount: 0,
          maxConcurrency: analysisConcurrency,
          runningCandidateCount: 0,
          queuedCandidateCount: null,
          activeCandidates: [],
          currentCandidateId: null,
          currentCandidateTitle: null,
          currentCandidateIndex: null,
          lastProviderProgress: null,
          message: `Reviewing upstream release ${nextTag}.`,
          error: null,
        });
        const releaseData = await buildReleaseData({
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
          analysisConcurrency,
          providerService,
          progress: {
            onCandidateCount: (count) => {
              candidateCount = count;
              publishAnalyzingState({
                message:
                  count > 0
                    ? `Analyzing ${count} upstream candidate${count === 1 ? "" : "s"} with ${analysisConcurrency} worker${analysisConcurrency === 1 ? "" : "s"}.`
                    : "No upstream candidates found for this release.",
              });
            },
            onCandidateStarted: ({ candidate, index, total }) => {
              activeCandidatesById.set(candidate.id, {
                id: candidate.id,
                title: candidate.title,
                index,
                lastProviderProgress: null,
              });
              lastActiveCandidateId = candidate.id;
              publishAnalyzingState({
                message: `Analyzing ${completedCandidateCount} of ${total} candidates with ${analysisConcurrency} worker${analysisConcurrency === 1 ? "" : "s"} active.`,
              });
            },
            onCandidateCompleted: ({ candidate, total, completedCount }) => {
              completedCandidateCount = completedCount;
              activeCandidatesById.delete(candidate.id);
              if (lastActiveCandidateId === candidate.id) {
                lastActiveCandidateId = null;
              }
              publishAnalyzingState({
                message: `Completed ${completedCount} of ${total} candidates.`,
              });
            },
            onProviderProgress: ({ candidate, index, message }) => {
              activeCandidatesById.set(candidate.id, {
                id: candidate.id,
                title: candidate.title,
                index,
                lastProviderProgress: truncateText(message, 240),
              });
              lastActiveCandidateId = candidate.id;
              publishAnalyzingState();
            },
          },
        });
        await appendUpstreamDebugLog(input.cwd, "runReviewJob:buildReleaseData-completed", {
          releaseTag: releaseData.report.tag,
          candidateCount: releaseData.report.candidates.length,
        });
        await updateJobState(input.cwd, {
          phase: "persisting",
          previousTag: releaseData.report.previousTag,
          releaseTag: releaseData.report.tag,
          runningCandidateCount: 0,
          queuedCandidateCount: 0,
          activeCandidates: [],
          currentCandidateId: null,
          currentCandidateTitle: null,
          currentCandidateIndex: null,
          lastProviderProgress: null,
          message: `Persisting review for ${releaseData.report.tag}.`,
        });
        await persistReleaseData(paths, releaseData);
        await appendUpstreamDebugLog(input.cwd, "runReviewJob:persistReleaseData-completed", {
          releaseTag: releaseData.report.tag,
        });
        await updateJobState(input.cwd, {
          status: "completed",
          phase: "completed",
          releaseTag: releaseData.report.tag,
          previousTag: releaseData.report.previousTag,
          completedAt: nowIso(),
          runningCandidateCount: 0,
          queuedCandidateCount: 0,
          activeCandidates: [],
          currentCandidateId: null,
          currentCandidateTitle: null,
          currentCandidateIndex: null,
          lastProviderProgress: null,
          message: `Completed review for ${releaseData.report.tag}.`,
          error: null,
        });
      })();

      await withPromiseTimeout(
        reviewPromise,
        UPSTREAM_ANALYSIS_REVIEW_MAX_TIMEOUT_MS,
        `Upstream review timed out after ${Math.round(UPSTREAM_ANALYSIS_REVIEW_MAX_TIMEOUT_MS / 60_000)} minutes.`,
      );
    } catch (error) {
      await appendUpstreamDebugLog(input.cwd, "runReviewJob:failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await updateJobState(input.cwd, {
        status: "failed",
        phase: "failed",
        completedAt: nowIso(),
        maxConcurrency: analysisConcurrency,
        runningCandidateCount: 0,
        queuedCandidateCount:
          candidateCount === null ? null : Math.max(candidateCount - completedCandidateCount, 0),
        activeCandidates: [],
        currentCandidateId: null,
        currentCandidateTitle: null,
        currentCandidateIndex: null,
        lastProviderProgress: null,
        message: "Upstream review failed.",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      const current = jobs.get(input.cwd)?.state ?? buildIdleReviewState(input.cwd);
      await appendUpstreamDebugLog(input.cwd, "runReviewJob:finally", {
        finalStatus: current.status,
        finalPhase: current.phase,
        finalReleaseTag: current.releaseTag,
      });
      setJob(input.cwd, current, null);
    }
  };

  const service: UpstreamSyncShape = {
    getStatus: (input) =>
      Effect.tryPromise({
        try: () => buildStatus(input),
        catch: toUpstreamSyncError,
      }),
    startNextReleaseReview: (input) =>
      Effect.tryPromise({
        try: async () => {
          await appendUpstreamDebugLog(input.cwd, "startNextReleaseReview:invoked", {
            forceRefresh: input.forceRefresh ?? null,
            analysisModel: input.analysisModel ?? null,
            reasoningEffort: input.analysisModelOptions?.reasoningEffort ?? null,
          });
          const existing = jobs.get(input.cwd);
          if (existing?.promise) {
            await appendUpstreamDebugLog(input.cwd, "startNextReleaseReview:reuse-running-job", {
              releaseTag: existing.state.releaseTag,
              phase: existing.state.phase,
            });
            logger.info("reusing running upstream review job", {
              cwd: input.cwd,
              releaseTag: existing.state.releaseTag,
              phase: existing.state.phase,
            });
            return existing.state;
          }
          const startedAt = nowIso();
          const runningState = buildStartingReviewState(input.cwd, startedAt);
          await appendUpstreamDebugLog(input.cwd, "startNextReleaseReview:created-running-state", {
            startedAt,
          });
          logger.info("starting upstream review job", {
            cwd: input.cwd,
            model: input.analysisModel?.trim() || DEFAULT_MODEL_BY_PROVIDER.codex,
            reasoningEffort: input.analysisModelOptions?.reasoningEffort ?? null,
          });
          const promise = runReviewJob(input).catch((error) => {
            logger.warn("upstream review job failed", {
              cwd: input.cwd,
              releaseTag: jobs.get(input.cwd)?.state.releaseTag,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          setJob(input.cwd, runningState, promise);
          publishReviewState(runningState);
          await appendUpstreamDebugLog(input.cwd, "startNextReleaseReview:returning", {
            status: runningState.status,
            phase: runningState.phase,
          });
          return runningState;
        },
        catch: toUpstreamSyncError,
      }),
    getReviewState: (input) =>
      Effect.tryPromise({
        try: async () => {
          const state = jobs.get(input.cwd)?.state ?? buildIdleReviewState(input.cwd);
          await appendUpstreamDebugLog(input.cwd, "getReviewState:returning", {
            status: state.status,
            phase: state.phase,
            releaseTag: state.releaseTag,
          });
          return state;
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
          return (
            await buildReleaseData({
              cwd: input.cwd,
              tag: input.tag,
              providerService,
            })
          ).report;
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
            (
              await buildReleaseData({
                cwd: input.cwd,
                tag: input.tag,
                providerService,
              })
            ).report;
          return buildImplementationPrompt(report);
        },
        catch: toUpstreamSyncError,
      }),
    streamReviewStates: Stream.fromPubSub(reviewStatePubSub),
  };

  return service;
});

export const UpstreamSyncLive = Layer.effect(UpstreamSync, makeUpstreamSync);
