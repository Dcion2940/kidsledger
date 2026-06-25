import {
  ACCOUNT_SCOPE,
  AppLockEnv,
  cleanupExpiredChallenges,
  createChallenge,
  getAllowedOrigins,
  getRpId,
  getRpName,
  json
} from '../_shared';

export const onRequestPost: PagesFunction<AppLockEnv> = async ({ request, env }) => {
  await cleanupExpiredChallenges(env);

  const rpId = getRpId(request, env);
  const challenge = await createChallenge(env, 'register');

  return json(200, {
    ok: true,
    registration: {
      challengeId: challenge.id,
      publicKey: {
        challenge: challenge.challenge,
        rp: {
          id: rpId,
          name: getRpName(env)
        },
        user: {
          id: challenge.userHandle,
          name: ACCOUNT_SCOPE,
          displayName: 'KidsLedger App Lock'
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required'
        },
        timeout: 300000,
        attestation: 'none',
        excludeCredentials: [],
        extensions: {
          credProps: true
        }
      },
      meta: {
        accountScope: ACCOUNT_SCOPE,
        allowedOrigins: getAllowedOrigins(request),
        expiresAt: challenge.expiresAt
      }
    }
  });
};
