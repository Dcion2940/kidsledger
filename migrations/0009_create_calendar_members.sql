CREATE TABLE IF NOT EXISTS calendar_members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  email TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_calendar_members_nickname
ON calendar_members(nickname, is_active);

CREATE INDEX IF NOT EXISTS idx_calendar_members_email
ON calendar_members(email);
