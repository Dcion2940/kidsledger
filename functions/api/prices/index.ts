interface Env {
  DB: D1Database;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT symbol, company_name, market, currency, price, fx_rate_to_twd, updated_at FROM prices ORDER BY symbol ASC'
  ).all();

  return json(200, {
    prices: (results || []).map((row: any) => ({
      symbol: String(row.symbol || '').trim().toUpperCase(),
      companyName: String(row.company_name || ''),
      market: String(row.market || 'TW').toUpperCase() === 'US' ? 'US' : 'TW',
      currency: String(row.currency || 'TWD').toUpperCase() === 'USD' ? 'USD' : 'TWD',
      price: Number(row.price || 0),
      fxRateToTwd: Number(row.fx_rate_to_twd || 0),
      updatedAt: String(row.updated_at || '')
    }))
  });
};
