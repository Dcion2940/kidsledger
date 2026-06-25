import { ACCOUNT_SCOPE, AppLockEnv, json } from './_shared';

export const onRequestDelete: PagesFunction<AppLockEnv> = async ({ env, params }) => {
  const id = String(params.id || '').trim();
  if (!id) {
    return json(400, { ok: false, error: 'Passkey id is required' });
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `
      UPDATE app_lock_passkeys
      SET revoked_at = ?, updated_at = ?
      WHERE id = ? AND account_scope = ? AND revoked_at = ?
    `
  )
    .bind(now, now, id, ACCOUNT_SCOPE, '')
    .run();

  if (!result.meta?.changes) {
    return json(404, { ok: false, error: 'Passkey not found' });
  }

  return json(200, { ok: true });
};
