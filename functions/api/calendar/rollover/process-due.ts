import { Env, json } from '../_shared';
import { processCalendarRollovers } from './_process';

export const onRequestPost: PagesFunction<Env & { CALENDAR_ROLLOVER_SECRET?: string }> = async ({ env, request }) => {
  const configuredSecret = String(env.CALENDAR_ROLLOVER_SECRET || '').trim();
  if (!configuredSecret) {
    return json(500, { ok: false, error: 'CALENDAR_ROLLOVER_SECRET is not configured' });
  }

  const requestSecret = String(request.headers.get('x-calendar-rollover-secret') || '').trim();
  if (!requestSecret || requestSecret !== configuredSecret) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  let payload: { targetDate?: string; dryRun?: boolean } = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const { processed, yesterday, dryRun, diagnostics } = await processCalendarRollovers(env, {
    targetDate: payload.targetDate,
    dryRun: payload.dryRun === true
  });

  return json(200, {
    ok: true,
    processed,
    yesterday,
    dryRun,
    diagnostics
  });
};
