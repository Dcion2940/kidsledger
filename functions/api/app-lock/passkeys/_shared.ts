export interface AppLockEnv {
  DB: D1Database;
  APP_LOCK_RP_ID?: string;
  APP_LOCK_RP_NAME?: string;
  APP_LOCK_SESSION_SECRET?: string;
}

export interface ChallengeRow {
  id: string;
  flow_type: string;
  account_scope: string;
  challenge: string;
  user_handle: string;
  expires_at: string;
  used_at: string;
  created_at: string;
}

export interface StoredPasskey {
  id: string;
  account_scope: string;
  credential_id: string;
  public_key: string;
  counter: number;
  device_name: string;
  transports: string;
  rp_id: string;
  created_at: string;
  updated_at: string;
  last_used_at: string;
  revoked_at: string;
}

export const ACCOUNT_SCOPE = 'family-default';
export const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000;
export const REGISTER_FLOW = 'register';
export const AUTH_FLOW = 'authenticate';

export const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const readJson = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

export const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
};

export const createRandomBase64Url = (size = 32) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const utf8ToString = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export const sha256 = async (input: string | Uint8Array) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
};

export const concatBytes = (...chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, item) => sum + item.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

type CborValue = string | number | boolean | null | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

const readCborLength = (bytes: Uint8Array, offset: number, additionalInfo: number) => {
  if (additionalInfo < 24) {
    return { value: additionalInfo, offset };
  }
  if (additionalInfo === 24) {
    return { value: bytes[offset], offset: offset + 1 };
  }
  if (additionalInfo === 25) {
    return {
      value: (bytes[offset] << 8) | bytes[offset + 1],
      offset: offset + 2
    };
  }
  if (additionalInfo === 26) {
    return {
      value:
        (bytes[offset] * 2 ** 24) +
        (bytes[offset + 1] << 16) +
        (bytes[offset + 2] << 8) +
        bytes[offset + 3],
      offset: offset + 4
    };
  }
  throw new Error(`Unsupported CBOR additional info: ${additionalInfo}`);
};

const decodeCborItem = (bytes: Uint8Array, startOffset = 0): { value: CborValue; offset: number } => {
  const initial = bytes[startOffset];
  const majorType = initial >> 5;
  const additionalInfo = initial & 0x1f;
  let offset = startOffset + 1;

  if (majorType === 0) {
    const length = readCborLength(bytes, offset, additionalInfo);
    return { value: length.value, offset: length.offset };
  }

  if (majorType === 1) {
    const length = readCborLength(bytes, offset, additionalInfo);
    return { value: -1 - length.value, offset: length.offset };
  }

  if (majorType === 2 || majorType === 3) {
    const length = readCborLength(bytes, offset, additionalInfo);
    const valueBytes = bytes.slice(length.offset, length.offset + length.value);
    return {
      value: majorType === 2 ? valueBytes : utf8ToString(valueBytes),
      offset: length.offset + length.value
    };
  }

  if (majorType === 4) {
    const length = readCborLength(bytes, offset, additionalInfo);
    offset = length.offset;
    const items: CborValue[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const decoded = decodeCborItem(bytes, offset);
      items.push(decoded.value);
      offset = decoded.offset;
    }
    return { value: items, offset };
  }

  if (majorType === 5) {
    const length = readCborLength(bytes, offset, additionalInfo);
    offset = length.offset;
    const map = new Map<CborValue, CborValue>();
    for (let index = 0; index < length.value; index += 1) {
      const key = decodeCborItem(bytes, offset);
      const value = decodeCborItem(bytes, key.offset);
      map.set(key.value, value.value);
      offset = value.offset;
    }
    return { value: map, offset };
  }

  if (majorType === 7) {
    if (additionalInfo === 20) return { value: false, offset };
    if (additionalInfo === 21) return { value: true, offset };
    if (additionalInfo === 22) return { value: null, offset };
  }

  throw new Error(`Unsupported CBOR major type: ${majorType}`);
};

export const decodeCbor = (bytes: Uint8Array) => decodeCborItem(bytes).value;

export const mapToObject = (value: CborValue) => {
  if (!(value instanceof Map)) {
    throw new Error('Expected CBOR map');
  }
  return value;
};

export const parseAuthenticatorData = (authData: Uint8Array) => {
  if (authData.length < 37) {
    throw new Error('Authenticator data is too short');
  }

  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount =
    (authData[33] << 24) |
    (authData[34] << 16) |
    (authData[35] << 8) |
    authData[36];
  const attestedCredentialData = (flags & 0x40) !== 0;
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;

  if (!attestedCredentialData) {
    return {
      rpIdHash,
      flags,
      signCount,
      userPresent,
      userVerified
    };
  }

  const aaguid = authData.slice(37, 53);
  const credentialIdLength = (authData[53] << 8) | authData[54];
  const credentialId = authData.slice(55, 55 + credentialIdLength);
  const coseKeyBytes = authData.slice(55 + credentialIdLength);
  const coseKeyDecoded = decodeCborItem(coseKeyBytes);
  const coseKey = mapToObject(coseKeyDecoded.value);

  return {
    rpIdHash,
    flags,
    signCount,
    userPresent,
    userVerified,
    aaguid,
    credentialId,
    coseKey
  };
};

