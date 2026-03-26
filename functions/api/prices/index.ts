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
    'SELECT symbol, company_name, price, updated_at FROM prices ORDER BY symbol ASC'
  ).all();

  return json(200, {
    prices: (results || []).map((row: any) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      companyName: String(row.company_name || ''),
      price: Number(row.price || 0),
      updatedAt: String(row.updated_at || '')
    }))
  });
};
