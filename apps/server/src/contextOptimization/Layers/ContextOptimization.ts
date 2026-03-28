import {
  type OrchestrationProject,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type ProviderKind,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
} from "@samscode/contracts";
import { Effect, Layer, Option } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ThreadContextOptimizationRepository } from "../../persistence/Services/ThreadContextOptimization.ts";
import { buildContextOptimizationPacket, buildReseedProviderInput } from "../packetBuilder.ts";
import {
  computeEffectiveMaxTokens,
  computePressure,
  shouldTriggerPendingReseed,
} from "../strategy.ts";
import {
  CONTEXT_OPTIMIZATION_STATE_VERSION,
  type ContextOptimizationDurableMemory,
  type ContextOptimizationToolIndexEntry,
  type ContextOptimizationWorkingSet,
  makeDefaultThreadContextOptimizationState,
  type PendingReseedPayload,
  type ThreadContextOptimizationState,
} from "../types.ts";
import {
  ContextOptimizationService,
  type ContextOptimizationShape,
} from "../Services/ContextOptimization.ts";

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined && entry !== null)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }
  return value;
}

function summarizeCheckpoint(thread: OrchestrationThread): string | null {
  const checkpoint = thread.checkpoints.toSorted((left, right) =>
    left.completedAt.localeCompare(right.completedAt),
  )[thread.checkpoints.length - 1];
  if (!checkpoint) {
    return null;
  }
  const fileSummary =
    checkpoint.files.length > 0
      ? checkpoint.files
          .slice(0, 5)
          .map((file) => `${file.path} (+${file.additions}/-${file.deletions})`)
          .join(", ")
      : "no file details";
  return `Checkpoint ${checkpoint.checkpointTurnCount} (${checkpoint.status}): ${fileSummary}`;
}

function extractConstraintLines(messages: ReadonlyArray<{ text: string }>): string[] {
  const lines = messages
    .flatMap((message) => message.text.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        /(^[-*]\s+)|\b(must|should|never|do not|don't|keep|prefer|always)\b/i.test(line),
    );
  return Array.from(new Set(lines)).slice(0, 8);
}

function runtimeActivityToIssue(activity: OrchestrationThreadActivity): string | null {
  if (activity.tone === "error") {
    return activity.summary;
  }
  if (activity.kind === "runtime.warning" || activity.kind === "user-input.requested") {
    return activity.summary;
  }
  return null;
}

function extractPathTargets(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const values = Object.values(payload as Record<string, unknown>);
  const paths = values.filter(
    (value): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      (value.includes("/") || value.includes("\\") || /\.[a-z0-9]+$/i.test(value)),
  );
  return Array.from(new Set(paths)).slice(0, 6);
}

function buildToolIndex(thread: OrchestrationThread): ContextOptimizationToolIndexEntry[] {
  const toolActivities = thread.activities.filter((activity) => activity.tone === "tool");
  const byKey = new Map<string, ContextOptimizationToolIndexEntry>();
  for (const activity of toolActivities) {
    const payloadRecord =
      activity.payload && typeof activity.payload === "object" && !Array.isArray(activity.payload)
        ? (activity.payload as Record<string, unknown>)
        : {};
    const itemType =
      typeof payloadRecord.itemType === "string" ? payloadRecord.itemType : "unknown";
    const toolName = activity.summary.trim() || activity.kind;
    const inputSignature = JSON.stringify(normalizeJson(payloadRecord.data ?? payloadRecord));
    const key = `${itemType}:${toolName}:${inputSignature}`;
    const nextEntry: ContextOptimizationToolIndexEntry = {
      key,
      itemType,
      toolName,
      inputSignature,
      pathTargets: extractPathTargets(activity.payload),
      resultClass:
        typeof payloadRecord.status === "string"
          ? payloadRecord.status
          : activity.kind.endsWith(".completed")
            ? "completed"
            : activity.kind.endsWith(".started")
              ? "started"
              : null,
      firstSeenTurn: activity.turnId,
      lastSeenTurn: activity.turnId,
      latestDetail:
        typeof payloadRecord.detail === "string"
          ? truncate(payloadRecord.detail, 240)
          : truncate(toolName, 240),
      hasError: typeof payloadRecord.status === "string" && payloadRecord.status === "failed",
      superseded: false,
      protected: activity.turnId === thread.latestTurn?.turnId,
      runtimeItemId:
        typeof payloadRecord.itemId === "string"
          ? RuntimeItemId.makeUnsafe(payloadRecord.itemId)
          : null,
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, nextEntry);
      continue;
    }
    byKey.set(key, {
      ...existing,
      lastSeenTurn: nextEntry.lastSeenTurn ?? existing.lastSeenTurn,
      latestDetail: nextEntry.latestDetail ?? existing.latestDetail,
      hasError: nextEntry.hasError,
      protected: existing.protected || nextEntry.protected,
    });
  }
  return [...byKey.values()].slice(-24);
}

