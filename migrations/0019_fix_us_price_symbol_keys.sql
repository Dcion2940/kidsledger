INSERT INTO prices (symbol, company_name, market, currency, price, fx_rate_to_twd, updated_at)
SELECT
  REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(symbol)), '.NYSE', ''), '.NASDAQ', ''), '.NASD', ''), '.US', '') || '.US',
  company_name,
  'US',
  'USD',
  price,
  CASE
    WHEN fx_rate_to_twd > 1 THEN fx_rate_to_twd
    ELSE 0
  END,
  updated_at
FROM prices
WHERE market = 'US'
  AND UPPER(TRIM(symbol)) NOT LIKE '%.US'
ON CONFLICT(symbol) DO UPDATE SET
  company_name = CASE
    WHEN excluded.company_name <> '' THEN excluded.company_name
    ELSE prices.company_name
  END,
  market = 'US',
  currency = 'USD',
  price = CASE
    WHEN excluded.price > 0 THEN excluded.price
    ELSE prices.price
  END,
  fx_rate_to_twd = CASE
    WHEN prices.fx_rate_to_twd > 1 THEN prices.fx_rate_to_twd
    WHEN excluded.fx_rate_to_twd > 1 THEN excluded.fx_rate_to_twd
    ELSE prices.fx_rate_to_twd
  END,
  updated_at = CASE
    WHEN excluded.updated_at <> '' THEN excluded.updated_at
    ELSE prices.updated_at
  END;

DELETE FROM prices
WHERE market = 'US'
  AND UPPER(TRIM(symbol)) NOT LIKE '%.US';
