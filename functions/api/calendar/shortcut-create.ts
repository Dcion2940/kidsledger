import { Env, getCalendarConnectionRow, googleApiRequest, json, normalizeAppUserEmail } from './_shared';
import {
  buildTelegramEventPayloadFromGoogleEvent,
  notifyTelegramEventChanged,
  upsertTelegramStartReminderJob
} from '../_lib/telegram';
import { getCalendarWorkflowMap, upsertCalendarWorkflow } from './_workflow';
import { buildGoogleEventPayload, normalizeCalendarShortcutBoolean } from './_event-payload';

const normalizeTimeRange = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const pad2 = (value: number | string) => String(value).padStart(2, '0');

const getObject = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null);

const getNested = (value: unknown, path: string[]) => {
  let current: any = value;
  for (const key of path) {
    const obj = getObject(current);
    if (!obj || !(key in obj)) return undefined;
    current = obj[key];
  }
  return current;
};

const findFirstString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstString(item);
      if (found) return found;
    }
    return '';
  }
  const obj = getObject(value);
  if (!obj) return '';
  for (const item of Object.values(obj)) {
    const found = findFirstString(item);
    if (found) return found;
  }
  return '';
};

const extractLegacyShortcutFields = (requestPayload: any) => {
  const properties = getObject(requestPayload?.properties);
  if (!properties) {
    return {
      title: '',
      date: '',
      taskLevel: ''
    };
  }

  return {
    title:
      findFirstString(getNested(properties, ['待辦事項'])) ||
      findFirstString(getNested(properties, ['title'])) ||
      '',
    date:
      findFirstString(getNested(properties, ['執行日期'])) ||
      findFirstString(getNested(properties, ['date'])) ||
      '',
    taskLevel:
      findFirstString(getNested(properties, ['任務等級'])) ||
      findFirstString(getNested(properties, ['level'])) ||
      ''
  };
};

const splitShortcutTitleAndTimeRange = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return { title: '', timeRange: '' };

  const separators = [' / ', '｜', '|', '@', '／'];
  for (const separator of separators) {
    const index = raw.lastIndexOf(separator);
    if (index <= 0) continue;
    const title = raw.slice(0, index).trim();
    const timeRange = raw.slice(index + separator.length).trim();
    if (/(\d{1,2}:\d{2}\s*[-~～到至]\s*\d{1,2}:\d{2})|全天|all\s*day/i.test(timeRange)) {
      return { title, timeRange };
    }
  }

  return { title: raw, timeRange: '' };
};

const addHoursToTime = (value: string, hours: number) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return '';
  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + hours * 60;
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalizedMinutes / 60))}:${pad2(normalizedMinutes % 60)}`;
};

const normalizeShortcutDateValue = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const directMatch = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (directMatch) {
    return `${directMatch[1]}-${pad2(directMatch[2])}-${pad2(directMatch[3])}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return raw;
};

const inferLegacyTimingFromDateValue = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return {
      date: '',
      startTime: '',
      endTime: ''
    };
  }

  const dateMatch = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const meridiemTimeMatch = raw.match(/(上午|下午)\s*(\d{1,2}):(\d{2})/);
  const plainTimeMatch = raw.match(/(?:T|\s|^)(\d{1,2}):(\d{2})(?::\d{2})?/);
  const date = dateMatch ? `${dateMatch[1]}-${pad2(dateMatch[2])}-${pad2(dateMatch[3])}` : '';

  if (meridiemTimeMatch) {
    let hour = Number(meridiemTimeMatch[2]) || 0;
    const minute = Number(meridiemTimeMatch[3]) || 0;
    if (meridiemTimeMatch[1] === '下午' && hour < 12) hour += 12;
    if (meridiemTimeMatch[1] === '上午' && hour === 12) hour = 0;
    const startTime = `${pad2(hour)}:${pad2(minute)}`;
    return {
      date,
      startTime,
      endTime: addHoursToTime(startTime, 1)
    };
  }

  if (plainTimeMatch) {
    const startTime = `${pad2(plainTimeMatch[1])}:${pad2(plainTimeMatch[2])}`;
    return {
      date,
      startTime,
      endTime: addHoursToTime(startTime, 1)
    };
  }

  return {
    date,
    startTime: '',
    endTime: ''
  };
};

