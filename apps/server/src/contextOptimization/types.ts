import {
  IsoDateTime,
  ProviderKind,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@samscode/contracts";
import { Schema } from "effect";

export const CONTEXT_OPTIMIZATION_STATE_VERSION = 1 as const;
export const ContextOptimizationStatus = Schema.Literals([
  "idle",
  "pending_reseed",
  "reseed_in_flight",
  "error",
]);
export type ContextOptimizationStatus = typeof ContextOptimizationStatus.Type;

export const ContextOptimizationRecentTurn = Schema.Struct({
  turnId: Schema.NullOr(TurnId),
  userMessageId: Schema.NullOr(Schema.String),
  assistantMessageId: Schema.NullOr(Schema.String),
  userText: Schema.String,
  assistantText: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});
export type ContextOptimizationRecentTurn = typeof ContextOptimizationRecentTurn.Type;

export const ContextOptimizationWorkingSet = Schema.Struct({
  recentTurns: Schema.Array(ContextOptimizationRecentTurn),
  activePlan: Schema.NullOr(Schema.String),
  latestCheckpointSummary: Schema.NullOr(Schema.String),
  unresolvedIssues: Schema.Array(Schema.String),
  pendingUserInputRequestId: Schema.NullOr(RuntimeRequestId),
});
export type ContextOptimizationWorkingSet = typeof ContextOptimizationWorkingSet.Type;

export const ContextOptimizationToolIndexEntry = Schema.Struct({
  key: Schema.String,
  itemType: Schema.String,
  toolName: Schema.String,
  inputSignature: Schema.NullOr(Schema.String),
  pathTargets: Schema.Array(Schema.String),
  resultClass: Schema.NullOr(Schema.String),
  firstSeenTurn: Schema.NullOr(TurnId),
  lastSeenTurn: Schema.NullOr(TurnId),
  latestDetail: Schema.NullOr(Schema.String),
  hasError: Schema.Boolean,
  superseded: Schema.Boolean,
  protected: Schema.Boolean,
  runtimeItemId: Schema.NullOr(RuntimeItemId),
});
export type ContextOptimizationToolIndexEntry = typeof ContextOptimizationToolIndexEntry.Type;

export const ContextOptimizationDurableMemory = Schema.Struct({
  threadTitle: Schema.String,
  workspaceRoot: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(Schema.String),
  interactionMode: Schema.NullOr(Schema.String),
  currentObjective: Schema.NullOr(Schema.String),
  constraints: Schema.Array(Schema.String),
  acceptedPlan: Schema.NullOr(Schema.String),
  recentChanges: Schema.Array(Schema.String),
  unresolvedFailures: Schema.Array(Schema.String),
  findings: Schema.Array(Schema.String),
});
export type ContextOptimizationDurableMemory = typeof ContextOptimizationDurableMemory.Type;

export const ContextOptimizationPacketPreview = Schema.Struct({
  text: Schema.String,
  charCount: Schema.Number,
  estimatedTokens: Schema.Number,
});
export type ContextOptimizationPacketPreview = typeof ContextOptimizationPacketPreview.Type;

export const PendingReseedPayload = Schema.Struct({
  createdAt: IsoDateTime,
  reason: Schema.String,
  pressure: Schema.Number,
  estimatedTokensRemoved: Schema.Number,
  packetPreview: ContextOptimizationPacketPreview,
});
export type PendingReseedPayload = typeof PendingReseedPayload.Type;

export const ContextOptimizationStats = Schema.Struct({
  latestTokenUsage: Schema.NullOr(ThreadTokenUsageSnapshot),
  effectiveMaxTokens: Schema.NullOr(Schema.Number),
  latestPressure: Schema.NullOr(Schema.Number),
  completedUserTurns: Schema.Number,
  lastReseedCompletedUserTurns: Schema.Number,
  lastEvaluatedAt: Schema.NullOr(IsoDateTime),
  lastReseededAt: Schema.NullOr(IsoDateTime),
  lastCompactionAt: Schema.NullOr(IsoDateTime),
});
export type ContextOptimizationStats = typeof ContextOptimizationStats.Type;

export const ThreadContextOptimizationState = Schema.Struct({
  threadId: ThreadId,
  enabled: Schema.Boolean,
  stateVersion: Schema.Number,
  segmentIndex: Schema.Number,
  status: ContextOptimizationStatus,
  lastEvaluatedAt: Schema.NullOr(IsoDateTime),
  lastReseededAt: Schema.NullOr(IsoDateTime),
  pendingReseed: Schema.NullOr(PendingReseedPayload),
  packetPreview: Schema.NullOr(ContextOptimizationPacketPreview),
  stats: ContextOptimizationStats,
  workingSet: ContextOptimizationWorkingSet,
  toolIndex: Schema.Array(ContextOptimizationToolIndexEntry),
  durableMemory: ContextOptimizationDurableMemory,
  lastError: Schema.NullOr(Schema.String),
});
export type ThreadContextOptimizationState = typeof ThreadContextOptimizationState.Type;

export function makeDefaultThreadContextOptimizationState(
  threadId: ThreadId,
): ThreadContextOptimizationState {
  return {
    threadId,
    enabled: false,
    stateVersion: CONTEXT_OPTIMIZATION_STATE_VERSION,
    segmentIndex: 0,
    status: "idle",
    lastEvaluatedAt: null,
    lastReseededAt: null,
    pendingReseed: null,
    packetPreview: null,
    stats: {
      latestTokenUsage: null,
      effectiveMaxTokens: null,
      latestPressure: null,
      completedUserTurns: 0,
      lastReseedCompletedUserTurns: 0,
      lastEvaluatedAt: null,
      lastReseededAt: null,
      lastCompactionAt: null,
    },
    workingSet: {
      recentTurns: [],
      activePlan: null,
      latestCheckpointSummary: null,
      unresolvedIssues: [],
      pendingUserInputRequestId: null,
    },
    toolIndex: [],
    durableMemory: {
      threadTitle: "",
      workspaceRoot: null,
      branch: null,
      worktreePath: null,
      provider: null,
      model: null,
      interactionMode: null,
      currentObjective: null,
      constraints: [],
      acceptedPlan: null,
      recentChanges: [],
      unresolvedFailures: [],
      findings: [],
    },
    lastError: null,
  };
}
