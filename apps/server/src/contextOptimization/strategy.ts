import type { OrchestrationThread, ThreadTokenUsageSnapshot } from "@samscode/contracts";

import type { ContextOptimizationPacketPreview, ContextOptimizationStats } from "./types.ts";

export const CONTEXT_OPTIMIZATION_THRESHOLDS = {
  pressureThreshold: 0.72,
  hardThreshold: 0.82,
  minEstimatedSavingsTokens: 12_000,
  minTurnsBetweenReseeds: 4,
  minMinutesBetweenReseeds: 5,
  hardPacketCharCap: 24_000,
} as const;

export function estimateTokenCount(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function computeEffectiveMaxTokens(
  usage: ThreadTokenUsageSnapshot | null | undefined,
): number | null {
  const maxTokens = usage?.maxTokens;
  return typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
    ? maxTokens
    : null;
}

export function computePressure(usage: ThreadTokenUsageSnapshot | null | undefined): number | null {
  const maxTokens = computeEffectiveMaxTokens(usage);
  const usedTokens = usage?.usedTokens;
  if (
    maxTokens === null ||
    typeof usedTokens !== "number" ||
    !Number.isFinite(usedTokens) ||
    usedTokens < 0
  ) {
    return null;
  }
  return usedTokens / maxTokens;
}

export function shouldTriggerPendingReseed(input: {
  readonly thread: OrchestrationThread;
  readonly stats: ContextOptimizationStats;
  readonly packetPreview: ContextOptimizationPacketPreview;
  readonly now: string;
  readonly pendingUserInputRequestId: string | null;
}): {
  readonly shouldReseed: boolean;
  readonly reason: string | null;
  readonly estimatedTokensRemoved: number;
  readonly pressure: number | null;
} {
  const pressure = computePressure(input.stats.latestTokenUsage);
  const effectiveMaxTokens = computeEffectiveMaxTokens(input.stats.latestTokenUsage);
  const usedTokens = input.stats.latestTokenUsage?.usedTokens ?? 0;
  const estimatedTokensRemoved = Math.max(0, usedTokens - input.packetPreview.estimatedTokens);

  if (!input.thread.session || input.thread.session.activeTurnId !== null) {
    return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
  }
  if (input.pendingUserInputRequestId !== null) {
    return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
  }
  if (effectiveMaxTokens === null || pressure === null) {
    return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
  }
  if (estimatedTokensRemoved < CONTEXT_OPTIMIZATION_THRESHOLDS.minEstimatedSavingsTokens) {
    return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
  }
  if (
    input.packetPreview.charCount <= 0 ||
    input.packetPreview.charCount > CONTEXT_OPTIMIZATION_THRESHOLDS.hardPacketCharCap
  ) {
    return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
  }

  const turnsSinceLastReseed =
    input.stats.completedUserTurns - input.stats.lastReseedCompletedUserTurns;
  if (turnsSinceLastReseed < CONTEXT_OPTIMIZATION_THRESHOLDS.minTurnsBetweenReseeds) {
    return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
  }

  if (input.stats.lastReseededAt !== null) {
    const elapsedMs =
      new Date(input.now).getTime() - new Date(input.stats.lastReseededAt).getTime();
    if (
      Number.isFinite(elapsedMs) &&
      elapsedMs < CONTEXT_OPTIMIZATION_THRESHOLDS.minMinutesBetweenReseeds * 60_000
    ) {
      return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
    }
  }

  if (pressure >= CONTEXT_OPTIMIZATION_THRESHOLDS.hardThreshold) {
    return {
      shouldReseed: true,
      reason: "hard-threshold",
      estimatedTokensRemoved,
      pressure,
    };
  }
  if (pressure >= CONTEXT_OPTIMIZATION_THRESHOLDS.pressureThreshold) {
    return {
      shouldReseed: true,
      reason: "pressure-threshold",
      estimatedTokensRemoved,
      pressure,
    };
  }

  return { shouldReseed: false, reason: null, estimatedTokensRemoved, pressure };
}
