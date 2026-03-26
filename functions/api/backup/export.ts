interface Env {
  DB: D1Database;
  BACKUP_READ_KEY?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const configuredKey = String(env.BACKUP_READ_KEY || '').trim();
  if (!configuredKey) {
    return json(500, { ok: false, error: 'BACKUP_READ_KEY is not configured' });
  }

  const requestKey = String(request.headers.get('x-backup-read-key') || '').trim();
  if (!requestKey || requestKey !== configuredKey) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  const [childrenRes, transactionsRes, investmentsRes, pricesRes, settingsRow] = await Promise.all([
    env.DB.prepare('SELECT id, name, avatar, role, avatar_seed, updated_at FROM children ORDER BY id ASC').all(),
    env.DB.prepare('SELECT id, child_id, date, type, category, amount, description, updated_at FROM transactions ORDER BY date DESC, id DESC').all(),
    env.DB.prepare('SELECT id, child_id, date, symbol, company_name, quantity, price, total_amount, action, sell_strategy, sell_allocations, updated_at FROM investments ORDER BY date DESC, id DESC').all(),
    env.DB.prepare('SELECT symbol, company_name, price, updated_at FROM prices ORDER BY symbol ASC').all(),
    env.DB.prepare('SELECT id, google_sheet_id, ai_mentor_enabled, ai_api_link, updated_at FROM app_settings WHERE id = ?').bind('global').first()
  ]);

  const children = (childrenRes.results || []).map((row: any) => ({
    id: String(row.id || ''),
    name: String(row.name || ''),
    avatar: String(row.avatar || ''),
    role: String(row.role || 'CHILD'),
    avatarSeed: String(row.avatar_seed || ''),
    updatedAt: String(row.updated_at || '')
  }));

  const transactions = (transactionsRes.results || []).map((row: any) => ({
    id: String(row.id || ''),
    childId: String(row.child_id || ''),
    date: String(row.date || ''),
    type: String(row.type || ''),
    category: String(row.category || ''),
    amount: Number(row.amount || 0),
    description: String(row.description || ''),
    updatedAt: String(row.updated_at || '')
  }));

  const investments = (investmentsRes.results || []).map((row: any) => ({
    id: String(row.id || ''),
    childId: String(row.child_id || ''),
    date: String(row.date || ''),
    symbol: String(row.symbol || ''),
    companyName: String(row.company_name || ''),
    quantity: Number(row.quantity || 0),
    price: Number(row.price || 0),
    totalAmount: Number(row.total_amount || 0),
    action: String(row.action || ''),
    sellStrategy: String(row.sell_strategy || ''),
    sellAllocations: String(row.sell_allocations || ''),
    updatedAt: String(row.updated_at || '')
  }));

  const prices = (pricesRes.results || []).map((row: any) => ({
    symbol: String(row.symbol || ''),
    companyName: String(row.company_name || ''),
    price: Number(row.price || 0),
    updatedAt: String(row.updated_at || '')
  }));

  const settings = settingsRow
    ? {
        id: String((settingsRow as any).id || 'global'),
        googleSheetId: String((settingsRow as any).google_sheet_id || ''),
        aiMentorEnabled: Number((settingsRow as any).ai_mentor_enabled ?? 1) === 1,
        aiApiLink: String((settingsRow as any).ai_api_link || ''),
        updatedAt: String((settingsRow as any).updated_at || '')
      }
    : {
        id: 'global',
        googleSheetId: '',
        aiMentorEnabled: true,
        aiApiLink: '',
        updatedAt: ''
      };

  return json(200, {
    ok: true,
    exportedAt: new Date().toISOString(),
    counts: {
      children: children.length,
      transactions: transactions.length,
      investments: investments.length,
      prices: prices.length,
      settings: settings ? 1 : 0
    },
    data: {
      children,
      transactions,
      investments,
      prices,
      settings
    }
  });
};
