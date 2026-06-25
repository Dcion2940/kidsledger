interface Env {
  DB: D1Database;
}

interface InvestmentPayload {
  id?: string;
  childId?: string;
  date?: string;
  market?: string;
  symbol?: string;
  companyName?: string;
  quantity?: number;
  price?: number;
  totalAmount?: number;
  action?: string;
  broker?: string;
  orderChannel?: string;
  tradeCurrency?: string;
  settlementCurrency?: string;
  fxRateToTwd?: number;
  feeAmount?: number;
  feeCurrency?: string;
  netAmountTwd?: number;
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
  const market = String(payload.market || 'TW').trim().toUpperCase();
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const companyName = String(payload.companyName || '').trim();
  const quantity = Number(payload.quantity);
  const price = Number(payload.price);
  const totalAmount = Number(payload.totalAmount);
  const action = String(payload.action || '').trim();
  const fxRateToTwd = Number(payload.fxRateToTwd);
  const feeAmount = Number(payload.feeAmount || 0);
  const netAmountTwd = Number(payload.netAmountTwd);
  const sellStrategy = String(payload.sellStrategy || '').trim();
  const sellAllocations = String(payload.sellAllocations || '').trim();

  if (!id) return 'Investment id is required';
  if (!childId) return 'Child id is required';
  if (!date) return 'Date is required';
  if (market !== 'TW' && market !== 'US') return 'Market must be TW or US';
  if (!symbol) return 'Symbol is required';
  if (!companyName) return 'Company name is required';
  if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantity must be greater than 0';
  if (!Number.isFinite(price) || price <= 0) return 'Price must be greater than 0';
  if (!Number.isFinite(totalAmount)) return 'Total amount must be a valid number';
  if (market === 'US' && (!Number.isFinite(fxRateToTwd) || fxRateToTwd <= 0)) return 'FX rate must be greater than 0 for US investments';
  if (!Number.isFinite(feeAmount) || feeAmount < 0) return 'Fee amount must be 0 or greater';
  if (!Number.isFinite(netAmountTwd) || netAmountTwd < 0) return 'Net TWD amount must be a valid number';
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
            id, child_id, date, market, symbol, company_name, quantity, price, total_amount, action, broker, order_channel, trade_currency, settlement_currency, fx_rate_to_twd, fee_amount, fee_currency, net_amount_twd, sell_strategy, sell_allocations, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            child_id = excluded.child_id,
            date = excluded.date,
            market = excluded.market,
            symbol = excluded.symbol,
            company_name = excluded.company_name,
            quantity = excluded.quantity,
            price = excluded.price,
            total_amount = excluded.total_amount,
            action = excluded.action,
            broker = excluded.broker,
            order_channel = excluded.order_channel,
            trade_currency = excluded.trade_currency,
            settlement_currency = excluded.settlement_currency,
            fx_rate_to_twd = excluded.fx_rate_to_twd,
            fee_amount = excluded.fee_amount,
            fee_currency = excluded.fee_currency,
            net_amount_twd = excluded.net_amount_twd,
            sell_strategy = excluded.sell_strategy,
            sell_allocations = excluded.sell_allocations,
            updated_at = excluded.updated_at
        `
      ).bind(
        String(item.id).trim(),
        String(item.childId).trim(),
        String(item.date).trim(),
        String(item.market || 'TW').trim().toUpperCase(),
        String(item.symbol).trim().toUpperCase(),
        String(item.companyName).trim(),
        Number(item.quantity),
        Number(item.price),
        Number(item.totalAmount),
        String(item.action).trim(),
        String(item.broker || '').trim(),
        String(item.orderChannel || '').trim(),
        String(item.tradeCurrency || '').trim().toUpperCase(),
        String(item.settlementCurrency || 'TWD').trim().toUpperCase(),
        Number(item.fxRateToTwd || 0),
        Number(item.feeAmount || 0),
        String(item.feeCurrency || '').trim().toUpperCase(),
        Number(item.netAmountTwd || 0),
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
