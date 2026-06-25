import { json } from '../_shared';
import { authorizeShortcutRequest, normalizeShortcutAiErrorMessage, parseCalendarText, ShortcutAiEnv, storeShortcutDraft, text } from './_shared';

const buildPrepareResponse = (payload: {
  status: 'clarify' | 'confirm' | 'unsupported';
  question?: string;
  summary?: string;
  spokenText: string;
  readyToConfirm: boolean;
}) =>
  json(200, {
    ok: true,
    status: payload.status,
    needsClarification: payload.status === 'clarify',
    question: String(payload.question || '').trim(),
    summary: String(payload.summary || '').trim(),
    spokenText: String(payload.spokenText || '').trim(),
    readyToConfirm: payload.readyToConfirm
  });

export const onRequestPost: PagesFunction<ShortcutAiEnv> = async ({ env, request }) => {
  const auth = await authorizeShortcutRequest(env, request);
  if (!auth.ok) return auth.response;

  const responseFormat = String(auth.payload?.responseFormat || '').trim().toLowerCase();
  const wantsJson = responseFormat === 'json';
  const inputText = String(auth.payload?.text || '').trim();
  if (!inputText) {
    return text(400, '請先說明你要新增什麼行事曆。');
  }

  try {
    let sourceText = inputText;
    const existingRow = await env.DB.prepare(
      `
        SELECT raw_text, draft_json, expires_at
        FROM shortcut_ai_drafts
        WHERE app_user_email = ?
      `
    )
      .bind(auth.appUserEmail)
      .first<any>();

    const expiresAt = String(existingRow?.expires_at || '').trim();
    if (existingRow && expiresAt && Date.parse(expiresAt) > Date.now()) {
      try {
        const existingDraft = JSON.parse(String(existingRow?.draft_json || '{}'));
        if (existingDraft?._state === 'clarify_pending' && typeof existingDraft?.baseText === 'string' && existingDraft.baseText.trim()) {
          sourceText = `${existingDraft.baseText.trim()}\n補充資訊：${inputText}`;
        }
      } catch {
        // Ignore malformed pending state and continue with the latest input only.
      }
    }

    const parsed = await parseCalendarText(env, sourceText);
    if (parsed.intent !== 'create') {
      const response = buildPrepareResponse({
        status: 'unsupported',
        spokenText: '這個驗證版捷徑目前只支援新增事件，請改成用新增的方式描述。',
        readyToConfirm: false
      });
      return wantsJson
        ? response
        : text(200, '這個驗證版捷徑目前只支援新增事件，請改成用新增的方式描述。');
    }

    if (parsed.needsClarification) {
      const question = parsed.clarificationQuestion || '我還需要更多資訊才能幫你新增行事曆。';
      await storeShortcutDraft(env, auth.appUserEmail, {
        rawText: sourceText,
        summaryText: question,
        draft: {
          _state: 'clarify_pending',
          baseText: sourceText
        }
      });
      const response = buildPrepareResponse({
        status: 'clarify',
        question,
        spokenText: question,
        readyToConfirm: false
      });
      return wantsJson ? response : text(200, question);
    }

    const summaryText = String(parsed.userFacingSummary || '').trim();
    await storeShortcutDraft(env, auth.appUserEmail, {
      rawText: sourceText,
      summaryText,
      draft: parsed.eventDraft
    });

    const spokenText = `${summaryText || '我已整理好這筆行事曆。'}\n如果正確請輸入確認，其他內容都視為取消。`;
    const response = buildPrepareResponse({
      status: 'confirm',
      summary: summaryText,
      spokenText,
      readyToConfirm: true
    });
    return wantsJson ? response : text(200, spokenText);
  } catch (error) {
    console.error('Shortcut AI prepare failed:', error);
    return text(400, `AI 整理失敗：${normalizeShortcutAiErrorMessage(error, '請稍後再試一次。')}`);
  }
};
