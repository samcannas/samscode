import {
  type UpstreamSyncGenerateImplementationPromptInput,
  type UpstreamSyncGetReviewStateInput,
  type UpstreamSyncGetReleaseInput,
  type UpstreamSyncImplementationPromptResult,
  type UpstreamSyncReleaseReport,
  type UpstreamSyncReviewState,
  type UpstreamSyncStartNextReleaseReviewInput,
  type UpstreamSyncStatus,
  type UpstreamSyncStatusInput,
  type UpstreamSyncUpdateCandidateInput,
} from "@samscode/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export class UpstreamSyncError extends Schema.TaggedErrorClass<UpstreamSyncError>()(
  "UpstreamSyncError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface UpstreamSyncShape {
  readonly getStatus: (
    input: UpstreamSyncStatusInput,
  ) => Effect.Effect<UpstreamSyncStatus, UpstreamSyncError>;
  readonly startNextReleaseReview: (
    input: UpstreamSyncStartNextReleaseReviewInput,
  ) => Effect.Effect<UpstreamSyncReviewState, UpstreamSyncError>;
  readonly getReviewState: (
    input: UpstreamSyncGetReviewStateInput,
  ) => Effect.Effect<UpstreamSyncReviewState, UpstreamSyncError>;
  readonly getRelease: (
    input: UpstreamSyncGetReleaseInput,
  ) => Effect.Effect<UpstreamSyncReleaseReport, UpstreamSyncError>;
  readonly updateCandidate: (
    input: UpstreamSyncUpdateCandidateInput,
  ) => Effect.Effect<UpstreamSyncReleaseReport, UpstreamSyncError>;
  readonly generateImplementationPrompt: (
    input: UpstreamSyncGenerateImplementationPromptInput,
  ) => Effect.Effect<UpstreamSyncImplementationPromptResult, UpstreamSyncError>;
  readonly streamReviewStates: Stream.Stream<UpstreamSyncReviewState>;
}

export class UpstreamSync extends ServiceMap.Service<UpstreamSync, UpstreamSyncShape>()(
  "@samscode/server/upstreamSync/Services/UpstreamSync",
) {}