const buildShortcutTimingPayload = (
  requestPayload: any,
  options?: {
    assumeAllDayWhenTimeMissing?: boolean;
  }
) => {
  const explicitAllDay = normalizeCalendarShortcutBoolean(requestPayload?.allDay);
  const date = normalizeShortcutDateValue(requestPayload?.date || requestPayload?.startDate || '');
  const rawTimeRange = normalizeTimeRange(requestPayload?.timeRange || requestPayload?.time || requestPayload?.timeSlot);
  const cleanedTimeRange = rawTimeRange
    .replace(/^確認[\s:：-]*/u, '')
    .replace(/^confirm[\s:：-]*/iu, '')
    .trim();
  const isAllDayFromRange = /全天|all\s*day/i.test(cleanedTimeRange);
  const allDay = explicitAllDay || isAllDayFromRange;

  const directStartTime = String(requestPayload?.startTime || '').trim();
  const directEndTime = String(requestPayload?.endTime || '').trim();

  if (allDay) {
    return {
      date,
      startTime: '',
      endTime: '',
      allDay
    };
  }

  if (directStartTime && directEndTime) {
    return {
      date,
      startTime: directStartTime,
      endTime: directEndTime,
      allDay: false
    };
  }

  if (options?.assumeAllDayWhenTimeMissing && date && !cleanedTimeRange) {
    return {
      date,
      startTime: '',
      endTime: '',
      allDay: true
    };
  }

  const match = cleanedTimeRange.match(/(\d{1,2}:\d{2})\s*[-~～到至]\s*(\d{1,2}:\d{2})/u);
  if (!match) {
    return {
      date,
      startTime: '',
      endTime: '',
      allDay: false,
      error: 'timeRange 格式需為 09:00-10:00，或輸入 全天'
    };
  }

  return {
    date,
    startTime: match[1],
    endTime: match[2],
    allDay: false
  };
};

const deriveShortcutActorName = async (env: Env, appUserEmail: string, connection: any, requestPayload: any) => {
  const explicitActorName = String(requestPayload?.actorName || '').trim();
  if (explicitActorName) return explicitActorName;

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
    if (nickname) return nickname;
    if (displayName) return displayName;
  } catch (error) {
    console.warn('Unable to resolve shortcut actor name from calendar members:', error);
  }

  const googleDisplayName = String(connection?.google_display_name || '').trim();
  if (googleDisplayName) return googleDisplayName;

  const fallbackEmail = String(connection?.google_email || appUserEmail).trim().toLowerCase();
  const localPart = fallbackEmail.split('@')[0] || '';
  return localPart || 'iPhone 捷徑';
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
    autoRolloverEnabled: workflow?.autoRolloverEnabled === true,
    isConfirmed: workflow?.isConfirmed === true,
    confirmedAt: String(workflow?.confirmedAt || ''),
    confirmedByName: String(workflow?.confirmedByName || ''),
    rolloverCount: Math.max(0, Number(workflow?.rolloverCount ?? 0) || 0)
  };
};

