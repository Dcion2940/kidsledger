import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../_shared';

const normalizeCandidate = (item: any) => {
  const startDateTime = String(item?.start?.dateTime || '');
  const endDateTime = String(item?.end?.dateTime || '');
  const allDay = !!item?.start?.date && !item?.start?.dateTime;
  const startDate = String(item?.start?.date || startDateTime.slice(0, 10) || '');
  const endDate = String(item?.end?.date || endDateTime.slice(0, 10) || '');

  return {
    id: String(item?.id || ''),
    title: String(item?.summary || ''),
    description: String(item?.description || ''),
    location: String(item?.location || ''),
    startDate,
    endDate,
    startTime: startDateTime ? startDateTime.slice(11, 16) : '',
    endTime: endDateTime ? endDateTime.slice(11, 16) : '',
    allDay,
    status: String(item?.status || '')
  };
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  let payload: { titleKeyword?: string; date?: string; dateRangeStart?: string; dateRangeEnd?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }

  const dateRangeStart = String(payload.dateRangeStart || payload.date || '').trim();
  const dateRangeEnd = String(payload.dateRangeEnd || payload.date || '').trim();
  if (!dateRangeStart || !dateRangeEnd) {
    return json(400, { ok: false, error: 'Date range is required' });
  }

  const path =
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    new URLSearchParams({
      timeMin: `${dateRangeStart}T00:00:00+08:00`,
      timeMax: `${dateRangeEnd}T23:59:59+08:00`,
      singleEvents: 'true',
      orderBy: 'startTime',
      q: String(payload.titleKeyword || '').trim(),
      maxResults: '20'
    }).toString();

  try {
    const data = await googleApiRequest(env, path, appUserEmail);
    const candidates = Array.isArray(data?.items) ? data.items.map(normalizeCandidate).filter((item) => item.id) : [];
    return json(200, { ok: true, candidates });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to resolve calendar events'
    });
  }
};
