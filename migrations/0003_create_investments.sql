CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  company_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  total_amount REAL NOT NULL,
  action TEXT NOT NULL,
  sell_strategy TEXT NOT NULL DEFAULT '',
  sell_allocations TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_investments_child_date
ON investments(child_id, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_investments_symbol
ON investments(symbol);
