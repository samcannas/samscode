import { ThreadId } from "@samscode/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import { ThreadContextOptimizationState } from "../../contextOptimization/types.ts";

export const GetThreadContextOptimizationStateInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetThreadContextOptimizationStateInput =
  typeof GetThreadContextOptimizationStateInput.Type;

export const DeleteThreadContextOptimizationStateInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteThreadContextOptimizationStateInput =
  typeof DeleteThreadContextOptimizationStateInput.Type;

export interface ThreadContextOptimizationRepositoryShape {
  readonly getByThreadId: (
    input: GetThreadContextOptimizationStateInput,
  ) => Effect.Effect<Option.Option<ThreadContextOptimizationState>, ProjectionRepositoryError>;
  readonly upsert: (
    state: ThreadContextOptimizationState,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteThreadContextOptimizationStateInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listPendingReseeds: () => Effect.Effect<
    ReadonlyArray<ThreadContextOptimizationState>,
    ProjectionRepositoryError
  >;
}

export class ThreadContextOptimizationRepository extends ServiceMap.Service<
  ThreadContextOptimizationRepository,
  ThreadContextOptimizationRepositoryShape
>()(
  "@samscode/server/persistence/Services/ThreadContextOptimization/ThreadContextOptimizationRepository",
) {}
