interface Env {
  DB: D1Database;
}

const SETTINGS_ID = 'global';
const FRANKFURTER_RATE_URL = 'https://api.frankfurter.dev/v2/rate/USD/TWD';
const FRANKFURTER_SOURCE = 'Frankfurter';
const FX_CACHE_TTL_MS = 60 * 60 * 1000;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });

const shouldReuseCachedRate = (updatedAt: string) => {
  if (!updatedAt) return false;
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp < FX_CACHE_TTL_MS;
};

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  const cached = await env.DB.prepare(
    `
      SELECT usd_twd_reference_rate, usd_twd_reference_updated_at, usd_twd_reference_source
      FROM app_settings
      WHERE id = ?
    `
  ).bind(SETTINGS_ID).first();

  if (!force && cached && shouldReuseCachedRate(String((cached as any)?.usd_twd_reference_updated_at || ''))) {
    return json(200, {
      ok: true,
      rate: Number((cached as any)?.usd_twd_reference_rate || 0),
      updatedAt: String((cached as any)?.usd_twd_reference_updated_at || ''),
      source: String((cached as any)?.usd_twd_reference_source || FRANKFURTER_SOURCE),
      cached: true
    });
  }

  const response = await fetch(FRANKFURTER_RATE_URL, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    return json(502, { ok: false, error: `FX source ${response.status}` });
  }

  const data = await response.json();
  const rate = Number((data as any)?.rate || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return json(502, { ok: false, error: 'Invalid FX rate payload' });
  }

  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `
      INSERT INTO app_settings (
        id, google_sheet_id, ai_mentor_enabled, ai_api_link, updated_at,
        usd_twd_reference_rate, usd_twd_reference_updated_at, usd_twd_reference_source
      )
      VALUES (?, '', 1, '', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        usd_twd_reference_rate = excluded.usd_twd_reference_rate,
        usd_twd_reference_updated_at = excluded.usd_twd_reference_updated_at,
        usd_twd_reference_source = excluded.usd_twd_reference_source,
        updated_at = excluded.updated_at
    `
  )
    .bind(SETTINGS_ID, updatedAt, rate, updatedAt, FRANKFURTER_SOURCE)
    .run();

  return json(200, {
    ok: true,
    rate,
    updatedAt,
    source: FRANKFURTER_SOURCE,
    cached: false
  });
};