function buildDurableMemory(input: {
  readonly thread: OrchestrationThread;
  readonly project: OrchestrationProject | null;
  readonly provider: ProviderKind | null;
  readonly toolIndex: ReadonlyArray<ContextOptimizationToolIndexEntry>;
}): ContextOptimizationDurableMemory {
  const userMessages = input.thread.messages.filter((message) => message.role === "user");
  const latestUserMessage = userMessages[userMessages.length - 1];
  const latestPlan = input.thread.proposedPlans.toSorted((left, right) =>
    left.updatedAt.localeCompare(right.updatedAt),
  )[input.thread.proposedPlans.length - 1];
  const recentChanges = input.thread.checkpoints
    .toSorted((left, right) => left.completedAt.localeCompare(right.completedAt))
    .slice(-3)
    .map((checkpoint) => {
      const fileCount = checkpoint.files.length;
      return `Checkpoint ${checkpoint.checkpointTurnCount}: ${fileCount} changed ${fileCount === 1 ? "file" : "files"}`;
    });
  const unresolvedFailures = input.thread.activities
    .filter((activity) => activity.tone === "error")
    .slice(-5)
    .map((activity) => activity.summary);
  const findings = input.toolIndex
    .filter((entry) => entry.latestDetail !== null)
    .slice(-6)
    .map((entry) => `${entry.toolName}: ${entry.latestDetail}`);
  return {
    threadTitle: input.thread.title,
    workspaceRoot: input.project?.workspaceRoot ?? null,
    branch: input.thread.branch,
    worktreePath: input.thread.worktreePath,
    provider: input.provider,
    model: input.thread.model,
    interactionMode: input.thread.interactionMode,
    currentObjective: latestUserMessage ? truncate(latestUserMessage.text, 800) : null,
    constraints: extractConstraintLines(userMessages.slice(-5)),
    acceptedPlan: latestPlan ? truncate(latestPlan.planMarkdown, 1_600) : null,
    recentChanges,
    unresolvedFailures,
    findings,
  };
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const repository = yield* ThreadContextOptimizationRepository;

  const resolveThreadContext = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId) ?? null;
    if (!thread) {
      return null;
    }
    const project = readModel.projects.find((entry) => entry.id === thread.projectId) ?? null;
    return { thread, project } as const;
  });

  const loadState = Effect.fnUntraced(function* (threadId: ThreadId) {
    const existing = yield* repository.getByThreadId({ threadId }).pipe(Effect.orDie);
    return Option.getOrElse(existing, () => makeDefaultThreadContextOptimizationState(threadId));
  });

  const saveState = (state: ThreadContextOptimizationState) =>
    repository.upsert(state).pipe(Effect.orDie);

  const rebuildDerivedState = Effect.fnUntraced(function* (
    threadId: ThreadId,
    state: ThreadContextOptimizationState,
  ) {
    const context = yield* resolveThreadContext(threadId);
    if (!context) {
      return null;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({ threadId }).pipe(Effect.orDie);
    const recentTurns = turns
      .filter((turn) => turn.turnId !== null && turn.pendingMessageId !== null)
      .toSorted((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      .slice(-3)
      .map((turn) => {
        const userMessage = context.thread.messages.find(
          (message) => message.id === turn.pendingMessageId,
        );
        const assistantMessage =
          turn.assistantMessageId === null
            ? undefined
            : context.thread.messages.find((message) => message.id === turn.assistantMessageId);
        return {
          turnId: turn.turnId,
          userMessageId: turn.pendingMessageId,
          assistantMessageId: turn.assistantMessageId,
          userText: userMessage?.text ?? "",
          assistantText: assistantMessage?.text ?? null,
          createdAt: turn.requestedAt,
        };
      });

    const latestUserInputActivity = [...context.thread.activities]
      .filter(
        (activity) =>
          activity.kind === "user-input.requested" || activity.kind === "user-input.resolved",
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1);
    const pendingUserInputRequestId =
      latestUserInputActivity?.kind === "user-input.requested" &&
      latestUserInputActivity.payload &&
      typeof latestUserInputActivity.payload === "object" &&
      !Array.isArray(latestUserInputActivity.payload) &&
      typeof (latestUserInputActivity.payload as Record<string, unknown>).requestId === "string"
        ? RuntimeRequestId.makeUnsafe(
            (latestUserInputActivity.payload as Record<string, unknown>).requestId as string,
          )
        : null;

    const unresolvedIssues = context.thread.activities
      .map(runtimeActivityToIssue)
      .filter((issue): issue is string => typeof issue === "string")
      .slice(-8);
    const toolIndex = buildToolIndex(context.thread);
    const provider =
      context.thread.session?.providerName === "codex" ||
      context.thread.session?.providerName === "claudeAgent"
        ? context.thread.session.providerName
        : null;
    const durableMemory = buildDurableMemory({
      thread: context.thread,
      project: context.project,
      provider,
      toolIndex,
    });
    const workingSet: ContextOptimizationWorkingSet = {
      recentTurns,
      activePlan: durableMemory.acceptedPlan,
      latestCheckpointSummary: summarizeCheckpoint(context.thread),
      unresolvedIssues,
      pendingUserInputRequestId,
    };
    const completedUserTurns = context.thread.messages.filter(
      (message) => message.role === "user",
    ).length;

    const nextState: ThreadContextOptimizationState = {
      ...state,
      stats: {
        ...state.stats,
        completedUserTurns,
      },
      workingSet,
      toolIndex,
      durableMemory,
      stateVersion: CONTEXT_OPTIMIZATION_STATE_VERSION,
    };
    return { context, state: nextState } as const;
  });

  const maybeEvaluateThread = Effect.fnUntraced(function* (threadId: ThreadId, createdAt: string) {
    const current = yield* loadState(threadId);
    const derived = yield* rebuildDerivedState(threadId, current);
    if (!derived) {
      return;
    }

    const packetPreview = buildContextOptimizationPacket({
      project: derived.context.project,
      thread: derived.context.thread,
      segmentIndex: derived.state.segmentIndex,
      workingSet: derived.state.workingSet,
      durableMemory: derived.state.durableMemory,
      toolIndex: derived.state.toolIndex,
    });
    const pressure = computePressure(derived.state.stats.latestTokenUsage);
    const nextStateBase: ThreadContextOptimizationState = {
      ...derived.state,
      packetPreview,
      lastEvaluatedAt: createdAt,
      stats: {
        ...derived.state.stats,
        effectiveMaxTokens: computeEffectiveMaxTokens(derived.state.stats.latestTokenUsage),
        latestPressure: pressure,
        lastEvaluatedAt: createdAt,
      },
    };

    if (!nextStateBase.enabled) {
      yield* saveState({
        ...nextStateBase,
        status: nextStateBase.status === "reseed_in_flight" ? "reseed_in_flight" : "idle",
        pendingReseed: null,
      });
      return;
    }
    if (nextStateBase.pendingReseed !== null || nextStateBase.status === "reseed_in_flight") {
      yield* saveState(nextStateBase);
      return;
    }

    const decision = shouldTriggerPendingReseed({
      thread: derived.context.thread,
      stats: nextStateBase.stats,
      packetPreview,
      now: createdAt,
      pendingUserInputRequestId: nextStateBase.workingSet.pendingUserInputRequestId,
    });
    if (!decision.shouldReseed || decision.reason === null || decision.pressure === null) {
      yield* saveState({ ...nextStateBase, status: "idle" });
      return;
    }

    const pendingReseed: PendingReseedPayload = {
      createdAt,
      reason: decision.reason,
      pressure: decision.pressure,
      estimatedTokensRemoved: decision.estimatedTokensRemoved,
      packetPreview,
    };

    yield* saveState({
      ...nextStateBase,
      status: "pending_reseed",
      pendingReseed,
      lastError: null,
    });
  });

  const recordTurnStartRequested: ContextOptimizationShape["recordTurnStartRequested"] = (event) =>
    Effect.gen(function* () {
      const current = yield* loadState(event.payload.threadId);
      const enabled = event.payload.contextOptimizationEnabled ?? false;
      yield* saveState({
        ...current,
        enabled,
        status: enabled
          ? current.status === "pending_reseed" || current.status === "reseed_in_flight"
            ? current.status
            : "idle"
          : "idle",
        pendingReseed: enabled ? current.pendingReseed : null,
        lastError: null,
      });
    });

  const recordRuntimeEvent: ContextOptimizationShape["recordRuntimeEvent"] = (event) =>
    Effect.gen(function* () {
      const current = yield* loadState(event.threadId);
      let nextState = current;
      if (event.type === "thread.token-usage.updated") {
        const pressure = computePressure(event.payload.usage);
        nextState = {
          ...current,
          stats: {
            ...current.stats,
            latestTokenUsage: event.payload.usage,
            effectiveMaxTokens: computeEffectiveMaxTokens(event.payload.usage),
            latestPressure: pressure,
          },
        };
      } else if (event.type === "thread.state.changed" && event.payload.state === "compacted") {
        nextState = {
          ...current,
          stats: {
            ...current.stats,
            lastCompactionAt: event.createdAt,
          },
        };
      }
      yield* saveState(nextState);

      if (
        event.type === "thread.token-usage.updated" ||
        (event.type === "thread.state.changed" && event.payload.state === "compacted")
      ) {
        yield* maybeEvaluateThread(event.threadId, event.createdAt);
      }
    });

  const recordTurnCompleted: ContextOptimizationShape["recordTurnCompleted"] = (input) =>
    maybeEvaluateThread(input.threadId, input.createdAt);

  const getPendingReseed: ContextOptimizationShape["getPendingReseed"] = (threadId) =>
    loadState(threadId).pipe(
      Effect.map((state) =>
        state.enabled && state.pendingReseed !== null
          ? Option.some(state.pendingReseed)
          : Option.none(),
      ),
    );

  const buildReseedProviderInputForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    userMessageText: string,
  ) {
    const state = yield* loadState(threadId);
    if (!state.enabled || state.pendingReseed === null) {
      return yield* Effect.fail(new Error(`Thread '${threadId}' does not have a pending reseed.`));
    }
    const derived = yield* rebuildDerivedState(threadId, state);
    if (!derived) {
      return yield* Effect.fail(new Error(`Thread '${threadId}' was not found.`));
    }
    const packetPreview = buildContextOptimizationPacket({
      project: derived.context.project,
      thread: derived.context.thread,
      segmentIndex: derived.state.segmentIndex,
      workingSet: derived.state.workingSet,
      durableMemory: derived.state.durableMemory,
      toolIndex: derived.state.toolIndex,
    });
    return {
      providerInputText: buildReseedProviderInput(packetPreview.text, userMessageText),
      packetPreview,
      pendingReseed: state.pendingReseed,
    };
  });

  const buildReseedProviderInputApi: ContextOptimizationShape["buildReseedProviderInput"] = (
    input,
  ) => buildReseedProviderInputForThread(input.threadId, input.userMessageText);

  const cancelPendingReseed: ContextOptimizationShape["cancelPendingReseed"] = (input) =>
    loadState(input.threadId).pipe(
      Effect.flatMap((state) =>
        saveState({
          ...state,
          status: "idle",
          pendingReseed: null,
          lastError: null,
        }),
      ),
    );

  const markReseedStarted: ContextOptimizationShape["markReseedStarted"] = (threadId) =>
    loadState(threadId).pipe(
      Effect.flatMap((state) =>
        saveState({
          ...state,
          status: state.pendingReseed === null ? state.status : "reseed_in_flight",
          lastError: null,
        }),
      ),
    );

  const markReseedSucceeded: ContextOptimizationShape["markReseedSucceeded"] = (input) =>
    Effect.gen(function* () {
      const current = yield* loadState(input.threadId);
      const nextState: ThreadContextOptimizationState = {
        ...current,
        segmentIndex: current.segmentIndex + 1,
        status: "idle",
        pendingReseed: null,
        packetPreview: input.packetPreview,
        lastReseededAt: input.createdAt,
        lastError: null,
        stats: {
          ...current.stats,
          lastReseededAt: input.createdAt,
          lastReseedCompletedUserTurns: current.stats.completedUserTurns,
        },
      };
      yield* saveState(nextState);
      return nextState;
    });

  const markReseedFailed: ContextOptimizationShape["markReseedFailed"] = (input) =>
    loadState(input.threadId).pipe(
      Effect.flatMap((state) =>
        saveState({
          ...state,
          status: state.pendingReseed === null ? "error" : "pending_reseed",
          lastError: input.error,
        }),
      ),
    );

  return {
    recordTurnStartRequested,
    recordRuntimeEvent,
    recordTurnCompleted,
    getPendingReseed,
    buildReseedProviderInput: buildReseedProviderInputApi,
    cancelPendingReseed,
    markReseedStarted,
    markReseedSucceeded,
    markReseedFailed,
  } satisfies ContextOptimizationShape;
});

export const ContextOptimizationLive = Layer.effect(ContextOptimizationService, make);
