import { Env, json } from '../_shared';

const CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
];

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_REDIRECT_URI) {
    return json(400, {
      ok: false,
      error: 'Google Calendar OAuth 尚未完成設定'
    });
  }

  let payload: { returnTo?: string; appUserEmail?: string } = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const returnTo = String(payload.returnTo || '/').trim() || '/';
  const appUserEmail = String(payload.appUserEmail || '').trim().toLowerCase();
  if (!appUserEmail) {
    return json(400, {
      ok: false,
      error: '目前登入使用者 Email 缺失，無法開始 Google Calendar 連線'
    });
  }
  const statePayload = JSON.stringify({
    returnTo,
    appUserEmail,
    issuedAt: Date.now()
  });
  const state = btoa(statePayload);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CALENDAR_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.GOOGLE_CALENDAR_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', CALENDAR_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('login_hint', appUserEmail);
  url.searchParams.set('state', state);

  return json(200, {
    ok: true,
    authUrl: url.toString()
  });
};
