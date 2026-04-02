import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { CodexModelOptions } from "./model";
import { ProviderStartOptions } from "./orchestration";

export const UPSTREAM_SYNC_SCHEMA_VERSION = 2 as const;

export const UpstreamSyncDecision = Schema.Literals([
  "pending",
  "apply",
  "ignore",
  "already-present",
]);
export type UpstreamSyncDecision = typeof UpstreamSyncDecision.Type;

export const UpstreamSyncTerminalDecision = Schema.Literals(["apply", "ignore", "already-present"]);
export type UpstreamSyncTerminalDecision = typeof UpstreamSyncTerminalDecision.Type;

export const UpstreamSyncCandidateCategory = Schema.Literals([
  "feature",
  "fix",
  "refactor",
  "infra",
  "docs",
  "maintenance",
]);
export type UpstreamSyncCandidateCategory = typeof UpstreamSyncCandidateCategory.Type;

export const UpstreamSyncReleaseChannel = Schema.Literals(["stable"]);
export type UpstreamSyncReleaseChannel = typeof UpstreamSyncReleaseChannel.Type;

export const UpstreamSyncImplementationMode = Schema.Literals(["logic-first"]);
export type UpstreamSyncImplementationMode = typeof UpstreamSyncImplementationMode.Type;

export const UpstreamSyncAreaPolicy = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  pathPrefixes: Schema.Array(TrimmedNonEmptyString),
  titleKeywords: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  defaultDecision: UpstreamSyncTerminalDecision,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type UpstreamSyncAreaPolicy = typeof UpstreamSyncAreaPolicy.Type;

export const UpstreamSyncAreaPolicyFile = Schema.Struct({
  schemaVersion: Schema.Literal(UPSTREAM_SYNC_SCHEMA_VERSION),
  areas: Schema.Array(UpstreamSyncAreaPolicy),
});
export type UpstreamSyncAreaPolicyFile = typeof UpstreamSyncAreaPolicyFile.Type;

export const UpstreamSyncForkMetadata = Schema.Struct({
  schemaVersion: Schema.Literal(UPSTREAM_SYNC_SCHEMA_VERSION),
  upstream: Schema.Struct({
    repo: TrimmedNonEmptyString,
    defaultBranch: TrimmedNonEmptyString,
    releaseChannel: UpstreamSyncReleaseChannel,
  }),
  forkOrigin: Schema.Struct({
    baseReleaseTag: TrimmedNonEmptyString,
    baseCommitSha: TrimmedNonEmptyString,
    confidence: TrimmedNonEmptyString,
    evidence: TrimmedNonEmptyString,
  }),
  tracking: Schema.Struct({
    lastFullyTriagedReleaseTag: TrimmedNonEmptyString,
    lastFetchedReleaseTag: Schema.NullOr(TrimmedNonEmptyString),
  }),
  defaults: Schema.Struct({
    implementationMode: UpstreamSyncImplementationMode,
  }),
});
export type UpstreamSyncForkMetadata = typeof UpstreamSyncForkMetadata.Type;

export const UpstreamSyncReleaseCandidateIntake = Schema.Struct({
  id: TrimmedNonEmptyString,
  commitSha: TrimmedNonEmptyString,
  commitUrl: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: Schema.String,
  authoredAt: Schema.NullOr(IsoDateTime),
  category: UpstreamSyncCandidateCategory,
  areas: Schema.Array(TrimmedNonEmptyString),
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  changeSummary: Schema.String,
  forkValueSummary: Schema.String,
  recommendedDecision: UpstreamSyncTerminalDecision,
  recommendedReason: Schema.optional(TrimmedNonEmptyString),
});
export type UpstreamSyncReleaseCandidateIntake = typeof UpstreamSyncReleaseCandidateIntake.Type;

