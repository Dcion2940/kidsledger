interface Env {
  DB: D1Database;
}

interface EnsurePriceBody {
  symbol?: string;
  companyName?: string;
}

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

  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const companyName = String(payload.companyName || '').trim();

  if (!symbol) {
    return json(400, { ok: false, error: 'Symbol is required' });
  }

  await env.DB.prepare(
    `
      INSERT INTO prices (symbol, company_name, price, updated_at)
      VALUES (?, ?, 0, '')
      ON CONFLICT(symbol) DO UPDATE SET
        company_name = CASE
          WHEN prices.company_name = '' AND excluded.company_name <> '' THEN excluded.company_name
          ELSE prices.company_name
        END
    `
  ).bind(symbol, companyName).run();

  return json(200, { ok: true });
};
