/**
 * ProjectionThreadSessionRepository - Repository interface for thread sessions.
 *
 * Owns persistence operations for projected provider-session linkage and
 * runtime status for each thread.
 *
 * @module ProjectionThreadSessionRepository
 */
import { IsoDateTime, OrchestrationSessionStatus, ThreadId, TurnId } from "@samscode/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(Schema.String),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type ProjectionThreadSession = typeof ProjectionThreadSession.Type;

export const GetProjectionThreadSessionInput = Schema.Struct({ threadId: ThreadId });
export type GetProjectionThreadSessionInput = typeof GetProjectionThreadSessionInput.Type;

export const DeleteProjectionThreadSessionInput = Schema.Struct({ threadId: ThreadId });
export type DeleteProjectionThreadSessionInput = typeof DeleteProjectionThreadSessionInput.Type;

export interface ProjectionThreadSessionRepositoryShape {
  readonly upsert: (row: ProjectionThreadSession) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (
    input: GetProjectionThreadSessionInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadSession>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadSessionRepository extends ServiceMap.Service<
  ProjectionThreadSessionRepository,
  ProjectionThreadSessionRepositoryShape
>()(
  "@samscode/server/persistence/Services/ProjectionThreadSessions/ProjectionThreadSessionRepository",
) {}
