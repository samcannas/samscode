import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DELETE FROM orchestration_command_receipts`;
  yield* sql`DELETE FROM orchestration_events`;
  yield* sql`DELETE FROM provider_session_runtime`;
  yield* sql`DELETE FROM projection_projects`;
  yield* sql`DELETE FROM projection_threads`;
  yield* sql`DELETE FROM projection_thread_messages`;
  yield* sql`DELETE FROM projection_thread_activities`;
  yield* sql`DELETE FROM projection_thread_sessions`;
  yield* sql`DELETE FROM projection_thread_proposed_plans`;
  yield* sql`DELETE FROM projection_turns`;
  yield* sql`DELETE FROM projection_state`;

  yield* sql`DROP TABLE IF EXISTS projection_pending_approvals`;

  yield* sql`DROP TABLE IF EXISTS provider_session_runtime`;
  yield* sql`
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT,
      runtime_payload_json TEXT
    )
  `;

  yield* sql`DROP TABLE IF EXISTS projection_threads`;
  yield* sql`
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    )
  `;

  yield* sql`DROP TABLE IF EXISTS projection_thread_sessions`;
  yield* sql`
    CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      provider_name TEXT,
      provider_session_id TEXT,
      provider_thread_id TEXT,
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    )
  `;
});
