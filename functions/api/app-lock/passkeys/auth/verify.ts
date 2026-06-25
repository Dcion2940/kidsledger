import {
  AppLockEnv,
  base64UrlToBytes,
  concatBytes,
  getAllowedOrigins,
  getChallengeRecord,
  getPasskeyByCredentialId,
  getRpId,
  isChallengeUsable,
  json,
  markChallengeUsed,
  parseAuthenticatorData,
  readJson,
  sha256,
  updatePasskeyUsage,
  verifyAssertionSignature,
  createSignedSessionToken,
  verifyClientData,
  verifyRpIdHash
} from '../_shared';

interface AuthVerifyBody {
  challengeId?: string;
  credential?: {
    id?: string;
    rawId?: string;
    response?: {
      clientDataJSON?: string;
      authenticatorData?: string;
      signature?: string;
      userHandle?: string | null;
    };
    type?: string;
  };
}

export const onRequestPost: PagesFunction<AppLockEnv> = async ({ request, env }) => {
  const payload = await readJson<AuthVerifyBody>(request);
  if (!payload) {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const challengeId = String(payload.challengeId || '').trim();
  if (!challengeId) {
    return json(400, { ok: false, error: 'challengeId is required' });
  }

  if (!payload.credential || !payload.credential.response) {
    return json(400, { ok: false, error: 'credential is required' });
  }

  const challenge = await getChallengeRecord(env, challengeId, 'authenticate');
  if (!isChallengeUsable(challenge)) {
    return json(400, { ok: false, error: 'Challenge is invalid or expired' });
  }

  try {
    const credentialId = String(payload.credential.id || '').trim();
    const rawId = String(payload.credential.rawId || '').trim();
    const response = payload.credential.response;
    const clientDataJSON = String(response.clientDataJSON || '').trim();
    const authenticatorData = String(response.authenticatorData || '').trim();
    const signature = String(response.signature || '').trim();

    if (!credentialId || !rawId || !clientDataJSON || !authenticatorData || !signature) {
      return json(400, { ok: false, error: 'Incomplete assertion payload' });
    }
    if (rawId !== credentialId) {
      return json(400, { ok: false, error: 'Credential ID mismatch' });
    }

    const storedPasskey = await getPasskeyByCredentialId(env, credentialId);
    if (!storedPasskey) {
      return json(404, { ok: false, error: 'Passkey not found' });
    }

    const allowedOrigins = getAllowedOrigins(request);
    const rpId = getRpId(request, env);

    const clientDataBytes = base64UrlToBytes(clientDataJSON);
    const authenticatorDataBytes = base64UrlToBytes(authenticatorData);
    const signatureBytes = base64UrlToBytes(signature);

    verifyClientData(clientDataBytes, 'webauthn.get', challenge.challenge, allowedOrigins);

    const parsedAuthData = parseAuthenticatorData(authenticatorDataBytes);
    await verifyRpIdHash(rpId, parsedAuthData.rpIdHash);

    if (!parsedAuthData.userPresent) {
      return json(400, { ok: false, error: 'User presence flag is missing' });
    }
    if (!parsedAuthData.userVerified) {
      return json(400, { ok: false, error: 'User verification is required' });
    }

    const storedCounter = Number(storedPasskey.counter || 0);
    const nextCounter = Number(parsedAuthData.signCount || 0);
    const requiresCounterAdvance = storedCounter > 0 && nextCounter > 0;

    if (requiresCounterAdvance && nextCounter <= storedCounter) {
      return json(400, { ok: false, error: 'Passkey counter did not advance' });
    }

    const clientDataHash = await sha256(clientDataBytes);
    const signedData = concatBytes(authenticatorDataBytes, clientDataHash);
    const isValidSignature = await verifyAssertionSignature(storedPasskey.public_key, signatureBytes, signedData);
    if (!isValidSignature) {
      return json(401, { ok: false, error: 'Invalid passkey signature' });
    }

    await updatePasskeyUsage(env, storedPasskey.id, Math.max(storedCounter, nextCounter));
    await markChallengeUsed(env, challengeId);

    const sessionToken = await createSignedSessionToken(env, {
      scope: 'app-lock',
      method: 'passkey',
      accountScope: storedPasskey.account_scope,
      credentialId,
      passkeyId: storedPasskey.id
    });

    return json(200, {
      ok: true,
      unlock: {
        token: sessionToken,
        expiresInSeconds: 900,
        credentialId,
        passkeyId: storedPasskey.id
      }
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Passkey authentication verification failed'
    });
  }
};
