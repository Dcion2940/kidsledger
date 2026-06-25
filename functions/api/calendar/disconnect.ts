import { Env, getAppUserEmailFromRequest, json } from './_shared';

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  await env.DB.prepare('DELETE FROM calendar_connections WHERE app_user_email = ?')
    .bind(appUserEmail)
    .run();

  return json(200, { ok: true });
};
