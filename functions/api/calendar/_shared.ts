export interface Env {
  DB: D1Database;
  GOOGLE_CALENDAR_CLIENT_ID?: string;
  GOOGLE_CALENDAR_CLIENT_SECRET?: string;
  GOOGLE_CALENDAR_REDIRECT_URI?: string;
  GOOGLE_CALENDAR_TOKEN_SECRET?: string;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0'
    }
  });

export const normalizeMemberAliases = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    } catch {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
};

export const normalizeCalendarMemberRow = (row: any) => ({
  id: String(row?.id || ''),
  displayName: String(row?.display_name || ''),
  nickname: String(row?.nickname || ''),
  aliases: normalizeMemberAliases(row?.aliases_json),
  email: String(row?.email || ''),
  isActive: Number(row?.is_active ?? 1) === 1,
  createdAt: String(row?.created_at || ''),
  updatedAt: String(row?.updated_at || '')
});

export const normalizeCalendarConnectionRow = (row: any) => ({
  authorized: !!row && !!String(row?.refresh_token_encrypted || '').trim(),
  connected: !!row && !!String(row?.calendar_id || '').trim(),
  provider: String(row?.provider || 'google'),
  googleEmail: String(row?.google_email || ''),
  googleDisplayName: String(row?.google_display_name || ''),
  calendarId: String(row?.calendar_id || ''),
  calendarName: String(row?.calendar_name || ''),
  scope: String(row?.scope || ''),
  tokenExpiresAt: String(row?.token_expires_at || ''),
  updatedAt: String(row?.updated_at || '')
});

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const normalizeAppUserEmail = (value: unknown) => String(value || '').trim().toLowerCase();
export const getCalendarConnectionId = (appUserEmail: string) => `user:${normalizeAppUserEmail(appUserEmail)}`;
export const getAppUserEmailFromRequest = (request: Request) =>
  normalizeAppUserEmail(request.headers.get('x-kidsledger-user-email'));

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const getSecretKey = async (secret: string) => {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

export const encryptSecret = async (plainText: string, secret: string) => {
  const key = await getSecretKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plainText)
  );

  return `${toBase64(iv)}.${toBase64(encrypted)}`;
};

export const decryptSecret = async (cipherText: string, secret: string) => {
  if (!cipherText) return '';
  const [ivPart, payloadPart] = cipherText.split('.');
  if (!ivPart || !payloadPart) {
    throw new Error('Encrypted token format is invalid');
  }

  const key = await getSecretKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    key,
    fromBase64(payloadPart)
  );

  return textDecoder.decode(decrypted);
};

export const parseOAuthState = (state: string | null) => {
  if (!state) return { returnTo: '/' };
  try {
    return JSON.parse(atob(state));
  } catch {
    return { returnTo: '/' };
  }
};

export const buildCalendarRedirectUrl = (requestUrl: string, returnTo: string, params: Record<string, string>) => {
  const base = new URL(returnTo || '/', requestUrl);
  Object.entries(params).forEach(([key, value]) => {
    base.searchParams.set(key, value);
  });
  return base.toString();
};

export const exchangeAuthorizationCode = async (env: Env, code: string) => {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET || !env.GOOGLE_CALENDAR_REDIRECT_URI) {
    throw new Error('Google Calendar OAuth env is incomplete');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALENDAR_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(String(data?.error_description || data?.error || 'Google token exchange failed'));
  }

  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };
};

export const refreshGoogleAccessToken = async (env: Env, refreshToken: string) => {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    throw new Error('Google Calendar OAuth env is incomplete');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(String(data?.error_description || data?.error || 'Google access token refresh failed'));
  }

  return data as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
};

export const fetchGoogleUserProfile = async (accessToken: string) => {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error_description || data?.error || 'Unable to fetch Google user profile'));
  }

  return data as {
    email?: string;
    name?: string;
  };
};

