import { AppLockEnv, json, listPasskeySummaries } from './_shared';

export const onRequestGet: PagesFunction<AppLockEnv> = async ({ env }) => {
  const passkeys = await listPasskeySummaries(env);

  return json(200, {
    ok: true,
    passkeys
  });
};
