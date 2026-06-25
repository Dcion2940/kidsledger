import { Env, getAppUserEmailFromRequest, googleApiRequest, json } from './_shared';

const normalizeCalendar = (item: any) => ({
  id: String(item?.id || ''),
  summary: String(item?.summary || ''),
  description: String(item?.description || ''),
  primary: item?.primary === true,
  selected: item?.selected === true,
  accessRole: String(item?.accessRole || ''),
  backgroundColor: String(item?.backgroundColor || ''),
  foregroundColor: String(item?.foregroundColor || '')
});

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }
  try {
    const data = await googleApiRequest(
      env,
      '/calendar/v3/users/me/calendarList?minAccessRole=writer&showHidden=false',
      appUserEmail
    );

    const items = Array.isArray(data?.items) ? data.items.map(normalizeCalendar).filter((item) => item.id) : [];
    return json(200, {
      calendars: items
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to list Google calendars'
    });
  }
};
