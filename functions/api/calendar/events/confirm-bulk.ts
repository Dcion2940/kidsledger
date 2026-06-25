import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../_shared';
import { markCalendarEventConfirmed } from '../_workflow';

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

  let payload: { eventIds?: string[]; actorName?: string; actorEmail?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const eventIds = Array.isArray(payload.eventIds)
    ? Array.from(new Set(payload.eventIds.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];

  if (!eventIds.length) {
    return json(400, { ok: false, error: 'At least one event id is required' });
  }

  try {
    for (const eventId of eventIds) {
      await googleApiRequest(
        env,
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        appUserEmail
      );
      await markCalendarEventConfirmed(env, {
        googleEventId: eventId,
        confirmedByName: String(payload.actorName || payload.actorEmail || ''),
        confirmedByEmail: String(payload.actorEmail || appUserEmail)
      });
    }

    return json(200, {
      ok: true,
      confirmedCount: eventIds.length
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to bulk confirm calendar events'
    });
  }
};
