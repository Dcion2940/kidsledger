import {
  AppLockEnv,
  base64UrlToBytes,
  bytesToBase64Url,
  coseToJwk,
  decodeCbor,
  getAllowedOrigins,
  getChallengeRecord,
  getPasskeyByCredentialId,
  getRpId,
  isChallengeUsable,
  insertPasskey,
  json,
  markChallengeUsed,
  mapToObject,
  parseAuthenticatorData,
  readJson
} from '../_shared';

interface RegisterVerifyBody {
  challengeId?: string;
  credential?: {
    id?: string;
    rawId?: string;
    response?: {
      clientDataJSON?: string;
      attestationObject?: string;
      transports?: string[];
    };
    type?: string;
  };
  deviceName?: string;
}

export const onRequestPost: PagesFunction<AppLockEnv> = async ({ request, env }) => {
  const payload = await readJson<RegisterVerifyBody>(request);
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

  const challenge = await getChallengeRecord(env, challengeId, 'register');
  if (!isChallengeUsable(challenge)) {
    return json(400, { ok: false, error: 'Challenge is invalid or expired' });
  }

  try {
    const credentialId = String(payload.credential.id || '').trim();
    const rawId = String(payload.credential.rawId || '').trim();
    const response = payload.credential.response;
    const clientDataJSON = String(response.clientDataJSON || '').trim();
    const attestationObject = String(response.attestationObject || '').trim();

    if (!credentialId || !rawId || !clientDataJSON || !attestationObject) {
      return json(400, { ok: false, error: 'Incomplete credential payload' });
    }

    const existingPasskey = await getPasskeyByCredentialId(env, credentialId);
    if (existingPasskey) {
      return json(409, { ok: false, error: 'This passkey is already registered' });
    }

    const allowedOrigins = getAllowedOrigins(request);
    const rpId = getRpId(request, env);

    const clientDataBytes = base64UrlToBytes(clientDataJSON);
    const attestationBytes = base64UrlToBytes(attestationObject);

    const attestation = mapToObject(decodeCbor(attestationBytes));
    const authData = attestation.get('authData');
    if (!(authData instanceof Uint8Array)) {
      return json(400, { ok: false, error: 'Invalid attestation payload' });
    }

    const parsedAuthData = parseAuthenticatorData(authData);
    if (!('credentialId' in parsedAuthData) || !parsedAuthData.credentialId || !parsedAuthData.coseKey) {
      return json(400, { ok: false, error: 'Attested credential data is missing' });
    }

    const decodedRawId = base64UrlToBytes(rawId);
    if (bytesToBase64Url(parsedAuthData.credentialId) !== credentialId || bytesToBase64Url(decodedRawId) !== credentialId) {
      return json(400, { ok: false, error: 'Credential ID mismatch' });
    }

    const parsedClientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
    if (parsedClientData.type !== 'webauthn.create') {
      return json(400, { ok: false, error: 'Unexpected WebAuthn ceremony type' });
    }
    if (parsedClientData.challenge !== challenge.challenge) {
      return json(400, { ok: false, error: 'Challenge mismatch' });
    }
    if (!allowedOrigins.includes(String(parsedClientData.origin || ''))) {
      return json(400, { ok: false, error: 'Origin mismatch' });
    }

    const expectedRpIdHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId));
    const expectedRpIdHashBytes = new Uint8Array(expectedRpIdHash);
    if (bytesToBase64Url(expectedRpIdHashBytes) !== bytesToBase64Url(parsedAuthData.rpIdHash)) {
      return json(400, { ok: false, error: 'RP ID mismatch' });
    }
    if (!parsedAuthData.userPresent) {
      return json(400, { ok: false, error: 'User presence flag is missing' });
    }
    if (!parsedAuthData.userVerified) {
      return json(400, { ok: false, error: 'User verification is required' });
    }

    const publicKey = coseToJwk(parsedAuthData.coseKey);
    const passkeyId = await insertPasskey(env, {
      credentialId,
      publicKey,
      counter: parsedAuthData.signCount,
      deviceName: String(payload.deviceName || '').trim() || '未命名裝置',
      transports: Array.isArray(response.transports) ? response.transports.map((item) => String(item)) : [],
      rpId
    });

    await markChallengeUsed(env, challengeId);

    return json(200, {
      ok: true,
      passkey: {
        id: passkeyId,
        credentialId,
        deviceName: String(payload.deviceName || '').trim() || '未命名裝置',
        rpId
      }
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Passkey registration verification failed'
    });
  }
};
