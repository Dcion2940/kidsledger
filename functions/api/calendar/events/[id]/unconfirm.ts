import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../../_shared';
import { markCalendarEventUnconfirmed } from '../../_workflow';

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  if (!String(connection?.calendar_id || '').trim()) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }

  const eventId = String(params.id || '').trim();
  if (!eventId) {
    return json(400, { ok: false, error: 'Event id is required' });
  }

  try {
    await googleApiRequest(
      env,
      `/calendar/v3/calendars/${encodeURIComponent(String(connection?.calendar_id || ''))}/events/${encodeURIComponent(eventId)}`,
      appUserEmail
    );

    await markCalendarEventUnconfirmed(env, { googleEventId: eventId });

    return json(200, {
      ok: true,
      workflow: {
        googleEventId: eventId,
        isConfirmed: false,
        confirmedAt: '',
        confirmedByName: '',
        confirmedByEmail: ''
      }
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to unconfirm calendar event'
    });
  }
};
