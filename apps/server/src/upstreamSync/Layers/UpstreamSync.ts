import fs from "node:fs/promises";
import path from "node:path";

import {
  UPSTREAM_SYNC_SCHEMA_VERSION,
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
  type UpstreamSyncTerminalDecision,
  UpstreamSyncAreaPolicyFile as UpstreamSyncAreaPolicyFileSchema,
  UpstreamSyncForkMetadata as UpstreamSyncForkMetadataSchema,
  UpstreamSyncReleaseIntake as UpstreamSyncReleaseIntakeSchema,
  UpstreamSyncReleaseTriage as UpstreamSyncReleaseTriageSchema,
} from "@samscode/contracts";
import { Effect, Layer, Schema } from "effect";

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
const DEFAULT_FETCH_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "Sam's Code",
} as const;

type GitHubReleaseResponse = {
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  created_at: string | null;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
};

type GitHubCompareCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      date?: string | null;
    } | null;
  };
};

type GitHubCompareResponse = {
  html_url?: string;
  commits: GitHubCompareCommit[];
};

type GitHubCommitResponse = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      date?: string | null;
    } | null;
  };
  files?: Array<{
    filename: string;
  }>;
};

type SyncPaths = ReturnType<typeof resolveSyncPaths>;

const decodeForkMetadata = Schema.decodeUnknownSync(UpstreamSyncForkMetadataSchema);
const decodeAreaPolicyFile = Schema.decodeUnknownSync(UpstreamSyncAreaPolicyFileSchema);
const decodeReleaseIntake = Schema.decodeUnknownSync(UpstreamSyncReleaseIntakeSchema);
const decodeReleaseTriage = Schema.decodeUnknownSync(UpstreamSyncReleaseTriageSchema);

