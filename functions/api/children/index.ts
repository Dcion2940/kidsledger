interface Env {
  DB: D1Database;
}

interface ChildPayload {
  id?: string;
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

const normalizeRow = (row: any) => ({
  id: String(row.id || ''),
  name: String(row.name || ''),
  avatar: String(row.avatar || ''),
  role: String(row.role || 'CHILD') === 'ADULT' ? 'ADULT' : 'CHILD',
  avatarSeed: String(row.avatar_seed || '')
});

const validatePayload = (payload: ChildPayload) => {
  const id = String(payload.id || '').trim();
  const name = String(payload.name || '').trim();
  const avatar = String(payload.avatar || '').trim();
  const role = String(payload.role || 'CHILD').trim().toUpperCase();

  if (!id) return 'Child id is required';
  if (!name) return 'Name is required';
  if (!avatar) return 'Avatar is required';
  if (role !== 'CHILD' && role !== 'ADULT') return 'Role must be CHILD or ADULT';
  return null;
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, name, avatar, role, avatar_seed FROM children ORDER BY id ASC'
  ).all();

  return json(200, {
    children: (results || []).map(normalizeRow)
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
  await env.DB.prepare(
    `
      INSERT INTO children (id, name, avatar, role, avatar_seed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar = excluded.avatar,
        role = excluded.role,
        avatar_seed = excluded.avatar_seed,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      String(payload.id).trim(),
      String(payload.name).trim(),
      String(payload.avatar).trim(),
      String(payload.role || 'CHILD').trim().toUpperCase(),
      String(payload.avatarSeed || '').trim(),
      now
    )
    .run();

  return json(200, { ok: true });
};
