interface Env {
  DB: D1Database;
}

interface InvestmentPayload {
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

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Investment id is required' });
  }

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
  const result = await env.DB.prepare(
    `
      UPDATE investments
      SET child_id = ?, date = ?, symbol = ?, company_name = ?, quantity = ?, price = ?, total_amount = ?, action = ?, sell_strategy = ?, sell_allocations = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(
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
      now,
      id
    )
    .run();

  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Investment not found' });
  }

  return json(200, { ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Investment id is required' });
  }

  const result = await env.DB.prepare('DELETE FROM investments WHERE id = ?').bind(id).run();
  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Investment not found' });
  }

  return json(200, { ok: true });
};