export const coseToJwk = (coseKey: Map<CborValue, CborValue>): JsonWebKey => {
  const kty = Number(coseKey.get(1));

  if (kty === 2) {
    const crv = Number(coseKey.get(-1));
    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      throw new Error('Invalid EC2 public key');
    }
    if (crv !== 1) {
      throw new Error('Unsupported EC curve');
    }

    return {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(x),
      y: bytesToBase64Url(y),
      ext: true
    };
  }

  if (kty === 3) {
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new Error('Invalid RSA public key');
    }

    return {
      kty: 'RSA',
      n: bytesToBase64Url(n),
      e: bytesToBase64Url(e),
      ext: true
    };
  }

  throw new Error(`Unsupported COSE key type: ${kty}`);
};

export const verifyClientData = (clientDataJson: Uint8Array, expectedType: string, expectedChallenge: string, allowedOrigins: string[]) => {
  const parsed = JSON.parse(utf8ToString(clientDataJson)) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };

  if (parsed.type !== expectedType) {
    throw new Error(`Unexpected clientData type: ${parsed.type || 'unknown'}`);
  }
  if (parsed.challenge !== expectedChallenge) {
    throw new Error('Challenge mismatch');
  }
  if (!allowedOrigins.includes(String(parsed.origin || ''))) {
    throw new Error('Origin mismatch');
  }

  return parsed;
};

export const verifyRpIdHash = async (rpId: string, actualHash: Uint8Array) => {
  const expectedHash = await sha256(rpId);
  if (!bytesEqual(expectedHash, actualHash)) {
    throw new Error('RP ID hash mismatch');
  }
};

export const markChallengeUsed = async (env: AppLockEnv, challengeId: string) => {
  await env.DB.prepare(
    'UPDATE app_lock_challenges SET used_at = ? WHERE id = ?'
  )
    .bind(new Date().toISOString(), challengeId)
    .run();
};

export const insertPasskey = async (
  env: AppLockEnv,
  record: {
    credentialId: string;
    publicKey: JsonWebKey;
    counter: number;
    deviceName: string;
    transports: string[];
    rpId: string;
  }
) => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `
      INSERT INTO app_lock_passkeys (
        id, account_scope, credential_id, public_key, counter, device_name, transports, rp_id, created_at, updated_at, last_used_at, revoked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      ACCOUNT_SCOPE,
      record.credentialId,
      JSON.stringify(record.publicKey),
      record.counter,
      record.deviceName,
      JSON.stringify(record.transports),
      record.rpId,
      now,
      now,
      '',
      ''
    )
    .run();

  return id;
};

export const getPasskeyByCredentialId = async (env: AppLockEnv, credentialId: string) => {
  const row = await env.DB.prepare(
    `
      SELECT id, account_scope, credential_id, public_key, counter, device_name, transports, rp_id, created_at, updated_at, last_used_at, revoked_at
      FROM app_lock_passkeys
      WHERE account_scope = ? AND credential_id = ? AND revoked_at = ?
    `
  )
    .bind(ACCOUNT_SCOPE, credentialId, '')
    .first<StoredPasskey>();

  return row || null;
};

export const updatePasskeyUsage = async (env: AppLockEnv, id: string, nextCounter: number) => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      UPDATE app_lock_passkeys
      SET counter = ?, last_used_at = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(nextCounter, now, now, id)
    .run();
};

export const importStoredPublicKey = async (publicKeyJson: string) => {
  const publicKey = JSON.parse(publicKeyJson) as JsonWebKey;

  if (publicKey.kty === 'EC') {
    return crypto.subtle.importKey(
      'jwk',
      publicKey,
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      false,
      ['verify']
    );
  }

  if (publicKey.kty === 'RSA') {
    return crypto.subtle.importKey(
      'jwk',
      publicKey,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    );
  }

  throw new Error('Unsupported stored public key type');
};

const derToRawEcdsaSignature = (signature: Uint8Array, componentLength = 32) => {
  if (signature.length < 8 || signature[0] !== 0x30) {
    throw new Error('Invalid DER ECDSA signature');
  }

  let offset = 1;
  const sequenceLength = signature[offset];
  offset += 1;

  if (sequenceLength + 2 !== signature.length) {
    throw new Error('Unexpected DER sequence length');
  }

  if (signature[offset] !== 0x02) {
    throw new Error('Invalid DER integer marker for r');
  }
  offset += 1;
  const rLength = signature[offset];
  offset += 1;
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;

  if (signature[offset] !== 0x02) {
    throw new Error('Invalid DER integer marker for s');
  }
  offset += 1;
  const sLength = signature[offset];
  offset += 1;
  const s = signature.slice(offset, offset + sLength);

  const normalizeComponent = (value: Uint8Array) => {
    let normalized = value;
    while (normalized.length > componentLength && normalized[0] === 0) {
      normalized = normalized.slice(1);
    }
    if (normalized.length > componentLength) {
      throw new Error('ECDSA signature component is too large');
    }
    if (normalized.length === componentLength) {
      return normalized;
    }
    const padded = new Uint8Array(componentLength);
    padded.set(normalized, componentLength - normalized.length);
    return padded;
  };

  const normalizedR = normalizeComponent(r);
  const normalizedS = normalizeComponent(s);
  return concatBytes(normalizedR, normalizedS);
};

export const verifyAssertionSignature = async (publicKeyJson: string, signature: Uint8Array, signedData: Uint8Array) => {
  const key = await importStoredPublicKey(publicKeyJson);
  const parsed = JSON.parse(publicKeyJson) as JsonWebKey;

  if (parsed.kty === 'EC') {
    const directResult = await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: 'SHA-256'
      },
      key,
      signature,
      signedData
    );
    if (directResult) {
      return true;
    }

    try {
      const rawSignature = derToRawEcdsaSignature(signature);
      return crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: 'SHA-256'
        },
        key,
        rawSignature,
        signedData
      );
    } catch {
      return false;
    }
  }

  if (parsed.kty === 'RSA') {
    return crypto.subtle.verify(
      {
        name: 'RSASSA-PKCS1-v1_5'
      },
      key,
      signature,
      signedData
    );
  }

  return false;
};

export const createSignedSessionToken = async (
  env: AppLockEnv,
  payload: Record<string, unknown>,
  lifetimeSeconds = 900
) => {
  const secret = String(env.APP_LOCK_SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('APP_LOCK_SESSION_SECRET is not configured');
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + lifetimeSeconds
  };

  const encodedHeader = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedBody = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signingInput));
  const signature = bytesToBase64Url(new Uint8Array(signatureBuffer));

  return `${signingInput}.${signature}`;
};

export const cleanupExpiredChallenges = async (env: AppLockEnv) => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'DELETE FROM app_lock_challenges WHERE expires_at <= ? OR used_at <> ?'
  )
    .bind(now, '')
    .run();
};

export const createChallenge = async (env: AppLockEnv, flowType: string) => {
  const now = new Date();
  const challenge = createRandomBase64Url(32);
  const userHandle = createRandomBase64Url(24);
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TIMEOUT_MS).toISOString();
  const createdAt = now.toISOString();

  await env.DB.prepare(
    `
      INSERT INTO app_lock_challenges (id, flow_type, account_scope, challenge, user_handle, expires_at, used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(id, flowType, ACCOUNT_SCOPE, challenge, userHandle, expiresAt, '', createdAt)
    .run();

  return {
    id,
    challenge,
    userHandle,
    expiresAt
  };
};

