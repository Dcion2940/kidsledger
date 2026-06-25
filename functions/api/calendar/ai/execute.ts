import { Env, getAppUserEmailFromRequest, getCalendarConnectionRow, googleApiRequest, json } from '../_shared';
import { createOpenAiTextResponse } from '../../_lib/openai';
import {
  buildTelegramEventPayloadFromGoogleEvent,
  cancelTelegramNotificationJobs,
  notifyTelegramEventChanged,
  upsertTelegramStartReminderJob
} from '../../_lib/telegram';
import { deleteCalendarWorkflow, upsertCalendarWorkflow } from '../_workflow';

interface ExecutePayload {
  action?: 'create' | 'update' | 'delete' | 'query';
  actorName?: string;
  actorEmail?: string;
  source?: 'ai_text' | 'ai_voice';
  eventId?: string;
  draft?: {
    title?: string;
    description?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
    attendeeEmails?: string[];
    reminderMinutes?: number;
    autoRolloverEnabled?: boolean;
  };
}

const shiftDateString = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map((item) => Number(item));
  const base = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const buildGoogleEventPayload = (draft: ExecutePayload['draft']) => {
  const title = String(draft?.title || '').trim();
  const startDate = String(draft?.startDate || '').trim();
  const endDate = String(draft?.endDate || '').trim();
  const allDay = draft?.allDay === true;
  const startTime = String(draft?.startTime || '').trim();
  const endTime = String(draft?.endTime || '').trim();
  const reminderMinutes = Math.max(0, Number(draft?.reminderMinutes ?? 30) || 0);

  if (!title) throw new Error('Title is required');
  if (!startDate || !endDate) throw new Error('Start/end date is required');
  if (!allDay) {
    const startAt = new Date(`${startDate}T${startTime || '09:00'}:00+08:00`).getTime();
    const endAt = new Date(`${endDate}T${endTime || '10:00'}:00+08:00`).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
      throw new Error('Invalid event time');
    }
    if (endAt <= startAt) {
      throw new Error('結束時間必須晚於開始時間');
    }
  }

  return {
    payload: {
      summary: title,
      description: String(draft?.description || ''),
      location: String(draft?.location || ''),
      start: allDay
        ? { date: startDate }
        : { dateTime: `${startDate}T${startTime || '09:00'}:00+08:00`, timeZone: 'Asia/Taipei' },
      end: allDay
        ? { date: shiftDateString(endDate, 1) }
        : { dateTime: `${endDate}T${endTime || '10:00'}:00+08:00`, timeZone: 'Asia/Taipei' },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: reminderMinutes }]
      }
    },
    sendUpdates: 'none'
  };
};

