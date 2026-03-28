import type { OrchestrationEvent, ProviderRuntimeEvent, ThreadId } from "@samscode/contracts";
import { Option, ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  ContextOptimizationPacketPreview,
  PendingReseedPayload,
  ThreadContextOptimizationState,
} from "../types.ts";

export interface ContextOptimizationShape {
  readonly recordTurnStartRequested: (
    event: Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>,
  ) => Effect.Effect<void>;
  readonly recordRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly recordTurnCompleted: (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
  }) => Effect.Effect<void>;
  readonly getPendingReseed: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<PendingReseedPayload>>;
  readonly buildReseedProviderInput: (input: {
    readonly threadId: ThreadId;
    readonly userMessageText: string;
  }) => Effect.Effect<
    {
      readonly providerInputText: string;
      readonly packetPreview: ContextOptimizationPacketPreview;
      readonly pendingReseed: PendingReseedPayload;
    },
    Error
  >;
  readonly cancelPendingReseed: (input: {
    readonly threadId: ThreadId;
    readonly reason: string;
  }) => Effect.Effect<void>;
  readonly markReseedStarted: (threadId: ThreadId) => Effect.Effect<void>;
  readonly markReseedSucceeded: (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly packetPreview: ContextOptimizationPacketPreview;
  }) => Effect.Effect<ThreadContextOptimizationState>;
  readonly markReseedFailed: (input: {
    readonly threadId: ThreadId;
    readonly error: string;
  }) => Effect.Effect<void>;
}

export class ContextOptimizationService extends ServiceMap.Service<
  ContextOptimizationService,
  ContextOptimizationShape
>()(
  "@samscode/server/contextOptimization/Services/ContextOptimization/ContextOptimizationService",
) {}
