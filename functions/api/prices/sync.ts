interface Env {
  PRICE_SYNC_KEY?: string;
  PRICE_SYNC_TRIGGER_URL?: string;
}

type PagesFunction<TEnv> = (context: { request: Request; env: TEnv }) => Promise<Response> | Response;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const actorEmail = String(request.headers.get('x-kidsledger-user-email') || '').trim();
  if (!actorEmail) {
    return json(401, { ok: false, error: 'Missing user context' });
  }

  const syncKey = String(env.PRICE_SYNC_KEY || '').trim();
  const triggerUrl = String(env.PRICE_SYNC_TRIGGER_URL || '').trim();

  if (!syncKey) {
    return json(500, { ok: false, error: 'PRICE_SYNC_KEY is not configured' });
  }
  if (!triggerUrl) {
    return json(500, { ok: false, error: 'PRICE_SYNC_TRIGGER_URL is not configured' });
  }

  const url = new URL(triggerUrl);
  url.searchParams.set('force', '1');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'x-price-sync-key': syncKey
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json(response.status, {
      ok: false,
      error: String((data as any)?.error || `Price sync trigger ${response.status}`)
    });
  }

  return json(200, {
    ok: true,
    skipped: (data as any)?.skipped === true,
    reason: String((data as any)?.reason || ''),
    checkedAt: String((data as any)?.checkedAt || ''),
    tradingDate: String((data as any)?.tradingDate || ''),
    tradingTime: String((data as any)?.tradingTime || ''),
    symbols: Math.max(0, Number((data as any)?.symbols || 0)),
    updated: Math.max(0, Number((data as any)?.updated || 0))
  });
};