const logCalendarAction = async (env: Env, payload: Record<string, unknown>) => {
  await env.DB.prepare(
    `
      INSERT INTO calendar_action_logs (
        id, google_event_id, action_type, source, actor_name, actor_email,
        request_payload_json, result_payload_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      String(payload.googleEventId || ''),
      String(payload.actionType || ''),
      String(payload.source || 'ai_text'),
      String(payload.actorName || ''),
      String(payload.actorEmail || ''),
      JSON.stringify(payload.requestPayload || {}),
      JSON.stringify(payload.resultPayload || {}),
      new Date().toISOString()
    )
    .run();
};

export const onRequestPost: PagesFunction<Env & { OPENAI_API_KEY?: string }> = async ({ env, request }) => {
  const appUserEmail = getAppUserEmailFromRequest(request);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'App user email is required' });
  }

  let payload: ExecutePayload = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const action = payload.action;
  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }

  try {
    let result: Record<string, unknown> = {};
    let googleEventId = payload.eventId || '';

    if (action === 'create') {
      const built = buildGoogleEventPayload(payload.draft);
      const data = await googleApiRequest(
        env,
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${built.sendUpdates}`,
        appUserEmail,
        {
          method: 'POST',
          body: JSON.stringify(built.payload)
        }
      );
      googleEventId = String(data?.id || '');
      try {
        const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(data, {
          actorName: String(payload.actorName || ''),
          calendarName: String(connection?.calendar_name || '')
        });
        await notifyTelegramEventChanged(env, telegramPayload, 'created');
        await upsertTelegramStartReminderJob(env, telegramPayload);
        await upsertCalendarWorkflow(env, {
          googleEventId,
          autoRolloverEnabled: payload.draft?.autoRolloverEnabled === true,
          isConfirmed: false,
          rolloverCount: 0
        });
      } catch (telegramError) {
        console.error('Telegram notification on AI create failed:', telegramError);
      }
      result = {
        summary: String(data?.summary || ''),
        message: `已建立事件「${String(data?.summary || '')}」`
      };
    } else if (action === 'update') {
      if (!payload.eventId) throw new Error('Event id is required');
      const built = buildGoogleEventPayload(payload.draft);
      const data = await googleApiRequest(
        env,
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(payload.eventId)}?sendUpdates=${built.sendUpdates}`,
        appUserEmail,
        {
          method: 'PUT',
          body: JSON.stringify(built.payload)
        }
      );
      googleEventId = String(data?.id || payload.eventId);
      try {
        const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(data, {
          actorName: String(payload.actorName || ''),
          calendarName: String(connection?.calendar_name || '')
        });
        await notifyTelegramEventChanged(env, telegramPayload, 'updated');
        await upsertTelegramStartReminderJob(env, telegramPayload);
        await upsertCalendarWorkflow(env, {
          googleEventId,
          autoRolloverEnabled: payload.draft?.autoRolloverEnabled === true,
          isConfirmed: false,
          confirmedAt: '',
          confirmedByName: '',
          confirmedByEmail: ''
        });
      } catch (telegramError) {
        console.error('Telegram reminder job update failed:', telegramError);
      }
      result = {
        summary: String(data?.summary || ''),
        message: `已更新事件「${String(data?.summary || '')}」`
      };
    } else if (action === 'delete') {
      if (!payload.eventId) throw new Error('Event id is required');
      const existingEvent = await googleApiRequest(
        env,
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(payload.eventId)}`,
        appUserEmail
      );
      await googleApiRequest(
        env,
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(payload.eventId)}?sendUpdates=none`,
        appUserEmail,
        { method: 'DELETE' }
      );
      googleEventId = payload.eventId;
      try {
        const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(existingEvent, {
          actorName: String(payload.actorName || ''),
          calendarName: String(connection?.calendar_name || '')
        });
        await notifyTelegramEventChanged(env, telegramPayload, 'deleted');
        await cancelTelegramNotificationJobs(env, payload.eventId);
        await deleteCalendarWorkflow(env, payload.eventId);
      } catch (telegramError) {
        console.error('Telegram reminder job cancel failed:', telegramError);
      }
      result = { message: '已刪除事件' };
    } else if (action === 'query') {
      const text = await createOpenAiTextResponse(
        env,
        [
          {
            role: 'system',
            content: '你是家庭行事曆助理，請用繁體中文、簡潔整理查詢結果。'
          },
          {
            role: 'user',
            content: `使用者查詢：${payload.draft?.title || ''}\n請回覆目前查詢結果已經顯示在畫面中，並提醒使用者確認候選事件。`
          }
        ]
      );
      result = { message: text };
    } else {
      throw new Error('Unsupported action');
    }

    await logCalendarAction(env, {
      googleEventId,
      actionType: action,
      source: payload.source || 'ai_text',
      actorName: payload.actorName || '',
      actorEmail: payload.actorEmail || '',
      requestPayload: payload,
      resultPayload: result
    });

    return json(200, {
      ok: true,
      result
    });
  } catch (error) {
    console.error('Execute AI calendar action failed:', error);
    return json(400, {
      ok: false,
      error: error instanceof Error ? `AI 行事曆操作失敗：${error.message}` : 'Unable to execute AI calendar action'
    });
  }
};
