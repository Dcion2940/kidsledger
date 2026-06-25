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

const normalizeRow = (row: any) => ({
  id: String(row.id || ''),
  date: String(row.date || ''),
  type: String(row.type || ''),
  amount: Number(row.amount || 0),
  actorName: String(row.actor_name || ''),
  actorEmail: String(row.actor_email || '')
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

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, date, type, amount, actor_name, actor_email FROM family_cash_records ORDER BY date DESC, id DESC'
  ).all();

  return json(200, {
    records: (results || []).map(normalizeRow)
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: FamilyCashRecordPayload = {};
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
  )
    .bind(
      String(payload.id).trim(),
      String(payload.date).trim(),
      String(payload.type).trim(),
      Number(payload.amount),
      String(payload.actorName || '').trim(),
      String(payload.actorEmail || '').trim(),
      now
    )
    .run();

  return json(200, { ok: true });
};