export const saveCalendarConnection = async (
  env: Env,
  payload: {
    appUserEmail: string;
    googleEmail: string;
    googleDisplayName: string;
    calendarId?: string;
    calendarName?: string;
    scope: string;
    refreshToken?: string;
    accessToken: string;
    expiresIn?: number;
  }
) => {
  if (!env.GOOGLE_CALENDAR_TOKEN_SECRET) {
    throw new Error('Google Calendar token secret is not configured');
  }
  const appUserEmail = normalizeAppUserEmail(payload.appUserEmail);
  if (!appUserEmail) {
    throw new Error('App user email is required');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const tokenExpiresAt = payload.expiresIn
    ? new Date(now.getTime() + payload.expiresIn * 1000).toISOString()
    : '';

  const encryptedRefreshToken = payload.refreshToken
    ? await encryptSecret(payload.refreshToken, env.GOOGLE_CALENDAR_TOKEN_SECRET)
    : '';
  const encryptedAccessToken = await encryptSecret(payload.accessToken, env.GOOGLE_CALENDAR_TOKEN_SECRET);

  await env.DB.prepare(
    `
      INSERT INTO calendar_connections (
        id, app_user_email, provider, google_email, google_display_name, calendar_id, calendar_name, scope,
        refresh_token_encrypted, access_token_encrypted, token_expires_at, created_at, updated_at
      )
      VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        app_user_email = excluded.app_user_email,
        google_email = excluded.google_email,
        google_display_name = excluded.google_display_name,
        calendar_id = CASE WHEN excluded.calendar_id = '' THEN calendar_connections.calendar_id ELSE excluded.calendar_id END,
        calendar_name = CASE WHEN excluded.calendar_name = '' THEN calendar_connections.calendar_name ELSE excluded.calendar_name END,
        scope = excluded.scope,
        refresh_token_encrypted = CASE
          WHEN excluded.refresh_token_encrypted = '' THEN calendar_connections.refresh_token_encrypted
          ELSE excluded.refresh_token_encrypted
        END,
        access_token_encrypted = excluded.access_token_encrypted,
        token_expires_at = excluded.token_expires_at,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      getCalendarConnectionId(appUserEmail),
      appUserEmail,
      payload.googleEmail,
      payload.googleDisplayName,
      payload.calendarId || '',
      payload.calendarName || '',
      payload.scope || '',
      encryptedRefreshToken,
      encryptedAccessToken,
      tokenExpiresAt,
      nowIso,
      nowIso
    )
    .run();
};

export const getCalendarConnectionRow = async (env: Env, appUserEmail: string) =>
  env.DB.prepare(
    `
      SELECT id, app_user_email, provider, google_email, google_display_name, calendar_id, calendar_name, scope,
             refresh_token_encrypted, access_token_encrypted, token_expires_at, updated_at
      FROM calendar_connections
      WHERE app_user_email = ?
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `
  )
    .bind(normalizeAppUserEmail(appUserEmail))
    .first();

export const getAuthorizedGoogleAccessToken = async (env: Env, appUserEmail: string) => {
  const normalizedAppUserEmail = normalizeAppUserEmail(appUserEmail);
  const row = await getCalendarConnectionRow(env, normalizedAppUserEmail);
  if (!row) {
    throw new Error('Google Calendar 尚未授權');
  }
  if (!env.GOOGLE_CALENDAR_TOKEN_SECRET) {
    throw new Error('Google Calendar token secret is not configured');
  }

  const refreshToken = await decryptSecret(String(row.refresh_token_encrypted || ''), env.GOOGLE_CALENDAR_TOKEN_SECRET);
  if (!refreshToken) {
    throw new Error('Google Calendar refresh token is missing');
  }

  const refreshed = await refreshGoogleAccessToken(env, refreshToken);
  const encryptedAccessToken = await encryptSecret(refreshed.access_token, env.GOOGLE_CALENDAR_TOKEN_SECRET);
  const tokenExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : '';

  await env.DB.prepare(
    `
      UPDATE calendar_connections
      SET access_token_encrypted = ?, token_expires_at = ?, scope = COALESCE(NULLIF(?, ''), scope), updated_at = ?
      WHERE app_user_email = ?
    `
  )
    .bind(
      encryptedAccessToken,
      tokenExpiresAt,
      String(refreshed.scope || ''),
      new Date().toISOString(),
      normalizedAppUserEmail
    )
    .run();

  return {
    accessToken: refreshed.access_token,
    connection: row
  };
};

export const googleApiRequest = async (
  env: Env,
  path: string,
  appUserEmail: string,
  init?: RequestInit
) => {
  const { accessToken } = await getAuthorizedGoogleAccessToken(env, appUserEmail);
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error?.message || data?.error_description || 'Google Calendar API request failed'));
  }
  return data;
};
