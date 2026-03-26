interface Env {
  DB: D1Database;
  PRICE_SYNC_KEY?: string;
}

interface PriceItem {
  symbol?: string;
  companyName?: string;
  price?: number | string;
  updatedAt?: string;
}

interface BulkUpsertBody {
  items?: PriceItem[];
}

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
    .map((item) => ({
      symbol: String(item.symbol || '').trim().toUpperCase(),
      companyName: String(item.companyName || '').trim(),
      price: Number(item.price || 0),
      updatedAt: String(item.updatedAt || '')
    }))
    .filter((item) => item.symbol)
    .map((item) =>
      env.DB.prepare(
        `
          INSERT INTO prices (symbol, company_name, price, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(symbol) DO UPDATE SET
            company_name = CASE
              WHEN excluded.company_name <> '' THEN excluded.company_name
              ELSE prices.company_name
            END,
            price = excluded.price,
            updated_at = excluded.updated_at
        `
      ).bind(item.symbol, item.companyName, item.price, item.updatedAt)
    );

  if (statements.length === 0) {
    return json(400, { ok: false, error: 'No valid items provided' });
  }

  await env.DB.batch(statements);

  return json(200, { ok: true, count: statements.length });
};
