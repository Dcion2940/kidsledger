interface Env {
  DB: D1Database;
}

interface InvestmentPayload {
  id?: string;
  childId?: string;
  date?: string;
  symbol?: string;
  companyName?: string;
  quantity?: number;
  price?: number;
  totalAmount?: number;
  action?: string;
  sellStrategy?: string;
  sellAllocations?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

const validatePayload = (payload: InvestmentPayload) => {
  const id = String(payload.id || '').trim();
  const childId = String(payload.childId || '').trim();
  const date = String(payload.date || '').trim();
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const companyName = String(payload.companyName || '').trim();
  const quantity = Number(payload.quantity);
  const price = Number(payload.price);
  const totalAmount = Number(payload.totalAmount);
  const action = String(payload.action || '').trim();
  const sellStrategy = String(payload.sellStrategy || '').trim();
  const sellAllocations = String(payload.sellAllocations || '').trim();

  if (!id) return 'Investment id is required';
  if (!childId) return 'Child id is required';
  if (!date) return 'Date is required';
  if (!symbol) return 'Symbol is required';
  if (!companyName) return 'Company name is required';
  if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantity must be greater than 0';
  if (!Number.isFinite(price) || price <= 0) return 'Price must be greater than 0';
  if (!Number.isFinite(totalAmount)) return 'Total amount must be a valid number';
  if (action !== 'BUY' && action !== 'SELL') return 'Action must be BUY or SELL';
  if (sellStrategy && !['FIFO', 'LOWEST_COST', 'SPECIFIC'].includes(sellStrategy)) {
    return 'Invalid sell strategy';
  }
  if (sellAllocations) {
    try {
      const parsed = JSON.parse(sellAllocations);
      if (!Array.isArray(parsed)) return 'Sell allocations must be an array';
    } catch {
      return 'Sell allocations must be valid JSON';
    }
  }

  return null;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { items?: InvestmentPayload[] } = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return json(400, { ok: false, error: 'Items are required' });
  }

  const now = new Date().toISOString();
  const statements = [];

  for (const item of items) {
    const error = validatePayload(item);
    if (error) {
      return json(400, { ok: false, error: `${error}: ${JSON.stringify(item)}` });
    }

    statements.push(
      env.DB.prepare(
        `
          INSERT INTO investments (
            id, child_id, date, symbol, company_name, quantity, price, total_amount, action, sell_strategy, sell_allocations, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            child_id = excluded.child_id,
            date = excluded.date,
            symbol = excluded.symbol,
            company_name = excluded.company_name,
            quantity = excluded.quantity,
            price = excluded.price,
            total_amount = excluded.total_amount,
            action = excluded.action,
            sell_strategy = excluded.sell_strategy,
            sell_allocations = excluded.sell_allocations,
            updated_at = excluded.updated_at
        `
      ).bind(
        String(item.id).trim(),
        String(item.childId).trim(),
        String(item.date).trim(),
        String(item.symbol).trim().toUpperCase(),
        String(item.companyName).trim(),
        Number(item.quantity),
        Number(item.price),
        Number(item.totalAmount),
        String(item.action).trim(),
        String(item.sellStrategy || '').trim(),
        String(item.sellAllocations || '').trim(),
        now
      )
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  return json(200, { ok: true, count: statements.length });
};
