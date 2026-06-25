import { createOpenAiStructuredResponse } from '../../_lib/openai';
import {
  Env,
  getCalendarConnectionRow,
  googleApiRequest,
  normalizeAppUserEmail,
  normalizeCalendarMemberRow
} from '../_shared';
import {
  buildTelegramEventPayloadFromGoogleEvent,
  notifyTelegramEventChanged,
  upsertTelegramStartReminderJob
} from '../../_lib/telegram';
import { upsertCalendarWorkflow } from '../_workflow';
import { buildGoogleEventPayload } from '../_event-payload';

export interface ShortcutAiEnv extends Env {
  OPENAI_API_KEY?: string;
  CALENDAR_SHORTCUT_SECRET?: string;
}

const getTaipeiToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const pad2 = (value: number | string) => String(value).padStart(2, '0');

const shiftDateString = (value: string, days: number) => {
  const [year, month, day] = String(value || '')
    .split('-')
    .map((item) => Number(item));
  const base = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const addMinutesToTime = (value: string, minutesToAdd: number) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + minutesToAdd;
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalizedMinutes / 60))}:${pad2(normalizedMinutes % 60)}`;
};

const isValidTimeLabel = (value: string) => /^\d{2}:\d{2}$/.test(String(value || '').trim());

const normalizeSpokenCalendarText = (value: string) =>
  String(value || '')
    .replace(/[：﹕]/g, ':')
    .replace(/[，、]/g, ', ')
    .replace(/[；﹔]/g, '; ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeParsedShortcutDraft = (draft: ShortcutAiParseResult['eventDraft']) => {
  const startDate = String(draft?.startDate || '').trim();
  const endDate = String(draft?.endDate || draft?.startDate || '').trim();
  const startTime = normalizeSpokenCalendarText(String(draft?.startTime || '')).replace(/[^0-9:]/g, '');
  let endTime = normalizeSpokenCalendarText(String(draft?.endTime || '')).replace(/[^0-9:]/g, '');
  const allDay = draft?.allDay === true;

  if (!allDay && isValidTimeLabel(startTime)) {
    const startAt = new Date(`${startDate}T${startTime}:00+08:00`).getTime();
    const endAt = isValidTimeLabel(endTime) ? new Date(`${endDate}T${endTime}:00+08:00`).getTime() : Number.NaN;
    if (!Number.isFinite(endAt) || endAt <= startAt) {
      endTime = addMinutesToTime(startTime, 60);
      const nextEndDate = startTime > endTime ? shiftDateString(endDate || startDate, 1) : endDate || startDate;
      return {
        ...draft,
        startDate,
        endDate: nextEndDate,
        startTime,
        endTime,
        allDay
      };
    }
  }

  return {
    ...draft,
    startDate,
    endDate,
    startTime,
    endTime,
    allDay
  };
};

export const normalizeShortcutAiErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? String(error.message || '').trim() : '';
  if (!message) return fallback;

  if (/家庭 Google Calendar 尚未綁定/.test(message)) {
    return '家庭 Google Calendar 尚未綁定。';
  }
  if (/結束時間必須晚於開始時間/.test(message)) {
    return '結束時間必須晚於開始時間。';
  }
  if (/invalid event time/i.test(message)) {
    return '時間格式不正確，請再說一次。';
  }
  if (/title is required/i.test(message)) {
    return '缺少活動標題，請再說清楚一點。';
  }
  if (/start\/end date is required/i.test(message)) {
    return '缺少日期資訊，請再說清楚一點。';
  }
  if (/openai/i.test(message) || /structured output/i.test(message) || /json/i.test(message)) {
    return fallback;
  }

  return /[A-Za-z]/.test(message) ? fallback : message;
};

interface ShortcutAiParseResult {
  intent: 'query' | 'create' | 'update' | 'delete';
  needsClarification: boolean;
  clarificationQuestion: string;
  userFacingSummary: string;
  eventDraft: {
    title: string;
    description: string;
    location: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
    attendeeNicknames: string[];
    attendeeEmails?: string[];
    reminderMinutes: number;
    autoRolloverEnabled?: boolean;
  };
  searchHint: {
    titleKeyword: string;
    date: string;
    dateRangeStart: string;
    dateRangeEnd: string;
  };
}

const parseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'needsClarification', 'clarificationQuestion', 'userFacingSummary', 'eventDraft', 'searchHint'],
  properties: {
    intent: {
      type: 'string',
      enum: ['query', 'create', 'update', 'delete']
    },
    needsClarification: { type: 'boolean' },
    clarificationQuestion: { type: 'string' },
    userFacingSummary: { type: 'string' },
    eventDraft: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'location', 'startDate', 'endDate', 'startTime', 'endTime', 'allDay', 'attendeeNicknames', 'reminderMinutes'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        allDay: { type: 'boolean' },
        attendeeNicknames: { type: 'array', items: { type: 'string' } },
        reminderMinutes: { type: 'integer' }
      }
    },
    searchHint: {
      type: 'object',
      additionalProperties: false,
      required: ['titleKeyword', 'date', 'dateRangeStart', 'dateRangeEnd'],
      properties: {
        titleKeyword: { type: 'string' },
        date: { type: 'string' },
        dateRangeStart: { type: 'string' },
        dateRangeEnd: { type: 'string' }
      }
    }
  }
};

export const text = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0'
    }
  });

export const authorizeShortcutRequest = async (env: ShortcutAiEnv, request: Request) => {
  const configuredSecret = String(env.CALENDAR_SHORTCUT_SECRET || '').trim();
  if (!configuredSecret) {
    return { ok: false as const, response: text(500, '系統尚未設定 CALENDAR_SHORTCUT_SECRET。') };
  }

  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return { ok: false as const, response: text(400, '捷徑送出的資料格式不正確。') };
  }

  const incomingSecret = String(request.headers.get('x-calendar-shortcut-secret') || payload?.shortcutSecret || '').trim();
  if (!incomingSecret || incomingSecret !== configuredSecret) {
    return { ok: false as const, response: text(401, '未授權的捷徑請求。') };
  }

  const appUserEmail = normalizeAppUserEmail(payload?.appUserEmail);
  if (!appUserEmail) {
    return { ok: false as const, response: text(400, '缺少 appUserEmail。') };
  }

  return { ok: true as const, payload, appUserEmail };
};

export const parseCalendarText = async (env: ShortcutAiEnv, inputText: string) => {
  const normalizedInputText = normalizeSpokenCalendarText(inputText);
  const taipeiToday = getTaipeiToday();
  const membersResult = await env.DB.prepare(
    'SELECT id, display_name, nickname, aliases_json, email, is_active, created_at, updated_at FROM calendar_members WHERE is_active = 1 ORDER BY nickname COLLATE NOCASE ASC'
  ).all();
  const members = (membersResult.results || []).map(normalizeCalendarMemberRow);
  const memberText = members.length
    ? members.map((member) => `暱稱：${member.nickname}；姓名：${member.displayName}；Email：${member.email}；別名：${member.aliases.join('、') || '無'}`).join('\n')
    : '目前沒有家庭成員資料';

  const parsed = await createOpenAiStructuredResponse<ShortcutAiParseResult>(
    env,
    [
      {
        role: 'system',
        content:
          `你是 KidsLedger 家庭行事曆助理。請只輸出符合 JSON Schema 的內容。使用繁體中文理解輸入，而且 clarificationQuestion 與 userFacingSummary 都必須使用繁體中文，不要出現英文。今天時區是 Asia/Taipei，今天的實際日期是 ${taipeiToday}。若資訊不足，需要回傳 needsClarification=true。日期請盡量正規化成 YYYY-MM-DD，時間請用 HH:mm。若使用者提到「今天」，就是 ${taipeiToday}；若使用者只提到時間、沒有明確提到日期，預設日期也是 ${taipeiToday}。若句子中已明確出現日期、時間、上午、下午、晚上、中午、今晚等時間訊號，即使內容像是買東西、採買、處理事情，也優先視為建立行事曆事件 intent=create，而不是其他待辦或聊天意圖。若使用者只有提供開始時間、沒有提供結束時間或時長，預設建立 1 小時事件。`
      },
      {
        role: 'user',
        content: `家庭成員名單如下：\n${memberText}\n\n使用者輸入：\n${normalizedInputText}`
      }
    ],
    'calendar_ai_parse',
    parseSchema,
    { temperature: 0.1 }
  );

  const memberMap = new Map(
    members.flatMap((member) => [
      [member.nickname, member.email],
      ...member.aliases.map((alias) => [alias, member.email] as const)
    ])
  );

  return {
    ...parsed,
    eventDraft: {
      ...sanitizeParsedShortcutDraft(parsed.eventDraft),
      attendeeEmails: parsed.eventDraft.attendeeNicknames
        .map((nickname) => memberMap.get(nickname) || '')
        .filter(Boolean)
    }
  };
};

export const storeShortcutDraft = async (
  env: ShortcutAiEnv,
  appUserEmail: string,
  payload: {
    rawText: string;
    summaryText: string;
    draft: Record<string, unknown>;
  }
) => {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `
      INSERT INTO shortcut_ai_drafts (
        app_user_email, raw_text, draft_json, summary_text, created_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_user_email) DO UPDATE SET
        raw_text = excluded.raw_text,
        draft_json = excluded.draft_json,
        summary_text = excluded.summary_text,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `
  )
    .bind(appUserEmail, payload.rawText, JSON.stringify(payload.draft), payload.summaryText, createdAt, expiresAt)
    .run();
};

export const loadShortcutDraft = async (env: ShortcutAiEnv, appUserEmail: string) => {
  const row = await env.DB.prepare(
    `
      SELECT draft_json, summary_text, expires_at
      FROM shortcut_ai_drafts
      WHERE app_user_email = ?
    `
  )
    .bind(appUserEmail)
    .first<any>();

  if (!row) return null;
  const expiresAt = String(row?.expires_at || '').trim();
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    return null;
  }

  try {
    return {
      summaryText: String(row?.summary_text || '').trim(),
      draft: JSON.parse(String(row?.draft_json || '{}'))
    };
  } catch {
    return null;
  }
};

export const deleteShortcutDraft = async (env: ShortcutAiEnv, appUserEmail: string) => {
  await env.DB.prepare('DELETE FROM shortcut_ai_drafts WHERE app_user_email = ?').bind(appUserEmail).run();
};

const deriveShortcutActorName = async (env: ShortcutAiEnv, appUserEmail: string, connection: any) => {
  try {
    const row = await env.DB.prepare(
      `
        SELECT nickname, display_name
        FROM calendar_members
        WHERE is_active = 1 AND lower(email) = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT 1
      `
    )
      .bind(appUserEmail)
      .first<any>();

    const nickname = String(row?.nickname || '').trim();
    const displayName = String(row?.display_name || '').trim();
    const resolvedName =
      nickname ||
      displayName ||
      String(connection?.google_display_name || '').trim() ||
      String(connection?.google_email || appUserEmail).trim().split('@')[0] ||
      '未知使用者';

    return `${resolvedName} 使用Shortcut建立`;
  } catch (error) {
    console.warn('Unable to resolve shortcut AI actor name from calendar members:', error);
    const fallbackName =
      String(connection?.google_display_name || '').trim() ||
      String(connection?.google_email || appUserEmail).trim().split('@')[0] ||
      '未知使用者';
    return `${fallbackName} 使用Shortcut建立`;
  }
};

export const createCalendarEventFromDraft = async (env: ShortcutAiEnv, appUserEmail: string, draft: any) => {
  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  if (!calendarId) {
    throw new Error('家庭 Google Calendar 尚未綁定');
  }

  const normalizedPayload = {
    title: String(draft?.title || '').trim(),
    description: String(draft?.description || '').trim(),
    location: String(draft?.location || '').trim(),
    startDate: String(draft?.startDate || '').trim(),
    endDate: String(draft?.endDate || draft?.startDate || '').trim(),
    startTime: String(draft?.startTime || '').trim(),
    endTime: String(draft?.endTime || '').trim(),
    allDay: draft?.allDay === true,
    attendeeEmails: Array.isArray(draft?.attendeeEmails)
      ? draft.attendeeEmails.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [],
    reminders: [
      {
        method: 'popup',
        minutes: Math.max(0, Number(draft?.reminderMinutes ?? 30) || 0)
      }
    ],
    autoRolloverEnabled: draft?.autoRolloverEnabled === true
  };

  const built = buildGoogleEventPayload(normalizedPayload);
  if ('error' in built) {
    throw new Error(String(built.error || '無法建立事件'));
  }

  const data = await googleApiRequest(
    env,
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${built.sendUpdates}`,
    appUserEmail,
    {
      method: 'POST',
      body: JSON.stringify(built.payload)
    }
  );

  try {
    const actorName = await deriveShortcutActorName(env, appUserEmail, connection);
    const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(data, {
      actorName,
      calendarName: String(connection?.calendar_name || '')
    });
    await notifyTelegramEventChanged(env, telegramPayload, 'created');
    await upsertTelegramStartReminderJob(env, telegramPayload);
    await upsertCalendarWorkflow(env, {
      googleEventId: String(data?.id || ''),
      autoRolloverEnabled: normalizedPayload.autoRolloverEnabled === true,
      isConfirmed: false,
      rolloverCount: 0
    });
  } catch (sideEffectError) {
    console.error('Shortcut AI create side effects failed:', sideEffectError);
  }

  return {
    message: `已建立事件「${String(data?.summary || normalizedPayload.title)}」`
  };
};