export const UpstreamSyncAnalysisRun = Schema.Struct({
  source: Schema.Literal("model"),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.optional(CodexModelOptions),
  startedAt: IsoDateTime,
  completedAt: IsoDateTime,
  durationMs: Schema.Number,
  modeledCandidateCount: Schema.Number,
  heuristicCandidateCount: Schema.Number,
  notes: Schema.Array(TrimmedNonEmptyString),
});
export type UpstreamSyncAnalysisRun = typeof UpstreamSyncAnalysisRun.Type;

export const UpstreamSyncReleaseIntake = Schema.Struct({
  schemaVersion: Schema.Literal(UPSTREAM_SYNC_SCHEMA_VERSION),
  tag: TrimmedNonEmptyString,
  name: Schema.NullOr(TrimmedNonEmptyString),
  url: TrimmedNonEmptyString,
  publishedAt: Schema.NullOr(IsoDateTime),
  previousTag: Schema.NullOr(TrimmedNonEmptyString),
  compareUrl: Schema.NullOr(TrimmedNonEmptyString),
  fetchedAt: IsoDateTime,
  releaseNotes: Schema.String,
  analysis: UpstreamSyncAnalysisRun,
  candidates: Schema.Array(UpstreamSyncReleaseCandidateIntake),
});
export type UpstreamSyncReleaseIntake = typeof UpstreamSyncReleaseIntake.Type;

export const UpstreamSyncReleaseCandidateDecision = Schema.Struct({
  candidateId: TrimmedNonEmptyString,
  decision: UpstreamSyncDecision,
  note: Schema.NullOr(Schema.String),
});
export type UpstreamSyncReleaseCandidateDecision = typeof UpstreamSyncReleaseCandidateDecision.Type;

export const UpstreamSyncReleaseTriage = Schema.Struct({
  schemaVersion: Schema.Literal(UPSTREAM_SYNC_SCHEMA_VERSION),
  tag: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
  decisions: Schema.Array(UpstreamSyncReleaseCandidateDecision),
});
export type UpstreamSyncReleaseTriage = typeof UpstreamSyncReleaseTriage.Type;

export const UpstreamSyncReleaseCandidate = Schema.Struct({
  id: TrimmedNonEmptyString,
  commitSha: TrimmedNonEmptyString,
  commitUrl: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: Schema.String,
  authoredAt: Schema.NullOr(IsoDateTime),
  category: UpstreamSyncCandidateCategory,
  areas: Schema.Array(TrimmedNonEmptyString),
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  changeSummary: Schema.String,
  forkValueSummary: Schema.String,
  recommendedDecision: UpstreamSyncTerminalDecision,
  recommendedReason: Schema.optional(TrimmedNonEmptyString),
  decision: UpstreamSyncDecision,
  note: Schema.NullOr(Schema.String),
});
export type UpstreamSyncReleaseCandidate = typeof UpstreamSyncReleaseCandidate.Type;

export const UpstreamSyncReleaseReport = Schema.Struct({
  tag: TrimmedNonEmptyString,
  name: Schema.NullOr(TrimmedNonEmptyString),
  url: TrimmedNonEmptyString,
  publishedAt: Schema.NullOr(IsoDateTime),
  previousTag: Schema.NullOr(TrimmedNonEmptyString),
  compareUrl: Schema.NullOr(TrimmedNonEmptyString),
  fetchedAt: IsoDateTime,
  releaseNotes: Schema.String,
  analysis: UpstreamSyncAnalysisRun,
  candidates: Schema.Array(UpstreamSyncReleaseCandidate),
  triagedAt: Schema.NullOr(IsoDateTime),
});
export type UpstreamSyncReleaseReport = typeof UpstreamSyncReleaseReport.Type;

export const UpstreamSyncReviewPhase = Schema.Literals([
  "idle",
  "fetching-upstream",
  "building-candidates",
  "analyzing",
  "persisting",
  "completed",
  "failed",
]);
export type UpstreamSyncReviewPhase = typeof UpstreamSyncReviewPhase.Type;

export const UpstreamSyncReviewStatus = Schema.Literals(["idle", "running", "completed", "failed"]);
export type UpstreamSyncReviewStatus = typeof UpstreamSyncReviewStatus.Type;

