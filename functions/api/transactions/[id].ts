interface Env {
  DB: D1Database;
}

interface TransactionPayload {
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
  const childId = String(payload.childId || '').trim();
  const date = String(payload.date || '').trim();
  const type = String(payload.type || '').trim();
  const category = String(payload.category || '').trim();
  const description = String(payload.description || '').trim();
  const amount = Number(payload.amount);

  if (!childId) return 'Child id is required';
  if (!date) return 'Date is required';
  if (!type) return 'Type is required';
  if (!category) return 'Category is required';
  if (!description) return 'Description is required';
  if (!Number.isFinite(amount)) return 'Amount must be a valid number';

  return null;
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Transaction id is required' });
  }

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
  const result = await env.DB.prepare(
    `
      UPDATE transactions
      SET child_id = ?, date = ?, type = ?, category = ?, amount = ?, description = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(
      String(payload.childId).trim(),
      String(payload.date).trim(),
      String(payload.type).trim(),
      String(payload.category).trim(),
      Number(payload.amount),
      String(payload.description).trim(),
      now,
      id
    )
    .run();

  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Transaction not found' });
  }

  return json(200, { ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Transaction id is required' });
  }

  const result = await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Transaction not found' });
  }

  return json(200, { ok: true });
};
