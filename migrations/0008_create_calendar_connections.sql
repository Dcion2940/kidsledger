CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'google',
  google_email TEXT NOT NULL DEFAULT '',
  google_display_name TEXT NOT NULL DEFAULT '',
  calendar_id TEXT NOT NULL DEFAULT '',
  calendar_name TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  refresh_token_encrypted TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL DEFAULT '',
  token_expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_provider
ON calendar_connections(provider, updated_at DESC);
