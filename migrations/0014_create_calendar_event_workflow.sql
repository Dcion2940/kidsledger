CREATE TABLE IF NOT EXISTS calendar_event_workflow (
  google_event_id TEXT PRIMARY KEY,
  auto_rollover_enabled INTEGER NOT NULL DEFAULT 0,
  is_confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT NOT NULL DEFAULT '',
  confirmed_by_name TEXT NOT NULL DEFAULT '',
  confirmed_by_email TEXT NOT NULL DEFAULT '',
  last_rollover_at TEXT NOT NULL DEFAULT '',
  rollover_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_workflow_rollover
ON calendar_event_workflow(auto_rollover_enabled, is_confirmed, updated_at);
