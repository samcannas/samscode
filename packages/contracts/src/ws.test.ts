import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ORCHESTRATION_WS_CHANNELS, ORCHESTRATION_WS_METHODS } from "./orchestration";
import { WebSocketRequest, WsResponse, WS_CHANNELS, WS_METHODS } from "./ws";

const decodeWebSocketRequest = Schema.decodeUnknownEffect(WebSocketRequest);
const decodeWsResponse = Schema.decodeUnknownEffect(WsResponse);

it.effect("accepts getTurnDiff requests when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: "thread-1",
        fromTurnCount: 1,
        toTurnCount: 2,
      },
    });
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
  }),
);

it.effect("rejects getTurnDiff requests when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWebSocketRequest({
        id: "req-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
          threadId: "thread-1",
          fromTurnCount: 3,
          toTurnCount: 2,
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims websocket request id and nested orchestration ids", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: " req-1 ",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: " thread-1 ",
        fromTurnCount: 0,
        toTurnCount: 0,
      },
    });
    assert.strictEqual(parsed.id, "req-1");
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
      assert.strictEqual(parsed.body.threadId, "thread-1");
    }
  }),
);

it.effect("accepts git.preparePullRequestThread requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-pr-1",
      body: {
        _tag: WS_METHODS.gitPreparePullRequestThread,
        cwd: "/repo",
        reference: "#42",
        mode: "worktree",
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.gitPreparePullRequestThread);
  }),
);

it.effect("accepts speech-to-text session start requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-stt-1",
      body: {
        _tag: WS_METHODS.speechToTextStartSession,
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.speechToTextStartSession);
  }),
);

it.effect("accepts upstream review start requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-upstream-1",
      body: {
        _tag: WS_METHODS.upstreamSyncStartNextReleaseReview,
        cwd: "/repo",
        forceRefresh: true,
        analysisModel: "gpt-5-codex",
        analysisConcurrency: 4,
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.upstreamSyncStartNextReleaseReview);
  }),
);

it.effect("accepts skills.buildPrompt requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-skill-1",
      body: {
        _tag: WS_METHODS.skillsBuildPrompt,
        provider: "codex",
        prompt: "Refresh the landing page",
        skillIds: ["frontend-design"],
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.skillsBuildPrompt);
  }),
);

it.effect("accepts typed websocket push envelopes with sequence", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWsResponse({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverWelcome,
      data: {
        cwd: "/tmp/workspace",
        projectName: "workspace",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.type, "push");
    assert.strictEqual(parsed.sequence, 1);
    assert.strictEqual(parsed.channel, WS_CHANNELS.serverWelcome);
  }),
);

it.effect("rejects push envelopes when channel payload does not match the channel schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWsResponse({
        type: "push",
        sequence: 2,
        channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
        data: {
          cwd: "/tmp/workspace",
          projectName: "workspace",
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts speech-to-text push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWsResponse({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.speechToTextUpdated,
      data: {
        available: true,
        runtimeStatus: "ready",
        runtimeBackend: "whisper.cpp-cpu",
        runtimeAcceleration: "cpu",
        runtimeDevice: "Windows x64 (CPU BLAS)",
        selectedModelId: "ggml-base.en.bin",
        installedModels: [
          {
            id: "ggml-base.en.bin",
            fileName: "ggml-base.en.bin",
            name: "Base English",
            family: "whisper-ggml",
            sizeBytes: 155189248,
            installedAt: "2026-03-22T00:00:00.000Z",
            selected: true,
          },
        ],
        catalog: [],
        activeDownload: null,
        settings: {
          language: "en",
          prompt: "Prompt",
          useVad: true,
          endpointingEnabled: true,
          endpointSilenceMs: 450,
          partialTranscriptsEnabled: true,
          warmupEnabled: true,
          qualityProfile: "balanced",
          cleanupModel: null,
          refinementMode: "refine-on-stop",
        },
        errorMessage: null,
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.speechToTextUpdated);
  }),
);

it.effect("accepts upstream review push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWsResponse({
      type: "push",
      sequence: 4,
      channel: WS_CHANNELS.upstreamSyncReviewUpdated,
      data: {
        cwd: "/repo",
        status: "running",
        phase: "analyzing",
        releaseTag: "v0.0.14",
        previousTag: "v0.0.13",
        startedAt: "2026-03-30T12:00:00.000Z",
        updatedAt: "2026-03-30T12:00:05.000Z",
        completedAt: null,
        candidateCount: 2,
        completedCandidateCount: 1,
        currentCandidateId: "commit-abc123",
        currentCandidateTitle: "Improve sync handling",
        currentCandidateIndex: 1,
        lastProviderProgress: "Inspecting local files",
        message: "Analyzing candidate 2 of 2.",
        error: null,
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.upstreamSyncReviewUpdated);
  }),
);