function resolveSyncPaths(cwd: string) {
  const rootDir = path.join(cwd, UPSTREAM_SYNC_DIR);
  const releasesDir = path.join(rootDir, "releases");
  return {
    rootDir,
    releasesDir,
    forkMetadataPath: path.join(rootDir, "fork.json"),
    areasPath: path.join(rootDir, "areas.json"),
    releaseDir: (tag: string) => path.join(releasesDir, tag),
    intakePath: (tag: string) => path.join(releasesDir, tag, "intake.json"),
    triagePath: (tag: string) => path.join(releasesDir, tag, "triage.json"),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncateText(input: string, maxLength = 160): string {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function safeIsoOrNull(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  return Number.isNaN(Date.parse(input)) ? null : input;
}

function slugifyCandidateId(commitSha: string): string {
  return `commit-${commitSha.slice(0, 12)}`;
}

function parseCommitMessage(message: string): { title: string; summary: string } {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const [firstLine = "Review upstream change", ...rest] = normalized.split("\n");
  const title = truncateText(firstLine, 120) || "Review upstream change";
  const summary = rest.join("\n").trim();
  return {
    title,
    summary,
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
        defaultDecision: "adapt",
      },
      {
        id: "server",
        label: "Server runtime",
        pathPrefixes: ["apps/server/"],
        titleKeywords: ["server", "provider", "codex", "claude", "session"],
        defaultDecision: "adapt",
      },
      {
        id: "contracts",
        label: "Contracts",
        pathPrefixes: ["packages/contracts/"],
        titleKeywords: ["contract", "schema", "protocol"],
        defaultDecision: "adapt",
      },
      {
        id: "shared",
        label: "Shared runtime",
        pathPrefixes: ["packages/shared/"],
        titleKeywords: ["shared", "util"],
        defaultDecision: "adapt",
      },
      {
        id: "desktop",
        label: "Desktop app",
        pathPrefixes: ["apps/desktop/"],
        titleKeywords: ["desktop", "electron", "mac", "windows"],
        defaultDecision: "adapt",
      },
      {
        id: "ci",
        label: "Release and CI",
        pathPrefixes: [".github/", "scripts/release", "docs/release"],
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

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: DEFAULT_FETCH_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status} ${response.statusText}).`);
  }
  return (await response.json()) as T;
}

function sortReleasesAscending(releases: GitHubReleaseResponse[]): GitHubReleaseResponse[] {
  return releases.toSorted((left, right) => {
    const leftTime = Date.parse(left.published_at ?? left.created_at ?? "");
    const rightTime = Date.parse(right.published_at ?? right.created_at ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.tag_name.localeCompare(right.tag_name);
  });
}

async function listStableReleases(repo: string): Promise<GitHubReleaseResponse[]> {
  const releases = await fetchGitHubJson<GitHubReleaseResponse[]>(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
  );
  return sortReleasesAscending(releases.filter((release) => !release.draft && !release.prerelease));
}

function findReleaseByTag(
  releases: readonly GitHubReleaseResponse[],
  tag: string,
): GitHubReleaseResponse | null {
  return releases.find((release) => release.tag_name === tag) ?? null;
}

function findNextRelease(
  releases: readonly GitHubReleaseResponse[],
  anchorTag: string,
): GitHubReleaseResponse | null {
  const anchorIndex = releases.findIndex((release) => release.tag_name === anchorTag);
  if (anchorIndex === -1) {
    return releases[0] ?? null;
  }
  return releases[anchorIndex + 1] ?? null;
}

function fileMatchesPrefix(filePath: string, prefix: string): boolean {
  return filePath === prefix || filePath.startsWith(prefix);
}

function resolveMatchedAreas(
  areaPolicies: readonly UpstreamSyncAreaPolicy[],
  title: string,
  changedFiles: readonly string[],
): UpstreamSyncAreaPolicy[] {
  const normalizedTitle = title.toLowerCase();
  return areaPolicies.filter((area) => {
    if (
      area.pathPrefixes.some((prefix) =>
        changedFiles.some((file) => fileMatchesPrefix(file, prefix)),
      )
    ) {
      return true;
    }
    return area.titleKeywords.some((keyword) => normalizedTitle.includes(keyword.toLowerCase()));
  });
}

function deriveRecommendedDecision(input: {
  category: UpstreamSyncCandidateCategory;
  matchedAreas: readonly UpstreamSyncAreaPolicy[];
}): { decision: UpstreamSyncTerminalDecision; reason?: string } {
  if (
    input.matchedAreas.length > 0 &&
    input.matchedAreas.every((area) => area.defaultDecision === "ignore")
  ) {
    const reason = input.matchedAreas.find((area) => area.reason)?.reason;
    return {
      decision: "ignore",
      ...(reason ? { reason } : {}),
    };
  }

  if (input.category === "docs" || input.category === "infra") {
    const reason = input.matchedAreas.find((area) => area.reason)?.reason;
    if (reason) {
      return {
        decision: "ignore",
        reason,
      };
    }
  }

  return {
    decision: "adapt",
    reason: "Apply the upstream intent within Sam's Code architecture instead of copying patches.",
  };
}

async function fetchCompareResponse(
  repo: string,
  previousTag: string,
  nextTag: string,
): Promise<GitHubCompareResponse> {
  return fetchGitHubJson<GitHubCompareResponse>(
    `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(nextTag)}`,
  );
}

async function fetchCommitResponse(repo: string, commitSha: string): Promise<GitHubCommitResponse> {
  return fetchGitHubJson<GitHubCommitResponse>(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(commitSha)}`,
  );
}

function toCandidateIntake(
  commit: GitHubCommitResponse,
  areaPolicies: readonly UpstreamSyncAreaPolicy[],
): UpstreamSyncReleaseCandidateIntake {
  const { title, summary } = parseCommitMessage(commit.commit.message);
  const changedFiles = [...new Set((commit.files ?? []).map((file) => file.filename))].toSorted(
    (a, b) => a.localeCompare(b),
  );
  const matchedAreas = resolveMatchedAreas(areaPolicies, title, changedFiles);
  const recommendation = deriveRecommendedDecision({
    category: inferCategory(title),
    matchedAreas,
  });
  return {
    id: slugifyCandidateId(commit.sha),
    commitSha: commit.sha,
    commitUrl: commit.html_url,
    title,
    summary,
    authoredAt: safeIsoOrNull(commit.commit.author?.date),
    category: inferCategory(title),
    areas: (matchedAreas.length > 0 ? matchedAreas.map((area) => area.label) : ["General"]).toSorted(
      (a, b) => a.localeCompare(b),
    ),
    changedFiles,
    recommendedDecision: recommendation.decision,
    ...(recommendation.reason ? { recommendedReason: recommendation.reason } : {}),
  };
}

