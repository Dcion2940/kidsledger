ALTER TABLE app_settings ADD COLUMN usd_twd_reference_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN usd_twd_reference_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE app_settings ADD COLUMN usd_twd_reference_source TEXT NOT NULL DEFAULT '';
