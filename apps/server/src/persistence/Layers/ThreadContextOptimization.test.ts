import { ThreadId } from "@samscode/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { makeDefaultThreadContextOptimizationState } from "../../contextOptimization/types.ts";
import { ThreadContextOptimizationRepository } from "../Services/ThreadContextOptimization.ts";
import { ThreadContextOptimizationRepositoryLive } from "./ThreadContextOptimization.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ThreadContextOptimizationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ThreadContextOptimizationRepository", (it) => {
  it.effect("round-trips optimization state rows with pending reseed payloads", () =>
    Effect.gen(function* () {
      const repository = yield* ThreadContextOptimizationRepository;
      const threadId = ThreadId.makeUnsafe("thread-context-opt-roundtrip");
      const state = {
        ...makeDefaultThreadContextOptimizationState(threadId),
        enabled: true,
        status: "pending_reseed" as const,
        segmentIndex: 2,
        lastEvaluatedAt: "2026-03-28T11:00:00.000Z",
        pendingReseed: {
          createdAt: "2026-03-28T11:00:00.000Z",
          reason: "pressure-threshold",
          pressure: 0.8,
          estimatedTokensRemoved: 14000,
          packetPreview: {
            text: "packet",
            charCount: 6,
            estimatedTokens: 2,
          },
        },
        packetPreview: {
          text: "packet",
          charCount: 6,
          estimatedTokens: 2,
        },
      };

      yield* repository.upsert(state);
      const loaded = yield* repository.getByThreadId({ threadId });

      assert.equal(Option.isSome(loaded), true);
      if (Option.isNone(loaded)) {
        return;
      }
      assert.equal(loaded.value.enabled, true);
      assert.equal(loaded.value.segmentIndex, 2);
      assert.equal(loaded.value.pendingReseed?.reason, "pressure-threshold");
      assert.equal(loaded.value.packetPreview?.text, "packet");
    }),
  );

  it.effect("lists only pending or in-flight reseeds", () =>
    Effect.gen(function* () {
      const repository = yield* ThreadContextOptimizationRepository;
      const pendingThreadId = ThreadId.makeUnsafe("thread-context-opt-pending");
      const idleThreadId = ThreadId.makeUnsafe("thread-context-opt-idle");

      yield* repository.upsert({
        ...makeDefaultThreadContextOptimizationState(pendingThreadId),
        enabled: true,
        status: "pending_reseed",
        pendingReseed: {
          createdAt: "2026-03-28T12:00:00.000Z",
          reason: "pressure-threshold",
          pressure: 0.75,
          estimatedTokensRemoved: 12000,
          packetPreview: {
            text: "packet",
            charCount: 6,
            estimatedTokens: 2,
          },
        },
      });
      yield* repository.upsert({
        ...makeDefaultThreadContextOptimizationState(idleThreadId),
        enabled: true,
        status: "idle",
      });

      const pending = yield* repository.listPendingReseeds();
      assert.equal(
        pending.some((entry) => entry.threadId === pendingThreadId),
        true,
      );
      assert.equal(
        pending.some((entry) => entry.threadId === idleThreadId),
        false,
      );
    }),
  );

  it.effect("deletes optimization state by thread id", () =>
    Effect.gen(function* () {
      const repository = yield* ThreadContextOptimizationRepository;
      const threadId = ThreadId.makeUnsafe("thread-context-opt-delete");

      yield* repository.upsert(makeDefaultThreadContextOptimizationState(threadId));
      yield* repository.deleteByThreadId({ threadId });
      const loaded = yield* repository.getByThreadId({ threadId });
      assert.equal(Option.isNone(loaded), true);
    }),
  );
});
