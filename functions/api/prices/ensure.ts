interface Env {
  DB: D1Database;
}

interface EnsurePriceBody {
  symbol?: string;
  companyName?: string;
  market?: string;
  currency?: string;
  fxRateToTwd?: number;
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
  let payload: EnsurePriceBody = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const companyName = String(payload.companyName || '').trim();
  const market = String(payload.market || 'TW').trim().toUpperCase() === 'US' ? 'US' : 'TW';
  const currency = String(payload.currency || (market === 'US' ? 'USD' : 'TWD')).trim().toUpperCase() === 'USD' ? 'USD' : 'TWD';
  const fxRateToTwd = Number(payload.fxRateToTwd);
  const symbol = getStoredPriceSymbol(String(payload.symbol || ''), market);

  if (!symbol) {
    return json(400, { ok: false, error: 'Symbol is required' });
  }

  await env.DB.prepare(
    `
      INSERT INTO prices (symbol, company_name, market, currency, price, fx_rate_to_twd, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, '')
      ON CONFLICT(symbol) DO UPDATE SET
        company_name = CASE
          WHEN prices.company_name = '' AND excluded.company_name <> '' THEN excluded.company_name
          ELSE prices.company_name
        END,
        market = CASE
          WHEN prices.market = '' THEN excluded.market
          ELSE prices.market
        END,
        currency = CASE
          WHEN prices.currency = '' THEN excluded.currency
          ELSE prices.currency
        END,
        fx_rate_to_twd = CASE
          WHEN excluded.fx_rate_to_twd > 0 THEN excluded.fx_rate_to_twd
          ELSE prices.fx_rate_to_twd
        END
    `
  ).bind(symbol, companyName, market, currency, Number.isFinite(fxRateToTwd) && fxRateToTwd > 0 ? fxRateToTwd : market === 'US' ? 0 : 1).run();

  return json(200, { ok: true });
};
