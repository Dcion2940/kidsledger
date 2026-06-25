CREATE TABLE IF NOT EXISTS calendar_action_logs (
  id TEXT PRIMARY KEY,
  google_event_id TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  request_payload_json TEXT NOT NULL DEFAULT '{}',
  result_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_calendar_action_logs_event_created
ON calendar_action_logs(google_event_id, created_at DESC);
