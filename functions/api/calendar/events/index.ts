import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../_shared';
import {
  buildTelegramEventPayloadFromGoogleEvent,
  notifyTelegramEventChanged,
  upsertTelegramStartReminderJob
} from '../../_lib/telegram';
import { getCalendarWorkflowMap, upsertCalendarWorkflow } from '../_workflow';
import { buildGoogleEventPayload } from '../_event-payload';

const normalizeReminder = (item: any) => ({
  method: String(item?.method || 'popup') === 'email' ? 'email' : 'popup',
  minutes: Math.max(0, Number(item?.minutes ?? 30) || 0)
});

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
      : []
    ,
    autoRolloverEnabled: workflow?.autoRolloverEnabled === true,
    isConfirmed: workflow?.isConfirmed === true,
    confirmedAt: String(workflow?.confirmedAt || ''),
    confirmedByName: String(workflow?.confirmedByName || ''),
    rolloverCount: Math.max(0, Number(workflow?.rolloverCount ?? 0) || 0)
  };
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
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
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${built.sendUpdates}`,
      appUserEmail,
      {
        method: 'POST',
        body: JSON.stringify(built.payload)
      }
    );

    const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(data, {
      actorName: String(requestPayload?.actorName || ''),
      calendarName: String(connection?.calendar_name || '')
    });

    try {
      await notifyTelegramEventChanged(env, telegramPayload, 'created');
      await upsertTelegramStartReminderJob(env, telegramPayload);
      await upsertCalendarWorkflow(env, {
        googleEventId: String(data?.id || ''),
        autoRolloverEnabled: requestPayload?.autoRolloverEnabled === true,
        isConfirmed: false,
        rolloverCount: 0
      });
    } catch (telegramError) {
      console.error('Calendar create side effects failed:', telegramError);
    }

    const workflowMap = await getCalendarWorkflowMap(env, [String(data?.id || '')]);

    return json(200, {
      ok: true,
      event: normalizeEvent(data, workflowMap.get(String(data?.id || '')))
    });
  } catch (error) {
    console.error('Create Google Calendar event failed:', error);
    return json(400, {
      ok: false,
      error: error instanceof Error ? `Google Calendar 建立失敗：${error.message}` : 'Unable to create calendar event'
    });
  }
};
