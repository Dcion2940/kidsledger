import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from './_shared';
import { getCalendarWorkflowMap } from './_workflow';

const formatDateOnly = (value: string) => {
  if (!value) return '';
  return value.slice(0, 10);
};

const normalizeCalendarEvent = (item: any, workflow?: any) => {
  const startDateTime = String(item?.start?.dateTime || '');
  const endDateTime = String(item?.end?.dateTime || '');
  const startDate = String(item?.start?.date || formatDateOnly(startDateTime) || '');
  const endDate = String(item?.end?.date || formatDateOnly(endDateTime) || '');
  const allDay = !!item?.start?.date && !item?.start?.dateTime;

  return {
    id: String(item?.id || ''),
    title: String(item?.summary || '未命名事件'),
    description: String(item?.description || ''),
    location: String(item?.location || ''),
    start: startDateTime || startDate,
    end: endDateTime || endDate,
    startDate,
    endDate,
    allDay,
    attendeesCount: Array.isArray(item?.attendees) ? item.attendees.length : 0,
    creatorEmail: String(item?.creator?.email || ''),
    organizerEmail: String(item?.organizer?.email || ''),
    status: String(item?.status || 'confirmed'),
    autoRolloverEnabled: workflow?.autoRolloverEnabled === true,
    isConfirmed: workflow?.isConfirmed === true,
    confirmedAt: String(workflow?.confirmedAt || ''),
    confirmedByName: String(workflow?.confirmedByName || ''),
    rolloverCount: Math.max(0, Number(workflow?.rolloverCount ?? 0) || 0)
  };
};

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const appUserEmail = getAppUserEmailFromRequest(request);
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));

  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return json(400, { ok: false, error: 'Invalid year' });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return json(400, { ok: false, error: 'Invalid month' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }

  const startYear = year;
  const startMonth = String(month).padStart(2, '0');
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = String(month === 12 ? 1 : month + 1).padStart(2, '0');
  const monthStart = `${startYear}-${startMonth}-01T00:00:00+08:00`;
  const monthEnd = `${nextYear}-${nextMonth}-01T00:00:00+08:00`;

  const path =
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    new URLSearchParams({
      timeMin: monthStart,
      timeMax: monthEnd,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500'
    }).toString();

  try {
    const data = await googleApiRequest(env, path, appUserEmail);
    const items = Array.isArray(data?.items) ? data.items : [];
    const workflowMap = await getCalendarWorkflowMap(
      env,
      items.map((item: any) => String(item?.id || ''))
    );
    const events = items
      .map((item: any) => normalizeCalendarEvent(item, workflowMap.get(String(item?.id || ''))))
      .filter((item) => item.id);

    return json(200, {
      events,
      meta: {
        year,
        month,
        calendarId,
        calendarName: String(connection?.calendar_name || '')
      }
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to load Google Calendar events'
    });
  }
};
