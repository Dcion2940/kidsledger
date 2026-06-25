import {
  buildCalendarRedirectUrl,
  exchangeAuthorizationCode,
  fetchGoogleUserProfile,
  getCalendarConnectionRow,
  json,
  parseOAuthState,
  saveCalendarConnection,
  Env
} from '../_shared';

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = parseOAuthState(url.searchParams.get('state'));
  const returnTo = typeof state?.returnTo === 'string' ? state.returnTo : '/';
  const appUserEmail = String(state?.appUserEmail || '').trim().toLowerCase();

  if (error) {
    return Response.redirect(
      buildCalendarRedirectUrl(request.url, returnTo, {
        calendar_oauth: 'error',
        calendar_message: error
      }),
      302
    );
  }

  if (!code) {
    return json(400, { ok: false, error: 'Missing Google authorization code' });
  }

  try {
    if (!appUserEmail) {
      throw new Error('缺少目前登入使用者資訊，請重新發起 Google Calendar 授權');
    }
    const existingConnection = await getCalendarConnectionRow(env, appUserEmail);
    const tokenData = await exchangeAuthorizationCode(env, code);
    const profile = await fetchGoogleUserProfile(tokenData.access_token);

    if (!tokenData.refresh_token && !String(existingConnection?.refresh_token_encrypted || '').trim()) {
      throw new Error('Google 未回傳 refresh token，請重新授權並允許離線存取');
    }

    await saveCalendarConnection(env, {
      appUserEmail,
      googleEmail: String(profile.email || ''),
      googleDisplayName: String(profile.name || profile.email || ''),
      scope: String(tokenData.scope || ''),
      refreshToken: tokenData.refresh_token,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in
    });

    return Response.redirect(
      buildCalendarRedirectUrl(request.url, returnTo, {
        calendar_oauth: 'success'
      }),
      302
    );
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : 'Google Calendar OAuth callback failed';
    return Response.redirect(
      buildCalendarRedirectUrl(request.url, returnTo, {
        calendar_oauth: 'error',
        calendar_message: message
      }),
      302
    );
  }
};
