interface Env {
  DB: D1Database;
}

interface FamilyCashRecordPayload {
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
  const date = String(payload.date || '').trim();
  const type = String(payload.type || '').trim();
  const amount = Number(payload.amount);

  if (!date) return 'Date is required';
  if (type !== 'DEPOSIT' && type !== 'WITHDRAW') return 'Type must be DEPOSIT or WITHDRAW';
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than 0';

  return null;
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Family cash record id is required' });
  }

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
  const result = await env.DB.prepare(
    `
      UPDATE family_cash_records
      SET date = ?, type = ?, amount = ?, actor_name = ?, actor_email = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(
      String(payload.date).trim(),
      String(payload.type).trim(),
      Number(payload.amount),
      String(payload.actorName || '').trim(),
      String(payload.actorEmail || '').trim(),
      now,
      id
    )
    .run();

  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Family cash record not found' });
  }

  return json(200, { ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Family cash record id is required' });
  }

  const result = await env.DB.prepare('DELETE FROM family_cash_records WHERE id = ?').bind(id).run();
  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Family cash record not found' });
  }

  return json(200, { ok: true });
};