export const getRpId = (request: Request, env: AppLockEnv) =>
  String(env.APP_LOCK_RP_ID || new URL(request.url).hostname).trim();

export const getRpName = (env: AppLockEnv) =>
  String(env.APP_LOCK_RP_NAME || 'KidsLedger').trim();

export const getAllowedOrigins = (request: Request) => {
  const url = new URL(request.url);
  return [`${url.protocol}//${url.host}`];
};

export const getActivePasskeys = async (env: AppLockEnv) => {
  const { results } = await env.DB.prepare(
    `
      SELECT credential_id, transports
      FROM app_lock_passkeys
      WHERE account_scope = ? AND revoked_at = ?
      ORDER BY created_at ASC
    `
  )
    .bind(ACCOUNT_SCOPE, '')
    .all();

  return (results || []).map((row: any) => ({
    credentialId: String(row.credential_id || ''),
    transports: String(row.transports || '[]')
  }));
};

export const getChallengeRecord = async (env: AppLockEnv, challengeId: string, flowType: string) => {
  const row = await env.DB.prepare(
    `
      SELECT id, flow_type, account_scope, challenge, user_handle, expires_at, used_at, created_at
      FROM app_lock_challenges
      WHERE id = ? AND flow_type = ? AND account_scope = ?
    `
  )
    .bind(challengeId, flowType, ACCOUNT_SCOPE)
    .first<ChallengeRow>();

  return row || null;
};

export const isChallengeUsable = (row: ChallengeRow | null) => {
  if (!row) return false;
  if (row.used_at) return false;
  return row.expires_at > new Date().toISOString();
};

export const listPasskeySummaries = async (env: AppLockEnv) => {
  const { results } = await env.DB.prepare(
    `
      SELECT id, device_name, transports, rp_id, created_at, updated_at, last_used_at
      FROM app_lock_passkeys
      WHERE account_scope = ? AND revoked_at = ?
      ORDER BY created_at DESC
    `
  )
    .bind(ACCOUNT_SCOPE, '')
    .all();

  return (results || []).map((row: any) => ({
    id: String(row.id || ''),
    deviceName: String(row.device_name || ''),
    transports: (() => {
      try {
        const parsed = JSON.parse(String(row.transports || '[]'));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
    rpId: String(row.rp_id || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    lastUsedAt: String(row.last_used_at || '')
  }));
};
