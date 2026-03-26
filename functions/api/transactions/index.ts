interface Env {
  DB: D1Database;
}

interface TransactionPayload {
  id?: string;
  childId?: string;
  date?: string;
  type?: string;
  category?: string;
  amount?: number;
  description?: string;
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
  type: String(row.type || ''),
  category: String(row.category || ''),
  amount: Number(row.amount || 0),
  description: String(row.description || '')
});

const validatePayload = (payload: TransactionPayload) => {
  const id = String(payload.id || '').trim();
  const childId = String(payload.childId || '').trim();
  const date = String(payload.date || '').trim();
  const type = String(payload.type || '').trim();
  const category = String(payload.category || '').trim();
  const description = String(payload.description || '').trim();
  const amount = Number(payload.amount);

  if (!id) return 'Transaction id is required';
  if (!childId) return 'Child id is required';
  if (!date) return 'Date is required';
  if (!type) return 'Type is required';
  if (!category) return 'Category is required';
  if (!description) return 'Description is required';
  if (!Number.isFinite(amount)) return 'Amount must be a valid number';

  return null;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const childId = url.searchParams.get('childId')?.trim();

  const stmt = childId
    ? env.DB.prepare(
        'SELECT id, child_id, date, type, category, amount, description FROM transactions WHERE child_id = ? ORDER BY date DESC, id DESC'
      ).bind(childId)
    : env.DB.prepare(
        'SELECT id, child_id, date, type, category, amount, description FROM transactions ORDER BY date DESC, id DESC'
      );

  const { results } = await stmt.all();

  return json(200, {
    transactions: (results || []).map(normalizeRow)
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: TransactionPayload = {};
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
      INSERT INTO transactions (id, child_id, date, type, category, amount, description, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        child_id = excluded.child_id,
        date = excluded.date,
        type = excluded.type,
        category = excluded.category,
        amount = excluded.amount,
        description = excluded.description,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      String(payload.id).trim(),
      String(payload.childId).trim(),
      String(payload.date).trim(),
      String(payload.type).trim(),
      String(payload.category).trim(),
      Number(payload.amount),
      String(payload.description).trim(),
      now
    )
    .run();

  return json(200, { ok: true });
};
