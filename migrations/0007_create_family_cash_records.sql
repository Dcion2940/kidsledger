CREATE TABLE IF NOT EXISTS family_cash_records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_family_cash_records_date
ON family_cash_records(date DESC, id DESC);
