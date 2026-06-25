import { Env, isValidEmail, json, normalizeCalendarMemberRow, normalizeMemberAliases } from '../_shared';

interface CalendarMemberPayload {
  id?: string;
  displayName?: string;
  nickname?: string;
  aliases?: string[];
  email?: string;
  isActive?: boolean;
}

const validateMember = (payload: CalendarMemberPayload) => {
  const id = String(payload.id || '').trim();
  const displayName = String(payload.displayName || '').trim();
  const nickname = String(payload.nickname || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();

  if (!id) return 'Member id is required';
  if (!displayName) return 'Display name is required';
  if (!nickname) return 'Nickname is required';
  if (!email) return 'Email is required';
  if (!isValidEmail(email)) return 'Email format is invalid';
  return null;
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `
      SELECT id, display_name, nickname, aliases_json, email, is_active, created_at, updated_at
      FROM calendar_members
      ORDER BY is_active DESC, nickname COLLATE NOCASE ASC, display_name COLLATE NOCASE ASC
    `
  ).all();

  return json(200, {
    members: (results || []).map(normalizeCalendarMemberRow)
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  let payload: { items?: CalendarMemberPayload[] } = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return json(400, { ok: false, error: 'At least one member is required' });
  }

  for (const item of items) {
    const error = validateMember(item);
    if (error) {
      return json(400, { ok: false, error });
    }
  }

  const seenIds = new Set<string>();
  for (const item of items) {
    const id = String(item.id || '').trim();
    if (seenIds.has(id)) {
      return json(400, { ok: false, error: `Duplicate member id: ${id}` });
    }
    seenIds.add(id);
  }

  const now = new Date().toISOString();
  await env.DB.batch(
    items.map((item) =>
      env.DB.prepare(
        `
          INSERT INTO calendar_members (id, display_name, nickname, aliases_json, email, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM calendar_members WHERE id = ?), ?), ?)
          ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            nickname = excluded.nickname,
            aliases_json = excluded.aliases_json,
            email = excluded.email,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at
        `
      ).bind(
        String(item.id || '').trim(),
        String(item.displayName || '').trim(),
        String(item.nickname || '').trim(),
        JSON.stringify(normalizeMemberAliases(item.aliases || [])),
        String(item.email || '').trim().toLowerCase(),
        item.isActive === false ? 0 : 1,
        String(item.id || '').trim(),
        now,
        now
      )
    )
  );

  const { results } = await env.DB.prepare(
    `
      SELECT id, display_name, nickname, aliases_json, email, is_active, created_at, updated_at
      FROM calendar_members
      ORDER BY is_active DESC, nickname COLLATE NOCASE ASC, display_name COLLATE NOCASE ASC
    `
  ).all();

  return json(200, {
    ok: true,
    members: (results || []).map(normalizeCalendarMemberRow)
  });
};
