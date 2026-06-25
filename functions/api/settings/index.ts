import { saveTelegramSettings } from '../_lib/telegram';

interface Env {
  DB: D1Database;
  TELEGRAM_TOKEN_SECRET?: string;
  GOOGLE_CALENDAR_TOKEN_SECRET?: string;
}

interface SettingsPayload {
  aiMentorEnabled?: boolean;
  aiApiLink?: string;
  idleLockMinutes?: number;
  telegramChatId?: string;
  telegramNotifyOnCreate?: boolean;
  telegramNotifyOnStart?: boolean;
  telegramBotToken?: string;
  usdTwdReferenceRate?: number;
  usdTwdReferenceUpdatedAt?: string;
  usdTwdReferenceSource?: string;
}

const SETTINGS_ID = 'global';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

const normalizeRow = (row: any) => ({
  aiMentorEnabled: Number(row?.ai_mentor_enabled ?? 1) === 1,
  aiApiLink: String(row?.ai_api_link || ''),
  idleLockMinutes: Math.max(1, Number(row?.idle_lock_minutes ?? 10) || 10),
  telegramChatId: String(row?.telegram_chat_id || ''),
  telegramNotifyOnCreate: Number(row?.telegram_notify_on_create ?? 0) === 1,
  telegramNotifyOnStart: Number(row?.telegram_notify_on_start ?? 0) === 1,
  telegramBotTokenConfigured: !!String(row?.telegram_bot_token_encrypted || '').trim(),
  usdTwdReferenceRate: Number(row?.usd_twd_reference_rate || 0),
  usdTwdReferenceUpdatedAt: String(row?.usd_twd_reference_updated_at || ''),
  usdTwdReferenceSource: String(row?.usd_twd_reference_source || '')
});

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const row = await env.DB.prepare(
    `
      SELECT google_sheet_id, ai_mentor_enabled, ai_api_link, idle_lock_minutes,
             telegram_bot_token_encrypted, telegram_chat_id, telegram_notify_on_create, telegram_notify_on_start,
             usd_twd_reference_rate, usd_twd_reference_updated_at, usd_twd_reference_source
      FROM app_settings
      WHERE id = ?
    `
  )
    .bind(SETTINGS_ID)
    .first();

  if (!row) {
    return json(200, {
      settings: {
        aiMentorEnabled: true,
        aiApiLink: '',
        idleLockMinutes: 10,
        telegramChatId: '',
        telegramNotifyOnCreate: false,
        telegramNotifyOnStart: false,
        telegramBotTokenConfigured: false,
        usdTwdReferenceRate: 0,
        usdTwdReferenceUpdatedAt: '',
        usdTwdReferenceSource: ''
      }
    });
  }

  return json(200, { settings: normalizeRow(row) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let payload: SettingsPayload = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const aiMentorEnabled = payload.aiMentorEnabled !== false;
  const aiApiLink = String(payload.aiApiLink || '').trim();
  const idleLockMinutes = Math.max(1, Number(payload.idleLockMinutes ?? 10) || 10);
  const telegramChatId = String(payload.telegramChatId || '').trim();
  const telegramNotifyOnCreate = payload.telegramNotifyOnCreate === true;
  const telegramNotifyOnStart = payload.telegramNotifyOnStart === true;
  const telegramBotToken = String(payload.telegramBotToken || '').trim();
  const usdTwdReferenceRate = Number(payload.usdTwdReferenceRate || 0);
  const usdTwdReferenceUpdatedAt = String(payload.usdTwdReferenceUpdatedAt || '').trim();
  const usdTwdReferenceSource = String(payload.usdTwdReferenceSource || '').trim();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `
      INSERT INTO app_settings (
        id, google_sheet_id, ai_mentor_enabled, ai_api_link, idle_lock_minutes,
        telegram_chat_id, telegram_notify_on_create, telegram_notify_on_start,
        usd_twd_reference_rate, usd_twd_reference_updated_at, usd_twd_reference_source, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ai_mentor_enabled = excluded.ai_mentor_enabled,
        ai_api_link = excluded.ai_api_link,
        idle_lock_minutes = excluded.idle_lock_minutes,
        telegram_chat_id = excluded.telegram_chat_id,
        telegram_notify_on_create = excluded.telegram_notify_on_create,
        telegram_notify_on_start = excluded.telegram_notify_on_start,
        usd_twd_reference_rate = excluded.usd_twd_reference_rate,
        usd_twd_reference_updated_at = excluded.usd_twd_reference_updated_at,
        usd_twd_reference_source = excluded.usd_twd_reference_source,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      SETTINGS_ID,
      '',
      aiMentorEnabled ? 1 : 0,
      aiApiLink,
      idleLockMinutes,
      telegramChatId,
      telegramNotifyOnCreate ? 1 : 0,
      telegramNotifyOnStart ? 1 : 0,
      Number.isFinite(usdTwdReferenceRate) && usdTwdReferenceRate > 0 ? usdTwdReferenceRate : 0,
      usdTwdReferenceUpdatedAt,
      usdTwdReferenceSource,
      now
    )
    .run();

  await saveTelegramSettings(env, {
    botToken: telegramBotToken,
    chatId: telegramChatId,
    notifyOnCreate: telegramNotifyOnCreate,
    notifyOnStart: telegramNotifyOnStart
  });

  const savedRow = await env.DB.prepare(
    `
      SELECT telegram_bot_token_encrypted
      FROM app_settings
      WHERE id = ?
    `
  )
    .bind(SETTINGS_ID)
    .first();

  return json(200, {
    ok: true,
    settings: {
      aiMentorEnabled,
      aiApiLink,
      idleLockMinutes,
      telegramChatId,
      telegramNotifyOnCreate,
      telegramNotifyOnStart,
      telegramBotTokenConfigured: !!String((savedRow as any)?.telegram_bot_token_encrypted || '').trim(),
      usdTwdReferenceRate: Number.isFinite(usdTwdReferenceRate) && usdTwdReferenceRate > 0 ? usdTwdReferenceRate : 0,
      usdTwdReferenceUpdatedAt,
      usdTwdReferenceSource
    }
  });
};
