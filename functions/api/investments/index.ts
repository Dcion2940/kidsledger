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

const normalizeRow = (row: any) => ({
  id: String(row.id || ''),
  childId: String(row.child_id || ''),
  date: String(row.date || ''),
  symbol: String(row.symbol || '').toUpperCase(),
  companyName: String(row.company_name || ''),
  quantity: Number(row.quantity || 0),
  price: Number(row.price || 0),
  totalAmount: Number(row.total_amount || 0),
  action: String(row.action || '') as 'BUY' | 'SELL',
  sellStrategy: String(row.sell_strategy || '') || undefined,
  sellAllocations: String(row.sell_allocations || '') || undefined
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const childId = url.searchParams.get('childId')?.trim();

  const stmt = childId
    ? env.DB.prepare(
        'SELECT id, child_id, date, symbol, company_name, quantity, price, total_amount, action, sell_strategy, sell_allocations FROM investments WHERE child_id = ? ORDER BY date DESC, id DESC'
      ).bind(childId)
    : env.DB.prepare(
        'SELECT id, child_id, date, symbol, company_name, quantity, price, total_amount, action, sell_strategy, sell_allocations FROM investments ORDER BY date DESC, id DESC'
      );

  const { results } = await stmt.all();

  return json(200, {
    investments: (results || []).map(normalizeRow)
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: InvestmentPayload = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const error = validatePayload(payload);
  if (error) {
    return json(400, { ok: false, error });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
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
  )
    .bind(
      String(payload.id).trim(),
      String(payload.childId).trim(),
      String(payload.date).trim(),
      String(payload.symbol).trim().toUpperCase(),
      String(payload.companyName).trim(),
      Number(payload.quantity),
      Number(payload.price),
      Number(payload.totalAmount),
      String(payload.action).trim(),
      String(payload.sellStrategy || '').trim(),
      String(payload.sellAllocations || '').trim(),
      now
    )
    .run();

  return json(200, { ok: true });
};
