import { createOpenAiStructuredResponse } from '../../_lib/openai';
import { Env, json } from '../_shared';

interface ParseResult {
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
    reminderMinutes: number;
  };
  searchHint: {
    titleKeyword: string;
    date: string;
    dateRangeStart: string;
    dateRangeEnd: string;
  };
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

const sanitizeParsedDraft = (draft: ParseResult['eventDraft']) => {
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

const schema = {
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
      required: ['title', 'description', 'location', 'startDate', 'endDate', 'startTime', 'endTime', 'allDay', 'reminderMinutes'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        allDay: { type: 'boolean' },
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

export const onRequestPost: PagesFunction<Env & { OPENAI_API_KEY?: string }> = async ({ env, request }) => {
  const taipeiToday = getTaipeiToday();
  let payload: { text?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const text = normalizeSpokenCalendarText(String(payload.text || ''));
  if (!text) {
    return json(400, { ok: false, error: 'Text is required' });
  }

  try {
    const parsed = await createOpenAiStructuredResponse<ParseResult>(
      env,
      [
        {
          role: 'system',
          content:
            `你是 KidsLedger 家庭行事曆助理。請只輸出符合 JSON Schema 的內容。使用繁體中文理解輸入，而且 clarificationQuestion 與 userFacingSummary 都必須使用繁體中文，不要出現英文。今天時區是 Asia/Taipei，今天的實際日期是 ${taipeiToday}。若資訊不足，需要回傳 needsClarification=true。日期請盡量正規化成 YYYY-MM-DD，時間請用 HH:mm。若使用者提到「今天」，就是 ${taipeiToday}；若使用者只提到時間、沒有明確提到日期，預設日期也是 ${taipeiToday}。若句子中已明確出現日期、時間、上午、下午、晚上、中午、今晚等時間訊號，即使內容像是買東西、採買、處理事情，也優先視為建立行事曆事件 intent=create，而不是其他待辦或聊天意圖。若使用者只有提供開始時間、沒有提供結束時間或時長，預設建立 1 小時事件。`
        },
        {
          role: 'user',
          content: `使用者輸入：
${text}`
        }
      ],
      'calendar_ai_parse',
      schema,
      { temperature: 0.1 }
    );

    return json(200, {
      ok: true,
      parsed: {
        ...parsed,
        eventDraft: sanitizeParsedDraft(parsed.eventDraft)
      }
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'OpenAI parse failed'
    });
  }
};