export const UpstreamSyncActiveCandidate = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  index: NonNegativeInt,
  lastProviderProgress: Schema.NullOr(Schema.String),
});
export type UpstreamSyncActiveCandidate = typeof UpstreamSyncActiveCandidate.Type;

export const UpstreamSyncReviewState = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  status: UpstreamSyncReviewStatus,
  phase: UpstreamSyncReviewPhase,
  releaseTag: Schema.NullOr(TrimmedNonEmptyString),
  previousTag: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  candidateCount: Schema.NullOr(Schema.Number),
  completedCandidateCount: Schema.Number,
  maxConcurrency: Schema.NullOr(PositiveInt.check(Schema.isLessThanOrEqualTo(8))),
  runningCandidateCount: NonNegativeInt,
  queuedCandidateCount: Schema.NullOr(NonNegativeInt),
  activeCandidates: Schema.Array(UpstreamSyncActiveCandidate),
  currentCandidateId: Schema.NullOr(TrimmedNonEmptyString),
  currentCandidateTitle: Schema.NullOr(Schema.String),
  currentCandidateIndex: Schema.NullOr(Schema.Number),
  lastProviderProgress: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type UpstreamSyncReviewState = typeof UpstreamSyncReviewState.Type;

export const UpstreamSyncStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type UpstreamSyncStatusInput = typeof UpstreamSyncStatusInput.Type;

export const UpstreamSyncStatus = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  metadataPath: TrimmedNonEmptyString,
  areasPath: TrimmedNonEmptyString,
  upstreamRepo: TrimmedNonEmptyString,
  baseReleaseTag: TrimmedNonEmptyString,
  lastFullyTriagedReleaseTag: TrimmedNonEmptyString,
  lastFetchedReleaseTag: Schema.NullOr(TrimmedNonEmptyString),
  activeReleaseTag: Schema.NullOr(TrimmedNonEmptyString),
  latestReleaseTag: Schema.NullOr(TrimmedNonEmptyString),
  nextReleaseTag: Schema.NullOr(TrimmedNonEmptyString),
});
export type UpstreamSyncStatus = typeof UpstreamSyncStatus.Type;

export const UpstreamSyncGetReviewStateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type UpstreamSyncGetReviewStateInput = typeof UpstreamSyncGetReviewStateInput.Type;

export const UpstreamSyncStartNextReleaseReviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  forceRefresh: Schema.optional(Schema.Boolean),
  analysisModel: Schema.optional(TrimmedNonEmptyString),
  analysisConcurrency: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(8))),
  analysisModelOptions: Schema.optional(CodexModelOptions),
  analysisProviderOptions: Schema.optional(ProviderStartOptions),
});
export type UpstreamSyncStartNextReleaseReviewInput =
  typeof UpstreamSyncStartNextReleaseReviewInput.Type;

export const UpstreamSyncGetReleaseInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  tag: TrimmedNonEmptyString,
});
export type UpstreamSyncGetReleaseInput = typeof UpstreamSyncGetReleaseInput.Type;

export const UpstreamSyncUpdateCandidateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  tag: TrimmedNonEmptyString,
  candidateId: TrimmedNonEmptyString,
  decision: UpstreamSyncDecision,
  note: Schema.optional(Schema.NullOr(Schema.String)),
});
export type UpstreamSyncUpdateCandidateInput = typeof UpstreamSyncUpdateCandidateInput.Type;

export const UpstreamSyncGenerateImplementationPromptInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  tag: TrimmedNonEmptyString,
});
export type UpstreamSyncGenerateImplementationPromptInput =
  typeof UpstreamSyncGenerateImplementationPromptInput.Type;

export const UpstreamSyncImplementationPromptResult = Schema.Struct({
  releaseTag: TrimmedNonEmptyString,
  threadTitle: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  selectedCandidateIds: Schema.Array(TrimmedNonEmptyString),
  skippedCandidateIds: Schema.Array(TrimmedNonEmptyString),
});
export type UpstreamSyncImplementationPromptResult =
  typeof UpstreamSyncImplementationPromptResult.Type;
