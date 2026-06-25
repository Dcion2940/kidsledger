import { decryptSecret, encryptSecret } from '../calendar/_shared';

export interface TelegramEnv {
  DB: D1Database;
  TELEGRAM_TOKEN_SECRET?: string;
  GOOGLE_CALENDAR_TOKEN_SECRET?: string;
  TELEGRAM_JOB_SECRET?: string;
}

export interface TelegramSettings {
  botTokenConfigured: boolean;
  chatId: string;
  notifyOnCreate: boolean;
  notifyOnStart: boolean;
}

export interface TelegramEventPayload {
  googleEventId: string;
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  calendarName?: string;
  actorName?: string;
}

const SETTINGS_ID = 'global';
const JOB_TYPE_EVENT_START = 'event_start';

const getTokenSecret = (env: TelegramEnv) => String(env.TELEGRAM_TOKEN_SECRET || env.GOOGLE_CALENDAR_TOKEN_SECRET || '').trim();

const formatDateTimeLabel = (payload: TelegramEventPayload) => {
  if (payload.allDay) {
    return `${payload.startDate} 全天`;
  }

  const startTime = String(payload.startTime || '').trim();
  const endTime = String(payload.endTime || '').trim();
  if (startTime && endTime) {
    return `${payload.startDate} ${startTime} - ${endTime}`;
  }
  if (startTime) {
    return `${payload.startDate} ${startTime}`;
  }
  return payload.startDate;
};

const getStartScheduleAt = (payload: TelegramEventPayload) => {
  if (payload.allDay) {
    return `${payload.startDate}T00:00:00+08:00`;
  }

  const startTime = String(payload.startTime || '').trim() || '09:00';
  return `${payload.startDate}T${startTime}:00+08:00`;
};

const buildCreatedMessage = (payload: TelegramEventPayload) => {
  const lines = [
    '已新增家庭活動',
    `主題：${payload.title || '未命名事件'}`,
    `時間：${formatDateTimeLabel(payload)}`,
    payload.location ? `地點：${payload.location}` : '',
    payload.actorName ? `建立者：${payload.actorName}` : '',
    payload.calendarName ? `行事曆：${payload.calendarName}` : ''
  ].filter(Boolean);

  return lines.join('\n');
};

const buildUpdatedMessage = (payload: TelegramEventPayload) => {
  const lines = [
    '家庭活動已更新',
    `主題：${payload.title || '未命名事件'}`,
    `時間：${formatDateTimeLabel(payload)}`,
    payload.location ? `地點：${payload.location}` : '',
    payload.actorName ? `修改者：${payload.actorName}` : '',
    payload.calendarName ? `行事曆：${payload.calendarName}` : ''
  ].filter(Boolean);

  return lines.join('\n');
};

const buildDeletedMessage = (payload: TelegramEventPayload) => {
  const lines = [
    '家庭活動已刪除',
    `主題：${payload.title || '未命名事件'}`,
    `原時間：${formatDateTimeLabel(payload)}`,
    payload.location ? `原地點：${payload.location}` : '',
    payload.actorName ? `刪除者：${payload.actorName}` : '',
    payload.calendarName ? `行事曆：${payload.calendarName}` : ''
  ].filter(Boolean);

  return lines.join('\n');
};

const buildStartReminderMessage = (payload: TelegramEventPayload) => {
  const lines = [
    '家庭活動提醒',
    `現在開始：${payload.title || '未命名事件'}`,
    `時間：${formatDateTimeLabel(payload)}`,
    payload.location ? `地點：${payload.location}` : ''
  ].filter(Boolean);

  return lines.join('\n');
};

export const loadTelegramSettings = async (env: TelegramEnv): Promise<TelegramSettings> => {
  const row = await env.DB.prepare(
    `
      SELECT telegram_bot_token_encrypted, telegram_chat_id, telegram_notify_on_create, telegram_notify_on_start
      FROM app_settings
      WHERE id = ?
    `
  )
    .bind(SETTINGS_ID)
    .first();

  return {
    botTokenConfigured: !!String((row as any)?.telegram_bot_token_encrypted || '').trim(),
    chatId: String((row as any)?.telegram_chat_id || ''),
    notifyOnCreate: Number((row as any)?.telegram_notify_on_create ?? 0) === 1,
    notifyOnStart: Number((row as any)?.telegram_notify_on_start ?? 0) === 1
  };
};

