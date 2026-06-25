import { Env, googleApiRequest } from '../_shared';
import {
  buildTelegramEventPayloadFromGoogleEvent,
  notifyTelegramEventChanged,
  upsertTelegramStartReminderJob
} from '../../_lib/telegram';
import { getCalendarWorkflowMap, upsertCalendarWorkflow } from '../_workflow';

export interface CalendarRolloverEnv extends Env {
  TELEGRAM_TOKEN_SECRET?: string;
  TELEGRAM_JOB_SECRET?: string;
}

interface ProcessCalendarRolloversOptions {
  targetDate?: string;
  dryRun?: boolean;
}

const shiftDateString = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map((item) => Number(item));
  const base = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const formatTaipeiDate = (date: Date) => {
  const taipei = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const year = taipei.getFullYear();
  const month = `${taipei.getMonth() + 1}`.padStart(2, '0');
  const day = `${taipei.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getYesterdayInTaipei = () => {
  const now = new Date();
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  taipei.setDate(taipei.getDate() - 1);
  return formatTaipeiDate(taipei);
};

export const processCalendarRollovers = async (
  env: CalendarRolloverEnv,
  options: ProcessCalendarRolloversOptions = {}
) => {
  const { results } = await env.DB.prepare(
    `
      SELECT google_event_id, rollover_count
      FROM calendar_event_workflow
      WHERE auto_rollover_enabled = 1 AND is_confirmed = 0
      ORDER BY updated_at ASC
      LIMIT 50
    `
  ).all();

  const yesterday = String(options.targetDate || '').trim() || getYesterdayInTaipei();
  const dryRun = options.dryRun === true;
  let processed = 0;
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const row of results || []) {
    const eventId = String((row as any)?.google_event_id || '');
    const rolloverCount = Math.max(0, Number((row as any)?.rollover_count ?? 0) || 0);
    if (!eventId) continue;
    if (rolloverCount >= 7) {
      diagnostics.push({ eventId, status: 'skipped', reason: 'rollover_limit_reached' });
      continue;
    }

    const [appUserRows, workflowMap] = await Promise.all([
      env.DB.prepare(
        `
          SELECT app_user_email, calendar_id, calendar_name
          FROM calendar_connections
          WHERE calendar_id <> ''
        `
      ).all(),
      getCalendarWorkflowMap(env, [eventId])
    ]);

    const workflow = workflowMap.get(eventId);
    if (!workflow?.autoRolloverEnabled) {
      diagnostics.push({ eventId, status: 'skipped', reason: 'auto_rollover_disabled' });
      continue;
    }
    if (workflow.isConfirmed) {
      diagnostics.push({ eventId, status: 'skipped', reason: 'already_confirmed' });
      continue;
    }

    let matchedConnection = false;
    for (const connection of appUserRows.results || []) {
      const appUserEmail = String((connection as any)?.app_user_email || '').trim();
      const calendarId = String((connection as any)?.calendar_id || '').trim();
      if (!appUserEmail || !calendarId) continue;

      try {
        const existingEvent = await googleApiRequest(
          env,
          `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          appUserEmail
        );

        if (Array.isArray(existingEvent?.recurrence) && existingEvent.recurrence.length > 0) {
          diagnostics.push({ eventId, status: 'skipped', reason: 'recurring_event', appUserEmail });
          break;
        }

        const allDay = !!existingEvent?.start?.date && !existingEvent?.start?.dateTime;
        const startDate = String(existingEvent?.start?.date || String(existingEvent?.start?.dateTime || '').slice(0, 10) || '');
        const endDate = String(existingEvent?.end?.date || String(existingEvent?.end?.dateTime || '').slice(0, 10) || '');
        if (startDate !== yesterday) {
          diagnostics.push({ eventId, status: 'skipped', reason: 'date_not_matched', appUserEmail, startDate, expectedDate: yesterday });
          break;
        }

        matchedConnection = true;

        const payload = allDay
          ? {
              start: { date: shiftDateString(startDate, 1) },
              end: { date: shiftDateString(endDate, 1) }
            }
          : {
              start: {
                dateTime: String(existingEvent?.start?.dateTime || '').replace(startDate, shiftDateString(startDate, 1)),
                timeZone: 'Asia/Taipei'
              },
              end: {
                dateTime: String(existingEvent?.end?.dateTime || '').replace(
                  String(existingEvent?.end?.dateTime || '').slice(0, 10),
                  shiftDateString(String(existingEvent?.end?.dateTime || '').slice(0, 10), 1)
                ),
                timeZone: 'Asia/Taipei'
              }
            };

        if (dryRun) {
          diagnostics.push({
            eventId,
            status: 'would_process',
            appUserEmail,
            fromDate: startDate,
            toDate: shiftDateString(startDate, 1)
          });
          processed += 1;
          break;
        }

        const updatedEvent = await googleApiRequest(
          env,
          `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
          appUserEmail,
          {
            method: 'PATCH',
            body: JSON.stringify(payload)
          }
        );

        await upsertCalendarWorkflow(env, {
          googleEventId: eventId,
          autoRolloverEnabled: true,
          isConfirmed: false,
          confirmedAt: '',
          confirmedByName: '',
          confirmedByEmail: '',
          lastRolloverAt: new Date().toISOString(),
          rolloverCount: rolloverCount + 1
        });

        try {
          const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(updatedEvent, {
            actorName: '系統自動順延',
            calendarName: String((connection as any)?.calendar_name || '')
          });
          await notifyTelegramEventChanged(env, telegramPayload, 'updated');
          await upsertTelegramStartReminderJob(env, telegramPayload);
        } catch (telegramError) {
          console.error('Telegram rollover notification failed:', telegramError);
        }

        processed += 1;
        diagnostics.push({
          eventId,
          status: 'processed',
          appUserEmail,
          fromDate: startDate,
          toDate: shiftDateString(startDate, 1)
        });
        break;
      } catch (error) {
        diagnostics.push({
          eventId,
          status: 'error',
          appUserEmail,
          reason: error instanceof Error ? error.message : 'unknown_error'
        });
        continue;
      }
    }

    if (!matchedConnection) {
      diagnostics.push({ eventId, status: 'skipped', reason: 'no_accessible_connection' });
    }
  }

  return { processed, yesterday, dryRun, diagnostics };
};
