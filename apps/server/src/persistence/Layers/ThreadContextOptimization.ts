import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteThreadContextOptimizationStateInput,
  GetThreadContextOptimizationStateInput,
  ThreadContextOptimizationRepository,
  type ThreadContextOptimizationRepositoryShape,
} from "../Services/ThreadContextOptimization.ts";
import { ThreadContextOptimizationState } from "../../contextOptimization/types.ts";

const ThreadContextOptimizationDbRowSchema = ThreadContextOptimizationState.mapFields(
  Struct.assign({
    pendingReseed: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    packetPreview: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    stats: Schema.fromJsonString(Schema.Unknown),
    workingSet: Schema.fromJsonString(Schema.Unknown),
    toolIndex: Schema.fromJsonString(Schema.Unknown),
    durableMemory: Schema.fromJsonString(Schema.Unknown),
  }),
);

const ThreadContextOptimizationSelectRowSchema = Schema.Struct({
  threadId: Schema.String,
  enabled: Schema.Number,
  stateVersion: Schema.Number,
  segmentIndex: Schema.Number,
  status: Schema.String,
  lastEvaluatedAt: Schema.NullOr(Schema.String),
  lastReseededAt: Schema.NullOr(Schema.String),
  pendingReseed: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  packetPreview: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  stats: Schema.fromJsonString(Schema.Unknown),
  workingSet: Schema.fromJsonString(Schema.Unknown),
  toolIndex: Schema.fromJsonString(Schema.Unknown),
  durableMemory: Schema.fromJsonString(Schema.Unknown),
  lastError: Schema.NullOr(Schema.String),
});

const decodeState = Schema.decodeUnknownEffect(ThreadContextOptimizationState);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeThreadContextOptimizationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ThreadContextOptimizationDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO thread_context_optimization (
          thread_id,
          enabled,
          state_version,
          segment_index,
          status,
          last_evaluated_at,
          last_reseeded_at,
          pending_reseed_json,
          packet_preview_json,
          stats_json,
          working_set_json,
          tool_index_json,
          durable_memory_json,
          last_error
        )
        VALUES (
          ${row.threadId},
          ${row.enabled ? 1 : 0},
          ${row.stateVersion},
          ${row.segmentIndex},
          ${row.status},
          ${row.lastEvaluatedAt},
          ${row.lastReseededAt},
          ${row.pendingReseed},
          ${row.packetPreview},
          ${row.stats},
          ${row.workingSet},
          ${row.toolIndex},
          ${row.durableMemory},
          ${row.lastError}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          enabled = excluded.enabled,
          state_version = excluded.state_version,
          segment_index = excluded.segment_index,
          status = excluded.status,
          last_evaluated_at = excluded.last_evaluated_at,
          last_reseeded_at = excluded.last_reseeded_at,
          pending_reseed_json = excluded.pending_reseed_json,
          packet_preview_json = excluded.packet_preview_json,
          stats_json = excluded.stats_json,
          working_set_json = excluded.working_set_json,
          tool_index_json = excluded.tool_index_json,
          durable_memory_json = excluded.durable_memory_json,
          last_error = excluded.last_error
      `,
  });

  const getRowByThreadId = SqlSchema.findOneOption({
    Request: GetThreadContextOptimizationStateInput,
    Result: ThreadContextOptimizationSelectRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          enabled,
          state_version AS "stateVersion",
          segment_index AS "segmentIndex",
          status,
          last_evaluated_at AS "lastEvaluatedAt",
          last_reseeded_at AS "lastReseededAt",
          pending_reseed_json AS "pendingReseed",
          packet_preview_json AS "packetPreview",
          stats_json AS "stats",
          working_set_json AS "workingSet",
          tool_index_json AS "toolIndex",
          durable_memory_json AS "durableMemory",
          last_error AS "lastError"
        FROM thread_context_optimization
        WHERE thread_id = ${threadId}
      `,
  });

  const listPendingRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadContextOptimizationSelectRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          enabled,
          state_version AS "stateVersion",
          segment_index AS "segmentIndex",
          status,
          last_evaluated_at AS "lastEvaluatedAt",
          last_reseeded_at AS "lastReseededAt",
          pending_reseed_json AS "pendingReseed",
          packet_preview_json AS "packetPreview",
          stats_json AS "stats",
          working_set_json AS "workingSet",
          tool_index_json AS "toolIndex",
          durable_memory_json AS "durableMemory",
          last_error AS "lastError"
        FROM thread_context_optimization
        WHERE status IN ('pending_reseed', 'reseed_in_flight')
        ORDER BY thread_id ASC
      `,
  });

  const deleteByThreadIdRow = SqlSchema.void({
    Request: DeleteThreadContextOptimizationStateInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM thread_context_optimization
        WHERE thread_id = ${threadId}
      `,
  });

  const getByThreadId: ThreadContextOptimizationRepositoryShape["getByThreadId"] = (input) =>
    getRowByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadContextOptimizationRepository.getByThreadId:query",
          "ThreadContextOptimizationRepository.getByThreadId:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            decodeState({
              ...row,
              enabled: row.enabled === 1,
            }).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  "ThreadContextOptimizationRepository.getByThreadId:rowToState",
                ),
              ),
              Effect.map((state) => Option.some(state)),
            ),
        }),
      ),
    );

  const upsert: ThreadContextOptimizationRepositoryShape["upsert"] = (state) =>
    upsertRow(state).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadContextOptimizationRepository.upsert:query",
          "ThreadContextOptimizationRepository.upsert:encodeRequest",
        ),
      ),
    );

  const deleteByThreadId: ThreadContextOptimizationRepositoryShape["deleteByThreadId"] = (input) =>
    deleteByThreadIdRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ThreadContextOptimizationRepository.deleteByThreadId:query"),
      ),
    );

  const listPendingReseeds: ThreadContextOptimizationRepositoryShape["listPendingReseeds"] = () =>
    listPendingRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadContextOptimizationRepository.listPendingReseeds:query",
          "ThreadContextOptimizationRepository.listPendingReseeds:decodeRows",
        ),
      ),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) =>
            decodeState({
              ...row,
              enabled: row.enabled === 1,
            }).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  "ThreadContextOptimizationRepository.listPendingReseeds:rowToState",
                ),
              ),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    );

  return {
    getByThreadId,
    upsert,
    deleteByThreadId,
    listPendingReseeds,
  } satisfies ThreadContextOptimizationRepositoryShape;
});

export const ThreadContextOptimizationRepositoryLive = Layer.effect(
  ThreadContextOptimizationRepository,
  makeThreadContextOptimizationRepository,
);
