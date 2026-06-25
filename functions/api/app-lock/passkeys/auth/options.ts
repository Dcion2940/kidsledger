import {
  ACCOUNT_SCOPE,
  AppLockEnv,
  cleanupExpiredChallenges,
  createChallenge,
  getActivePasskeys,
  getAllowedOrigins,
  getRpId,
  json
} from '../_shared';

export const onRequestPost: PagesFunction<AppLockEnv> = async ({ request, env }) => {
  await cleanupExpiredChallenges(env);

  const rpId = getRpId(request, env);
  const challenge = await createChallenge(env, 'authenticate');
  const passkeys = await getActivePasskeys(env);

  return json(200, {
    ok: true,
    authentication: {
      challengeId: challenge.id,
      publicKey: {
        challenge: challenge.challenge,
        rpId,
        timeout: 300000,
        userVerification: 'required',
        allowCredentials: passkeys
          .filter((item) => item.credentialId)
          .map((item) => {
            let transports: string[] = [];
            try {
              const parsed = JSON.parse(item.transports);
              transports = Array.isArray(parsed) ? parsed : [];
            } catch {
              transports = [];
            }

            return {
              id: item.credentialId,
              type: 'public-key',
              transports
            };
          })
      },
      meta: {
        accountScope: ACCOUNT_SCOPE,
        allowedOrigins: getAllowedOrigins(request),
        expiresAt: challenge.expiresAt,
        registeredPasskeys: passkeys.length
      }
    }
  });
};
