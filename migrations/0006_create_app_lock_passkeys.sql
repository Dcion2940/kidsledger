CREATE TABLE IF NOT EXISTS app_lock_passkeys (
  id TEXT PRIMARY KEY,
  account_scope TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_name TEXT NOT NULL DEFAULT '',
  transports TEXT NOT NULL DEFAULT '[]',
  rp_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  last_used_at TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_app_lock_passkeys_scope_created_at
ON app_lock_passkeys(account_scope, created_at);

CREATE TABLE IF NOT EXISTS app_lock_challenges (
  id TEXT PRIMARY KEY,
  flow_type TEXT NOT NULL,
  account_scope TEXT NOT NULL,
  challenge TEXT NOT NULL,
  user_handle TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_app_lock_challenges_scope_flow
ON app_lock_challenges(account_scope, flow_type, created_at);
