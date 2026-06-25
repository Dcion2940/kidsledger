interface Env {
  DB: D1Database;
}

interface FamilyCashRecordPayload {
  id?: string;
  date?: string;
  type?: string;
  amount?: number;
  actorName?: string;
  actorEmail?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

const validatePayload = (payload: FamilyCashRecordPayload) => {
  const id = String(payload.id || '').trim();
  const date = String(payload.date || '').trim();
  const type = String(payload.type || '').trim();
  const amount = Number(payload.amount);

  if (!id) return 'Family cash record id is required';
  if (!date) return 'Date is required';
  if (type !== 'DEPOSIT' && type !== 'WITHDRAW') return 'Type must be DEPOSIT or WITHDRAW';
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than 0';

  return null;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { items?: FamilyCashRecordPayload[] } = {};
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
          INSERT INTO family_cash_records (id, date, type, amount, actor_name, actor_email, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            date = excluded.date,
            type = excluded.type,
            amount = excluded.amount,
            actor_name = excluded.actor_name,
            actor_email = excluded.actor_email,
            updated_at = excluded.updated_at
        `
      ).bind(
        String(item.id).trim(),
        String(item.date).trim(),
        String(item.type).trim(),
        Number(item.amount),
        String(item.actorName || '').trim(),
        String(item.actorEmail || '').trim(),
        now
      )
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  return json(200, { ok: true, count: statements.length });
};
