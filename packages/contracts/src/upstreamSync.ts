import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const UPSTREAM_SYNC_SCHEMA_VERSION = 1 as const;

export const UpstreamSyncDecision = Schema.Literals([
  "pending",
  "adopt",
  "adapt",
  "ignore",
  "defer",
  "already-present",
]);
export type UpstreamSyncDecision = typeof UpstreamSyncDecision.Type;

export const UpstreamSyncTerminalDecision = Schema.Literals([
  "adopt",
  "adapt",
  "ignore",
  "defer",
  "already-present",
]);
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
  recommendedDecision: UpstreamSyncTerminalDecision,
  recommendedReason: Schema.optional(TrimmedNonEmptyString),
});
export type UpstreamSyncReleaseCandidateIntake = typeof UpstreamSyncReleaseCandidateIntake.Type;

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
  candidates: Schema.Array(UpstreamSyncReleaseCandidate),
  triagedAt: Schema.NullOr(IsoDateTime),
});
export type UpstreamSyncReleaseReport = typeof UpstreamSyncReleaseReport.Type;

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

export const UpstreamSyncFetchNextReleaseInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  forceRefresh: Schema.optional(Schema.Boolean),
});
export type UpstreamSyncFetchNextReleaseInput = typeof UpstreamSyncFetchNextReleaseInput.Type;

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
