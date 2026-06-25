import { Env, getAppUserEmailFromRequest, json, normalizeCalendarConnectionRow } from './_shared';

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }
  const [connectionRow, membersResult] = await Promise.all([
    env.DB.prepare(
      `
        SELECT provider, google_email, google_display_name, calendar_id, calendar_name, scope, refresh_token_encrypted, token_expires_at, updated_at
        FROM calendar_connections
        WHERE app_user_email = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `
    )
      .bind(appUserEmail)
      .first(),
    env.DB.prepare(
      'SELECT COUNT(*) AS count FROM calendar_members WHERE is_active = 1'
    ).first()
  ]);

  const connection = normalizeCalendarConnectionRow(connectionRow);

  return json(200, {
    connection,
    available: {
      oauthConfigured:
        !!env.GOOGLE_CALENDAR_CLIENT_ID &&
        !!env.GOOGLE_CALENDAR_CLIENT_SECRET &&
        !!env.GOOGLE_CALENDAR_REDIRECT_URI
    },
    members: {
      activeCount: Number(membersResult?.count || 0)
    }
  });
};
