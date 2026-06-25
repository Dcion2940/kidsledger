CREATE TABLE IF NOT EXISTS calendar_notification_jobs (
  id TEXT PRIMARY KEY,
  google_event_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_calendar_notification_jobs_due
ON calendar_notification_jobs(status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_calendar_notification_jobs_event
ON calendar_notification_jobs(google_event_id, job_type);
