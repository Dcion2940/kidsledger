CREATE TABLE IF NOT EXISTS shortcut_ai_drafts (
  app_user_email TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL DEFAULT '',
  draft_json TEXT NOT NULL DEFAULT '',
  summary_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shortcut_ai_drafts_expires_at
ON shortcut_ai_drafts(expires_at);
