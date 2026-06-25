import {
  authorizeShortcutRequest,
  createCalendarEventFromDraft,
  deleteShortcutDraft,
  loadShortcutDraft,
  normalizeShortcutAiErrorMessage,
  ShortcutAiEnv,
  text
} from './_shared';

export const onRequestPost: PagesFunction<ShortcutAiEnv> = async ({ env, request }) => {
  const auth = await authorizeShortcutRequest(env, request);
  if (!auth.ok) return auth.response;

  try {
    const stored = await loadShortcutDraft(env, auth.appUserEmail);
    if (!stored) {
      return text(400, '找不到剛剛整理好的草稿，請重新說一次。');
    }

    const result = await createCalendarEventFromDraft(env, auth.appUserEmail, stored.draft);
    await deleteShortcutDraft(env, auth.appUserEmail);
    return text(200, String(result.message || '已建立事件。'));
  } catch (error) {
    console.error('Shortcut AI commit failed:', error);
    return text(400, `建立失敗：${normalizeShortcutAiErrorMessage(error, '請稍後再試一次。')}`);
  }
};
