import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../../_shared';
import { markCalendarEventConfirmed } from '../../_workflow';

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

  let payload: { actorName?: string; actorEmail?: string } = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    await googleApiRequest(
      env,
      `/calendar/v3/calendars/${encodeURIComponent(String(connection?.calendar_id || ''))}/events/${encodeURIComponent(eventId)}`,
      appUserEmail
    );

    await markCalendarEventConfirmed(env, {
      googleEventId: eventId,
      confirmedByName: String(payload.actorName || payload.actorEmail || ''),
      confirmedByEmail: String(payload.actorEmail || appUserEmail)
    });

    return json(200, {
      ok: true,
      workflow: {
        googleEventId: eventId,
        isConfirmed: true,
        confirmedAt: new Date().toISOString(),
        confirmedByName: String(payload.actorName || payload.actorEmail || ''),
        confirmedByEmail: String(payload.actorEmail || appUserEmail)
      }
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to confirm calendar event'
    });
  }
};
