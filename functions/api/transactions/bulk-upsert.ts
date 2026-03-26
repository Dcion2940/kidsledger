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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { items?: TransactionPayload[] } = {};
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
      ).bind(
        String(item.id).trim(),
        String(item.childId).trim(),
        String(item.date).trim(),
        String(item.type).trim(),
        String(item.category).trim(),
        Number(item.amount),
        String(item.description).trim(),
        now
      )
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  return json(200, { ok: true, count: statements.length });
};