async function readReleaseIntake(
  paths: SyncPaths,
  tag: string,
): Promise<UpstreamSyncReleaseIntake | null> {
  return readJsonFile(paths.intakePath(tag), decodeReleaseIntake);
}

async function readReleaseTriage(
  paths: SyncPaths,
  tag: string,
): Promise<UpstreamSyncReleaseTriage | null> {
  return readJsonFile(paths.triagePath(tag), decodeReleaseTriage);
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
    const decision = decisionByCandidateId.get(candidate.id);
    return {
      ...candidate,
      decision: decision?.decision ?? "pending",
      note: decision?.note ?? null,
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

async function writeForkMetadata(
  paths: SyncPaths,
  forkMetadata: UpstreamSyncForkMetadata,
): Promise<void> {
  await writeJsonFile(paths.forkMetadataPath, forkMetadata);
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

async function fetchReleaseReport(input: {
  cwd: string;
  tag: string;
  forceRefresh?: boolean;
}): Promise<UpstreamSyncReleaseReport> {
  const ensured = await ensureSyncConfig(input.cwd);
  const { areaPolicies, paths } = ensured;

  if (!input.forceRefresh) {
    const cachedReport = await loadReleaseReportFromDisk(paths, input.tag);
    if (cachedReport) {
      if (ensured.forkMetadata.tracking.lastFetchedReleaseTag !== input.tag) {
        await writeForkMetadata(paths, {
          ...ensured.forkMetadata,
          tracking: {
            ...ensured.forkMetadata.tracking,
            lastFetchedReleaseTag: input.tag,
          },
        });
      }
      return cachedReport;
    }
  }

  const releases = await listStableReleases(ensured.forkMetadata.upstream.repo);
  const release = findReleaseByTag(releases, input.tag);
  if (!release) {
    throw new Error(`No upstream release found for tag ${input.tag}.`);
  }
  const releaseIndex = releases.findIndex((entry) => entry.tag_name === input.tag);
  const previousTag = releaseIndex > 0 ? (releases[releaseIndex - 1]?.tag_name ?? null) : null;
  if (!previousTag) {
    throw new Error(`Release ${input.tag} has no previous upstream tag to compare against.`);
  }

  const compare = await fetchCompareResponse(
    ensured.forkMetadata.upstream.repo,
    previousTag,
    release.tag_name,
  );
  const commitResponses = await Promise.all(
    compare.commits.map((commit) =>
      fetchCommitResponse(ensured.forkMetadata.upstream.repo, commit.sha),
    ),
  );

  const intake: UpstreamSyncReleaseIntake = {
    schemaVersion: UPSTREAM_SYNC_SCHEMA_VERSION,
    tag: release.tag_name,
    name: release.name?.trim() ? release.name.trim() : null,
    url: release.html_url,
    publishedAt: safeIsoOrNull(release.published_at ?? release.created_at),
    previousTag,
    compareUrl: compare.html_url?.trim() ? compare.html_url.trim() : null,
    fetchedAt: nowIso(),
    releaseNotes: release.body ?? "",
    candidates: commitResponses.map((commit) => toCandidateIntake(commit, areaPolicies.areas)),
  };
  await writeJsonFile(paths.intakePath(release.tag_name), intake);

  const existingTriage =
    (await readReleaseTriage(paths, release.tag_name)) ?? buildEmptyTriage(release.tag_name);
  const validCandidateIds = new Set(intake.candidates.map((candidate) => candidate.id));
  const triage: UpstreamSyncReleaseTriage = {
    ...existingTriage,
    decisions: existingTriage.decisions.filter((decision) =>
      validCandidateIds.has(decision.candidateId),
    ),
    updatedAt: existingTriage.updatedAt,
  };
  await writeReleaseTriage(paths, triage);

  await writeForkMetadata(paths, {
    ...ensured.forkMetadata,
    tracking: {
      ...ensured.forkMetadata.tracking,
      lastFetchedReleaseTag: release.tag_name,
    },
  });

  return mergeReleaseReport(intake, triage);
}

async function buildStatus(input: UpstreamSyncStatusInput): Promise<UpstreamSyncStatus> {
  const ensured = await ensureSyncConfig(input.cwd);
  const releases = await listStableReleases(ensured.forkMetadata.upstream.repo);
  const latestReleaseTag = releases[releases.length - 1]?.tag_name ?? null;
  const nextReleaseTag =
    findNextRelease(releases, ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag)?.tag_name ??
    null;
  const activeReleaseTag =
    ensured.forkMetadata.tracking.lastFetchedReleaseTag &&
    ensured.forkMetadata.tracking.lastFetchedReleaseTag !==
      ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag &&
    (await readReleaseIntake(ensured.paths, ensured.forkMetadata.tracking.lastFetchedReleaseTag))
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

function truncateThreadTitle(input: string, maxLength = 50): string {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildImplementationPrompt(
  report: UpstreamSyncReleaseReport,
): UpstreamSyncImplementationPromptResult {
  const selectedCandidates = report.candidates.filter(
    (candidate) => candidate.decision === "adopt" || candidate.decision === "adapt",
  );
  if (selectedCandidates.length === 0) {
    throw new Error(
      "Select at least one upstream change to adopt or adapt before starting implementation.",
    );
  }

  const skippedCandidates = report.candidates.filter(
    (candidate) => candidate.decision !== "adopt" && candidate.decision !== "adapt",
  );

  const promptSections = [
    `Implement the selected upstream sync items for T3 Code ${report.tag} in Sam's Code.`,
    "",
    "Context:",
    "- Sam's Code is a fork of pingdotgg/t3code.",
    "- Treat upstream commits as behavioral references, not patches to copy verbatim.",
    "- Preserve fork-specific decisions, especially Sam's Code branding and intentional product divergence.",
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
      `   - decision: ${candidate.decision}`,
      `   - commit: ${candidate.commitSha}`,
      `   - url: ${candidate.commitUrl}`,
      `   - category: ${candidate.category}`,
      `   - areas: ${candidate.areas.join(", ")}`,
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
    "Do not implement these skipped items unless you discover they are required as dependencies:",
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

  if (report.releaseNotes.trim().length > 0) {
    promptSections.push("", "Release notes excerpt:", report.releaseNotes.trim().slice(0, 2_000));
  }

  return {
    releaseTag: report.tag,
    threadTitle: truncateThreadTitle(`Adapt T3 ${report.tag} updates`),
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

const makeUpstreamSync = Effect.sync(() => {
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
          const releases = await listStableReleases(ensured.forkMetadata.upstream.repo);
          const nextRelease = findNextRelease(
            releases,
            ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag,
          );
          if (!nextRelease) {
            return null;
          }
          return fetchReleaseReport({
            cwd: input.cwd,
            tag: nextRelease.tag_name,
            ...(input.forceRefresh !== undefined ? { forceRefresh: input.forceRefresh } : {}),
          });
        },
        catch: toUpstreamSyncError,
      }),
    getRelease: (input) =>
      Effect.tryPromise({
        try: () => fetchReleaseReport({ cwd: input.cwd, tag: input.tag }),
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
          const nextForkMetadata: UpstreamSyncForkMetadata = {
            ...ensured.forkMetadata,
            tracking: {
              ...ensured.forkMetadata.tracking,
              lastFetchedReleaseTag: input.tag,
              lastFullyTriagedReleaseTag: report.triagedAt
                ? input.tag
                : ensured.forkMetadata.tracking.lastFullyTriagedReleaseTag,
            },
          };
          await writeForkMetadata(ensured.paths, nextForkMetadata);
          return report;
        },
        catch: toUpstreamSyncError,
      }),
    generateImplementationPrompt: (input) =>
      Effect.tryPromise({
        try: async () => {
          const report = await fetchReleaseReport({ cwd: input.cwd, tag: input.tag });
          return buildImplementationPrompt(report);
        },
        catch: toUpstreamSyncError,
      }),
  };
  return service;
});

export const UpstreamSyncLive = Layer.effect(UpstreamSync, makeUpstreamSync);
