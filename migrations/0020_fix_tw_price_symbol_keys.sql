INSERT INTO prices (symbol, company_name, market, currency, price, fx_rate_to_twd, updated_at)
SELECT
  REPLACE(REPLACE(UPPER(TRIM(symbol)), '.TWO', ''), '.TW', ''),
  company_name,
  'TW',
  'TWD',
  price,
  1,
  updated_at
FROM prices
WHERE market = 'TW'
  AND (
    UPPER(TRIM(symbol)) LIKE '%.TW'
    OR UPPER(TRIM(symbol)) LIKE '%.TWO'
  )
ON CONFLICT(symbol) DO UPDATE SET
  company_name = CASE
    WHEN prices.company_name = '' AND excluded.company_name <> '' THEN excluded.company_name
    ELSE prices.company_name
  END,
  market = 'TW',
  currency = 'TWD',
  price = CASE
    WHEN excluded.updated_at > prices.updated_at THEN excluded.price
    ELSE prices.price
  END,
  fx_rate_to_twd = 1,
  updated_at = CASE
    WHEN excluded.updated_at > prices.updated_at THEN excluded.updated_at
    ELSE prices.updated_at
  END;

DELETE FROM prices
WHERE market = 'TW'
  AND (
    UPPER(TRIM(symbol)) LIKE '%.TW'
    OR UPPER(TRIM(symbol)) LIKE '%.TWO'
  );
