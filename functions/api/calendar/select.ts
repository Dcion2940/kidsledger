import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, json } from './_shared';

interface SelectPayload {
  calendarId?: string;
  calendarName?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }
  let payload: SelectPayload = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const calendarId = String(payload.calendarId || '').trim();
  const calendarName = String(payload.calendarName || '').trim();
  if (!calendarId) {
    return json(400, { ok: false, error: 'Calendar id is required' });
  }

  const existing = await getCalendarConnectionRow(env, appUserEmail);
  if (!existing) {
    return json(400, { ok: false, error: 'Please authorize Google Calendar first' });
  }

  await env.DB.prepare(
    `
      UPDATE calendar_connections
      SET calendar_id = ?, calendar_name = ?, updated_at = ?
      WHERE app_user_email = ?
    `
  )
    .bind(calendarId, calendarName, new Date().toISOString(), appUserEmail)
    .run();

  return json(200, {
    ok: true,
    connection: {
      authorized: true,
      connected: true,
      provider: String(existing.provider || 'google'),
      googleEmail: String(existing.google_email || ''),
      googleDisplayName: String(existing.google_display_name || ''),
      calendarId,
      calendarName,
      scope: String(existing.scope || ''),
      tokenExpiresAt: String(existing.token_expires_at || ''),
      updatedAt: new Date().toISOString()
    }
  });
};
