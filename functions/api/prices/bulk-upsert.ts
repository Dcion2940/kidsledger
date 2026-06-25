interface Env {
  DB: D1Database;
  PRICE_SYNC_KEY?: string;
}

interface PriceItem {
  symbol?: string;
  companyName?: string;
  market?: string;
  currency?: string;
  price?: number | string;
  fxRateToTwd?: number | string;
  updatedAt?: string;
}

interface BulkUpsertBody {
  items?: PriceItem[];
}

const getStoredPriceSymbol = (symbol: string, market: 'TW' | 'US') => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return '';
  if (market === 'US') {
    return normalized.replace(/\.(US|NYSE|NASDAQ|NASD)$/i, '') + '.US';
  }
  return normalized.replace(/\.(TW|TWO)$/i, '');
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PRICE_SYNC_KEY) {
    return json(500, { ok: false, error: 'PRICE_SYNC_KEY is not configured' });
  }

  const incomingKey = request.headers.get('x-price-sync-key');
  if (!incomingKey || incomingKey !== env.PRICE_SYNC_KEY) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  let payload: BulkUpsertBody = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    return json(400, { ok: false, error: 'Items are required' });
  }

  const statements = items
    .map((item) => {
      const market = String(item.market || 'TW').trim().toUpperCase() === 'US' ? 'US' : 'TW';
      return {
        symbol: getStoredPriceSymbol(String(item.symbol || ''), market),
        companyName: String(item.companyName || '').trim(),
        market,
        currency: String(item.currency || (market === 'US' ? 'USD' : 'TWD')).trim().toUpperCase() === 'USD' ? 'USD' : 'TWD',
        price: Number(item.price || 0),
        fxRateToTwd: Number(item.fxRateToTwd || 0),
        updatedAt: String(item.updatedAt || '')
      };
    })
    .filter((item) => item.symbol)
    .map((item) =>
      env.DB.prepare(
        `
          INSERT INTO prices (symbol, company_name, market, currency, price, fx_rate_to_twd, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(symbol) DO UPDATE SET
            company_name = CASE
              WHEN excluded.company_name <> '' THEN excluded.company_name
              ELSE prices.company_name
            END,
            market = excluded.market,
            currency = excluded.currency,
            price = excluded.price,
            fx_rate_to_twd = CASE
              WHEN excluded.fx_rate_to_twd > 0 THEN excluded.fx_rate_to_twd
              ELSE prices.fx_rate_to_twd
            END,
            updated_at = excluded.updated_at
        `
      ).bind(item.symbol, item.companyName, item.market, item.currency, item.price, item.fxRateToTwd, item.updatedAt)
    );

  if (statements.length === 0) {
    return json(400, { ok: false, error: 'No valid items provided' });
  }

  await env.DB.batch(statements);

  return json(200, { ok: true, count: statements.length });
};
