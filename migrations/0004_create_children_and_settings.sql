CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CHILD',
  avatar_seed TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_children_role_name
ON children(role, name);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  google_sheet_id TEXT NOT NULL DEFAULT '',
  ai_mentor_enabled INTEGER NOT NULL DEFAULT 1,
  ai_api_link TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