export const onRequestPost: PagesFunction<Env & { CALENDAR_SHORTCUT_SECRET?: string }> = async ({ env, request }) => {
  const configuredSecret = String(env.CALENDAR_SHORTCUT_SECRET || '').trim();
  if (!configuredSecret) {
    return json(500, { ok: false, error: 'CALENDAR_SHORTCUT_SECRET is not configured' });
  }

  let requestPayload: any = {};
  try {
    requestPayload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const incomingSecret = String(request.headers.get('x-calendar-shortcut-secret') || requestPayload?.shortcutSecret || '').trim();
  if (!incomingSecret || incomingSecret !== configuredSecret) {
    return json(401, { ok: false, error: 'Unauthorized shortcut request' });
  }

  const legacyFields = extractLegacyShortcutFields(requestPayload);
  const splitTitle = splitShortcutTitleAndTimeRange(String(requestPayload?.title || legacyFields.title || ''));
  const inferredLegacyTiming = inferLegacyTimingFromDateValue(legacyFields.date);
  const appUserEmail = normalizeAppUserEmail(requestPayload?.appUserEmail);
  if (!appUserEmail) {
    return json(400, { ok: false, error: 'appUserEmail is required' });
  }

  const connection = await getCalendarConnectionRow(env, appUserEmail);
  const calendarId = String(connection?.calendar_id || '').trim();
  if (!calendarId) {
    return json(400, { ok: false, error: '家庭 Google Calendar 尚未綁定' });
  }

  if (!requestPayload?.timeRange && splitTitle.timeRange) {
    Object.assign(requestPayload, { timeRange: splitTitle.timeRange });
  }
  if (!requestPayload?.date && inferredLegacyTiming.date) {
    Object.assign(requestPayload, { date: inferredLegacyTiming.date });
  }
  if (!requestPayload?.startTime && inferredLegacyTiming.startTime) {
    Object.assign(requestPayload, { startTime: inferredLegacyTiming.startTime });
  }
  if (!requestPayload?.endTime && inferredLegacyTiming.endTime) {
    Object.assign(requestPayload, { endTime: inferredLegacyTiming.endTime });
  }
  if (!requestPayload?.autoRolloverEnabled && legacyFields.taskLevel) {
    Object.assign(requestPayload, { autoRolloverEnabled: legacyFields.taskLevel });
  }
  const isLegacyDateOnlyShortcut =
    !!inferredLegacyTiming.date &&
    !inferredLegacyTiming.startTime &&
    !String(requestPayload?.timeRange || requestPayload?.time || requestPayload?.timeSlot || '').trim() &&
    !String(requestPayload?.startTime || '').trim() &&
    !String(requestPayload?.endTime || '').trim() &&
    !normalizeCalendarShortcutBoolean(requestPayload?.allDay);

  const normalizedTiming = buildShortcutTimingPayload(requestPayload, {
    assumeAllDayWhenTimeMissing: isLegacyDateOnlyShortcut
  });
  if (normalizedTiming.error) {
    return json(400, { ok: false, error: normalizedTiming.error });
  }

  const normalizedPayload = {
    title: splitTitle.title || String(requestPayload?.title || legacyFields.title || '').trim(),
    description: String(requestPayload?.description || '').trim(),
    location: String(requestPayload?.location || '').trim(),
    startDate: normalizedTiming.date,
    endDate: String(requestPayload?.endDate || normalizedTiming.date || '').trim(),
    startTime: normalizedTiming.startTime,
    endTime: normalizedTiming.endTime,
    allDay: normalizedTiming.allDay,
    attendeeEmails: [],
    reminders: Array.isArray(requestPayload?.reminders) ? requestPayload.reminders : [],
    autoRolloverEnabled: normalizeCalendarShortcutBoolean(requestPayload?.autoRolloverEnabled)
  };

  const built = buildGoogleEventPayload(normalizedPayload);
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

    const actorName = await deriveShortcutActorName(env, appUserEmail, connection, requestPayload);
    const telegramPayload = buildTelegramEventPayloadFromGoogleEvent(data, {
      actorName,
      calendarName: String(connection?.calendar_name || '')
    });

    try {
      await notifyTelegramEventChanged(env, telegramPayload, 'created');
      await upsertTelegramStartReminderJob(env, telegramPayload);
      await upsertCalendarWorkflow(env, {
        googleEventId: String(data?.id || ''),
        autoRolloverEnabled: normalizedPayload.autoRolloverEnabled === true,
        isConfirmed: false,
        rolloverCount: 0
      });
    } catch (sideEffectError) {
      console.error('Shortcut calendar create side effects failed:', sideEffectError);
    }

    const workflowMap = await getCalendarWorkflowMap(env, [String(data?.id || '')]);
    return json(200, {
      ok: true,
      message: `已建立事件：${String(data?.summary || normalizedPayload.title)}`,
      event: normalizeEvent(data, workflowMap.get(String(data?.id || '')))
    });
  } catch (error) {
    console.error('Shortcut calendar create failed:', error);
    return json(400, {
      ok: false,
      error: error instanceof Error ? `Google Calendar 建立失敗：${error.message}` : 'Unable to create calendar event'
    });
  }
};
