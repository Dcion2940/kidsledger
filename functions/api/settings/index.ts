interface Env {
  DB: D1Database;
}

interface SettingsPayload {
  googleSheetId?: string;
  aiMentorEnabled?: boolean;
  aiApiLink?: string;
}

const SETTINGS_ID = 'global';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

const normalizeRow = (row: any) => ({
  googleSheetId: String(row?.google_sheet_id || ''),
  aiMentorEnabled: Number(row?.ai_mentor_enabled ?? 1) === 1,
  aiApiLink: String(row?.ai_api_link || '')
});

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const row = await env.DB.prepare(
    'SELECT google_sheet_id, ai_mentor_enabled, ai_api_link FROM app_settings WHERE id = ?'
  )
    .bind(SETTINGS_ID)
    .first();

  if (!row) {
    return json(200, {
      settings: {
        googleSheetId: '',
        aiMentorEnabled: true,
        aiApiLink: ''
      }
    });
  }

  return json(200, { settings: normalizeRow(row) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let payload: SettingsPayload = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const googleSheetId = String(payload.googleSheetId || '').trim();
  const aiMentorEnabled = payload.aiMentorEnabled !== false;
  const aiApiLink = String(payload.aiApiLink || '').trim();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `
      INSERT INTO app_settings (id, google_sheet_id, ai_mentor_enabled, ai_api_link, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        google_sheet_id = excluded.google_sheet_id,
        ai_mentor_enabled = excluded.ai_mentor_enabled,
        ai_api_link = excluded.ai_api_link,
        updated_at = excluded.updated_at
    `
  )
    .bind(SETTINGS_ID, googleSheetId, aiMentorEnabled ? 1 : 0, aiApiLink, now)
    .run();

  return json(200, {
    ok: true,
    settings: {
      googleSheetId,
      aiMentorEnabled,
      aiApiLink
    }
  });
};
