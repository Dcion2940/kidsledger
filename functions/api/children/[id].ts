interface Env {
  DB: D1Database;
}

interface ChildPayload {
  name?: string;
  avatar?: string;
  role?: string;
  avatarSeed?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

const validatePayload = (payload: ChildPayload) => {
  const name = String(payload.name || '').trim();
  const avatar = String(payload.avatar || '').trim();
  const role = String(payload.role || 'CHILD').trim().toUpperCase();
  if (!name) return 'Name is required';
  if (!avatar) return 'Avatar is required';
  if (role !== 'CHILD' && role !== 'ADULT') return 'Role must be CHILD or ADULT';
  return null;
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Child id is required' });
  }

  let payload: ChildPayload = {};
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
      UPDATE children
      SET name = ?, avatar = ?, role = ?, avatar_seed = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(
      String(payload.name).trim(),
      String(payload.avatar).trim(),
      String(payload.role || 'CHILD').trim().toUpperCase(),
      String(payload.avatarSeed || '').trim(),
      now,
      id
    )
    .run();

  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Child not found' });
  }
  return json(200, { ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Child id is required' });
  }

  const result = await env.DB.prepare('DELETE FROM children WHERE id = ?').bind(id).run();
  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Child not found' });
  }
  return json(200, { ok: true });
};
