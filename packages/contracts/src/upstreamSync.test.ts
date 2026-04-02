import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  UpstreamSyncActiveCandidate,
  UpstreamSyncDecision,
  UpstreamSyncReviewState,
  UpstreamSyncStartNextReleaseReviewInput,
} from "./upstreamSync";

const decodeDecision = Schema.decodeUnknownEffect(UpstreamSyncDecision);
const decodeActiveCandidate = Schema.decodeUnknownEffect(UpstreamSyncActiveCandidate);
const decodeReviewState = Schema.decodeUnknownEffect(UpstreamSyncReviewState);
const decodeStartInput = Schema.decodeUnknownEffect(UpstreamSyncStartNextReleaseReviewInput);

it.effect("rejects defer decisions", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeDecision("defer"));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts review state payloads", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeReviewState({
      cwd: "/repo",
      status: "running",
      phase: "analyzing",
      releaseTag: "v0.0.14",
      previousTag: "v0.0.13",
      startedAt: "2026-03-30T12:00:00.000Z",
      updatedAt: "2026-03-30T12:00:05.000Z",
      completedAt: null,
      candidateCount: 3,
      completedCandidateCount: 1,
      maxConcurrency: 4,
      runningCandidateCount: 2,
      queuedCandidateCount: 0,
      activeCandidates: [
        {
          id: "commit-123",
          title: "Tighten sync flow",
          index: 1,
          lastProviderProgress: "Inspecting local files",
        },
      ],
      currentCandidateId: "commit-123",
      currentCandidateTitle: "Tighten sync flow",
      currentCandidateIndex: 1,
      lastProviderProgress: "Inspecting local files",
      message: "Analyzing candidate 2 of 3.",
      error: null,
    });
    assert.strictEqual(parsed.status, "running");
    assert.strictEqual(parsed.phase, "analyzing");
  }),
);

it.effect("accepts active candidate payloads", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeActiveCandidate({
      id: "commit-123",
      title: "Tighten sync flow",
      index: 1,
      lastProviderProgress: "Inspecting local files",
    });
    assert.strictEqual(parsed.id, "commit-123");
  }),
);

it.effect("accepts start review input without provider overrides", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeStartInput({
      cwd: "/repo",
      analysisModel: "gpt-5-codex",
      analysisConcurrency: 4,
      forceRefresh: true,
    });
    assert.strictEqual(parsed.cwd, "/repo");
    assert.strictEqual(parsed.forceRefresh, true);
    assert.strictEqual(parsed.analysisConcurrency, 4);
  }),
);
