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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { items?: ChildPayload[] } = {};
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
          INSERT INTO children (id, name, avatar, role, avatar_seed, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            avatar = excluded.avatar,
            role = excluded.role,
            avatar_seed = excluded.avatar_seed,
            updated_at = excluded.updated_at
        `
      ).bind(
        String(item.id).trim(),
        String(item.name).trim(),
        String(item.avatar).trim(),
        String(item.role || 'CHILD').trim().toUpperCase(),
        String(item.avatarSeed || '').trim(),
        now
      )
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  return json(200, { ok: true, count: statements.length });
};
