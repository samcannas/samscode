import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_context_optimization (
      thread_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      state_version INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_evaluated_at TEXT,
      last_reseeded_at TEXT,
      pending_reseed_json TEXT,
      packet_preview_json TEXT,
      stats_json TEXT NOT NULL,
      working_set_json TEXT NOT NULL,
      tool_index_json TEXT NOT NULL,
      durable_memory_json TEXT NOT NULL,
      last_error TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_context_optimization_status
    ON thread_context_optimization(status)
  `;
});
