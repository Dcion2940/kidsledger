import { processDueTelegramJobs, TelegramEnv } from '../_lib/telegram';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const onRequestPost: PagesFunction<TelegramEnv> = async ({ request, env }) => {
  const configuredSecret = String(env.TELEGRAM_JOB_SECRET || '').trim();
  if (!configuredSecret) {
    return json(500, { ok: false, error: 'TELEGRAM_JOB_SECRET is not configured' });
  }

  const requestSecret = String(request.headers.get('x-telegram-job-secret') || '').trim();
  if (!requestSecret || requestSecret !== configuredSecret) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  try {
    const result = await processDueTelegramJobs(env);
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to process Telegram jobs'
    });
  }
};