export const saveTelegramSettings = async (
  env: TelegramEnv,
  payload: {
    botToken?: string;
    chatId: string;
    notifyOnCreate: boolean;
    notifyOnStart: boolean;
  }
) => {
  const tokenSecret = getTokenSecret(env);
  const botToken = String(payload.botToken || '').trim();
  if (botToken && !tokenSecret) {
    throw new Error('Telegram token secret is not configured');
  }
  const encryptedToken = botToken
    ? await encryptSecret(botToken, tokenSecret)
    : '';

  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO app_settings (
        id, google_sheet_id, ai_mentor_enabled, ai_api_link, idle_lock_minutes,
        telegram_bot_token_encrypted, telegram_chat_id, telegram_notify_on_create, telegram_notify_on_start, updated_at
      )
      VALUES (?, '', 1, '', 10, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        telegram_bot_token_encrypted = CASE
          WHEN excluded.telegram_bot_token_encrypted = '' THEN app_settings.telegram_bot_token_encrypted
          ELSE excluded.telegram_bot_token_encrypted
        END,
        telegram_chat_id = excluded.telegram_chat_id,
        telegram_notify_on_create = excluded.telegram_notify_on_create,
        telegram_notify_on_start = excluded.telegram_notify_on_start,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      SETTINGS_ID,
      encryptedToken,
      String(payload.chatId || '').trim(),
      payload.notifyOnCreate ? 1 : 0,
      payload.notifyOnStart ? 1 : 0,
      now
    )
    .run();
};

export const getTelegramBotToken = async (env: TelegramEnv) => {
  const tokenSecret = getTokenSecret(env);
  if (!tokenSecret) {
    return '';
  }

  const row = await env.DB.prepare(
    'SELECT telegram_bot_token_encrypted FROM app_settings WHERE id = ?'
  )
    .bind(SETTINGS_ID)
    .first();

  const encrypted = String((row as any)?.telegram_bot_token_encrypted || '').trim();
  if (!encrypted) {
    return '';
  }

  return decryptSecret(encrypted, tokenSecret);
};

export const isTelegramConfigured = async (env: TelegramEnv) => {
  const settings = await loadTelegramSettings(env);
  const botToken = await getTelegramBotToken(env);

  return {
    settings,
    botToken,
    enabled: !!botToken && !!settings.chatId
  };
};

export const sendTelegramMessage = async (botToken: string, chatId: string, text: string) => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(String(data?.description || 'Telegram sendMessage failed'));
  }

  return data;
};

export const notifyTelegramEventChanged = async (
  env: TelegramEnv,
  payload: TelegramEventPayload,
  changeType: 'created' | 'updated' | 'deleted'
) => {
  const config = await isTelegramConfigured(env);
  if (!config.enabled || !config.settings.notifyOnCreate) {
    return { sent: false, reason: 'disabled' as const };
  }

  const message =
    changeType === 'created'
      ? buildCreatedMessage(payload)
      : changeType === 'updated'
        ? buildUpdatedMessage(payload)
        : buildDeletedMessage(payload);

  await sendTelegramMessage(config.botToken, config.settings.chatId, message);
  return { sent: true as const };
};

