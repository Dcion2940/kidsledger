import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../_shared';
import {
  buildTelegramEventPayloadFromGoogleEvent,
  cancelTelegramNotificationJobs,
  notifyTelegramEventChanged,
  upsertTelegramStartReminderJob
} from '../../_lib/telegram';
import { deleteCalendarWorkflow, getCalendarWorkflowMap, upsertCalendarWorkflow } from '../_workflow';

const normalizeReminder = (item: any) => ({
  method: String(item?.method || 'popup') === 'email' ? 'email' : 'popup',
  minutes: Math.max(0, Number(item?.minutes ?? 30) || 0)
});

const shiftDateString = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map((item) => Number(item));
  const base = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const normalizeEvent = (item: any, workflow?: any) => {
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
    endDate: allDay && endDate ? new Date(new Date(`${endDate}T00:00:00`).getTime() - 86400000).toISOString().slice(0, 10) : endDate,
    startTime: startDateTime ? startDateTime.slice(11, 16) : '',
    endTime: endDateTime ? endDateTime.slice(11, 16) : '',
    allDay,
    attendees: Array.isArray(item?.attendees)
      ? item.attendees.map((attendee: any) => ({
          email: String(attendee?.email || ''),
          displayName: String(attendee?.displayName || attendee?.email || ''),
          responseStatus: String(attendee?.responseStatus || '')
        }))
      : [],
    reminders: Array.isArray(item?.reminders?.overrides)
      ? item.reminders.overrides.map(normalizeReminder)
      : [],
    autoRolloverEnabled: workflow?.autoRolloverEnabled === true,
    isConfirmed: workflow?.isConfirmed === true,
    confirmedAt: String(workflow?.confirmedAt || ''),
    confirmedByName: String(workflow?.confirmedByName || ''),
    rolloverCount: Math.max(0, Number(workflow?.rolloverCount ?? 0) || 0)
  };
};

const buildGoogleEventPayload = (payload: any) => {
  const title = String(payload?.title || '').trim();
  const startDate = String(payload?.startDate || '').trim();
  const endDate = String(payload?.endDate || '').trim();
  const startTime = String(payload?.startTime || '').trim();
  const endTime = String(payload?.endTime || '').trim();
  const allDay = payload?.allDay === true;
  const reminders = Array.isArray(payload?.reminders) ? payload.reminders.map(normalizeReminder) : [];

  if (!title) return { error: 'Title is required' };
  if (!startDate) return { error: 'Start date is required' };
  if (!endDate) return { error: 'End date is required' };
  if (!allDay && (!startTime || !endTime)) return { error: 'Start time and end time are required' };
  if (!allDay) {
    const startAt = new Date(`${startDate}T${startTime}:00+08:00`).getTime();
    const endAt = new Date(`${endDate}T${endTime}:00+08:00`).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
      return { error: 'Invalid event time' };
    }
    if (endAt <= startAt) {
      return { error: '結束時間必須晚於開始時間' };
    }
  }

  const start = allDay
    ? { date: startDate }
    : { dateTime: `${startDate}T${startTime}:00+08:00`, timeZone: 'Asia/Taipei' };
  const end = allDay
    ? { date: shiftDateString(endDate, 1) }
    : { dateTime: `${endDate}T${endTime}:00+08:00`, timeZone: 'Asia/Taipei' };
  return {
    payload: {
      summary: title,
      description: String(payload?.description || ''),
      location: String(payload?.location || ''),
      start,
      end,
      reminders: reminders.length
        ? {
            useDefault: false,
            overrides: reminders
          }
        : {
            useDefault: true
          }
    },
    sendUpdates: 'none'
  };
};

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  const eventId = String(params.id || '').trim();

  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }
  if (!eventId) {
    return json(400, { ok: false, error: 'Event id is required' });
  }

  try {
    const data = await googleApiRequest(env, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, appUserEmail);
    const workflowMap = await getCalendarWorkflowMap(env, [eventId]);
    return json(200, {
      event: normalizeEvent(data, workflowMap.get(eventId))
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to load calendar event'
    });
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ env, request, params }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  const eventId = String(params.id || '').trim();

  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }
  if (!eventId) {
    return json(400, { ok: false, error: 'Event id is required' });
  }

  let requestPayload: any = {};
  try {
    requestPayload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const built = buildGoogleEventPayload(requestPayload);
  if ('error' in built) {
    return json(400, { ok: false, error: built.error });
  }

  try {
    const data = await googleApiRequest(
      env,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${built.sendUpdates}`,
      appUserEmail,
      {
        method: 'PUT',
        body: JSON.stringify(built.payload)
      }
    );

    try {
      const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(data, {
        actorName: String(requestPayload?.actorName || ''),
        calendarName: String(connection?.calendar_name || '')
      });
      await notifyTelegramEventChanged(env, telegramPayload, 'updated');
      await upsertTelegramStartReminderJob(env, telegramPayload);
      await upsertCalendarWorkflow(env, {
        googleEventId: String(data?.id || eventId),
        autoRolloverEnabled: requestPayload?.autoRolloverEnabled === true,
        isConfirmed: requestPayload?.isConfirmed === true,
        confirmedAt: requestPayload?.isConfirmed === true ? new Date().toISOString() : '',
        confirmedByName: requestPayload?.isConfirmed === true ? String(requestPayload?.actorName || '') : '',
        confirmedByEmail: requestPayload?.isConfirmed === true ? String(requestPayload?.actorEmail || '') : ''
      });
    } catch (telegramError) {
      console.error('Calendar update side effects failed:', telegramError);
    }

    const workflowMap = await getCalendarWorkflowMap(env, [String(data?.id || eventId)]);

    return json(200, {
      ok: true,
      event: normalizeEvent(data, workflowMap.get(String(data?.id || eventId)))
    });
  } catch (error) {
    console.error('Update Google Calendar event failed:', error);
    return json(400, {
      ok: false,
      error: error instanceof Error ? `Google Calendar 更新失敗：${error.message}` : 'Unable to update calendar event'
    });
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  const eventId = String(params.id || '').trim();

  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }
  if (!eventId) {
    return json(400, { ok: false, error: 'Event id is required' });
  }

  try {
    const existingEvent = await googleApiRequest(
      env,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      appUserEmail
    );

    await googleApiRequest(
      env,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      appUserEmail,
      {
        method: 'DELETE'
      }
    );

    try {
      const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(existingEvent, {
        actorName: String(request.headers.get('x-kidsledger-user-name') || request.headers.get('x-kidsledger-user-email') || ''),
        calendarName: String(connection?.calendar_name || '')
      });
      await notifyTelegramEventChanged(env, telegramPayload, 'deleted');
      await cancelTelegramNotificationJobs(env, eventId);
      await deleteCalendarWorkflow(env, eventId);
    } catch (telegramError) {
      console.error('Telegram reminder job cancel failed:', telegramError);
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error('Delete Google Calendar event failed:', error);
    return json(400, {
      ok: false,
      error: error instanceof Error ? `Google Calendar 刪除失敗：${error.message}` : 'Unable to delete calendar event'
    });
  }
};