export const buildTelegramEventPayloadFromGoogleEvent = (
  item: any,
  extras?: {
    actorName?: string;
    calendarName?: string;
  }
): TelegramEventPayload => {
  const startDateTime = String(item?.start?.dateTime || '');
  const endDateTime = String(item?.end?.dateTime || '');
  const allDay = !!item?.start?.date && !item?.start?.dateTime;
  const startDate = String(item?.start?.date || startDateTime.slice(0, 10) || '');
  const rawEndDate = String(item?.end?.date || endDateTime.slice(0, 10) || startDate);
  const endDate = allDay && rawEndDate
    ? new Date(new Date(`${rawEndDate}T00:00:00`).getTime() - 86400000).toISOString().slice(0, 10)
    : rawEndDate;

  return {
    googleEventId: String(item?.id || ''),
    title: String(item?.summary || ''),
    description: String(item?.description || ''),
    location: String(item?.location || ''),
    startDate,
    endDate,
    startTime: startDateTime ? startDateTime.slice(11, 16) : '',
    endTime: endDateTime ? endDateTime.slice(11, 16) : '',
    allDay,
    calendarName: String(extras?.calendarName || ''),
    actorName: String(extras?.actorName || '')
  };
};

export const upsertTelegramStartReminderJob = async (
  env: TelegramEnv,
  payload: TelegramEventPayload
) => {
  const settings = await loadTelegramSettings(env);
  const jobId = `${JOB_TYPE_EVENT_START}:${payload.googleEventId}`;
  const now = new Date().toISOString();

  if (!settings.notifyOnStart || !settings.chatId) {
    await env.DB.prepare(
      'DELETE FROM calendar_notification_jobs WHERE id = ?'
    )
      .bind(jobId)
      .run();
    return;
  }

  await env.DB.prepare(
    `
      INSERT INTO calendar_notification_jobs (
        id, google_event_id, job_type, scheduled_for, payload_json, status, sent_at, last_error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'pending', '', '', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scheduled_for = excluded.scheduled_for,
        payload_json = excluded.payload_json,
        status = 'pending',
        sent_at = '',
        last_error = '',
        updated_at = excluded.updated_at
    `
  )
    .bind(
      jobId,
      payload.googleEventId,
      JOB_TYPE_EVENT_START,
      new Date(getStartScheduleAt(payload)).toISOString(),
      JSON.stringify(payload),
      now,
      now
    )
    .run();
};

export const cancelTelegramNotificationJobs = async (env: TelegramEnv, googleEventId: string) => {
  await env.DB.prepare(
    'DELETE FROM calendar_notification_jobs WHERE google_event_id = ?'
  )
    .bind(googleEventId)
    .run();
};

export const processDueTelegramJobs = async (env: TelegramEnv) => {
  const config = await isTelegramConfigured(env);
  if (!config.enabled || !config.settings.notifyOnStart) {
    return { processed: 0, sent: 0, failed: 0, skipped: true };
  }

  const dueJobs = await env.DB.prepare(
    `
      SELECT id, payload_json
      FROM calendar_notification_jobs
      WHERE status = 'pending' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC
      LIMIT 25
    `
  )
    .bind(new Date().toISOString())
    .all();

  let sent = 0;
  let failed = 0;

  for (const row of dueJobs.results || []) {
    const id = String((row as any)?.id || '');
    const payloadRaw = String((row as any)?.payload_json || '{}');
    let payload: TelegramEventPayload;
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      payload = {
        googleEventId: '',
        title: '未命名事件',
        startDate: '',
        endDate: '',
        allDay: false
      };
    }

    try {
      await sendTelegramMessage(config.botToken, config.settings.chatId, buildStartReminderMessage(payload));
      await env.DB.prepare(
        `
          UPDATE calendar_notification_jobs
          SET status = 'sent', sent_at = ?, last_error = '', updated_at = ?
          WHERE id = ?
        `
      )
        .bind(new Date().toISOString(), new Date().toISOString(), id)
        .run();
      sent += 1;
    } catch (error) {
      await env.DB.prepare(
        `
          UPDATE calendar_notification_jobs
          SET status = 'failed', last_error = ?, updated_at = ?
          WHERE id = ?
        `
      )
        .bind(error instanceof Error ? error.message : 'Telegram job failed', new Date().toISOString(), id)
        .run();
      failed += 1;
    }
  }

  return {
    processed: (dueJobs.results || []).length,
    sent,
    failed,
    skipped: false
  };
};
