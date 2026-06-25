import { Env } from './_shared';

export const normalizeCalendarWorkflowRow = (row: any) => ({
  googleEventId: String(row?.google_event_id || ''),
  autoRolloverEnabled: Number(row?.auto_rollover_enabled ?? 0) === 1,
  isConfirmed: Number(row?.is_confirmed ?? 0) === 1,
  confirmedAt: String(row?.confirmed_at || ''),
  confirmedByName: String(row?.confirmed_by_name || ''),
  confirmedByEmail: String(row?.confirmed_by_email || ''),
  lastRolloverAt: String(row?.last_rollover_at || ''),
  rolloverCount: Math.max(0, Number(row?.rollover_count ?? 0) || 0),
  createdAt: String(row?.created_at || ''),
  updatedAt: String(row?.updated_at || '')
});

export const getCalendarWorkflowMap = async (env: Env, googleEventIds: string[]) => {
  const ids = Array.from(new Set(googleEventIds.map((item) => String(item || '').trim()).filter(Boolean)));
  if (!ids.length) {
    return new Map<string, ReturnType<typeof normalizeCalendarWorkflowRow>>();
  }

  const placeholders = ids.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `
      SELECT google_event_id, auto_rollover_enabled, is_confirmed, confirmed_at, confirmed_by_name, confirmed_by_email,
             last_rollover_at, rollover_count, created_at, updated_at
      FROM calendar_event_workflow
      WHERE google_event_id IN (${placeholders})
    `
  )
    .bind(...ids)
    .all();

  return new Map(
    (result.results || []).map((row: any) => {
      const normalized = normalizeCalendarWorkflowRow(row);
      return [normalized.googleEventId, normalized] as const;
    })
  );
};

export const upsertCalendarWorkflow = async (
  env: Env,
  payload: {
    googleEventId: string;
    autoRolloverEnabled?: boolean;
    isConfirmed?: boolean;
    confirmedAt?: string;
    confirmedByName?: string;
    confirmedByEmail?: string;
    lastRolloverAt?: string;
    rolloverCount?: number;
  }
) => {
  const googleEventId = String(payload.googleEventId || '').trim();
  if (!googleEventId) return;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO calendar_event_workflow (
        google_event_id, auto_rollover_enabled, is_confirmed, confirmed_at, confirmed_by_name,
        confirmed_by_email, last_rollover_at, rollover_count, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_event_id) DO UPDATE SET
        auto_rollover_enabled = excluded.auto_rollover_enabled,
        is_confirmed = excluded.is_confirmed,
        confirmed_at = excluded.confirmed_at,
        confirmed_by_name = excluded.confirmed_by_name,
        confirmed_by_email = excluded.confirmed_by_email,
        last_rollover_at = excluded.last_rollover_at,
        rollover_count = excluded.rollover_count,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      googleEventId,
      payload.autoRolloverEnabled ? 1 : 0,
      payload.isConfirmed ? 1 : 0,
      String(payload.confirmedAt || ''),
      String(payload.confirmedByName || ''),
      String(payload.confirmedByEmail || ''),
      String(payload.lastRolloverAt || ''),
      Math.max(0, Number(payload.rolloverCount ?? 0) || 0),
      now,
      now
    )
    .run();
};

export const markCalendarEventConfirmed = async (
  env: Env,
  payload: {
    googleEventId: string;
    confirmedByName: string;
    confirmedByEmail: string;
  }
) => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO calendar_event_workflow (
        google_event_id, auto_rollover_enabled, is_confirmed, confirmed_at, confirmed_by_name,
        confirmed_by_email, last_rollover_at, rollover_count, created_at, updated_at
      )
      VALUES (?, 0, 1, ?, ?, ?, '', 0, ?, ?)
      ON CONFLICT(google_event_id) DO UPDATE SET
        is_confirmed = 1,
        confirmed_at = excluded.confirmed_at,
        confirmed_by_name = excluded.confirmed_by_name,
        confirmed_by_email = excluded.confirmed_by_email,
        updated_at = excluded.updated_at
    `
  )
    .bind(payload.googleEventId, now, payload.confirmedByName, payload.confirmedByEmail, now, now)
    .run();
};

export const markCalendarEventUnconfirmed = async (
  env: Env,
  payload: {
    googleEventId: string;
  }
) => {
  const googleEventId = String(payload.googleEventId || '').trim();
  if (!googleEventId) return;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO calendar_event_workflow (
        google_event_id, auto_rollover_enabled, is_confirmed, confirmed_at, confirmed_by_name,
        confirmed_by_email, last_rollover_at, rollover_count, created_at, updated_at
      )
      VALUES (?, 0, 0, '', '', '', '', 0, ?, ?)
      ON CONFLICT(google_event_id) DO UPDATE SET
        is_confirmed = 0,
        confirmed_at = '',
        confirmed_by_name = '',
        confirmed_by_email = '',
        updated_at = excluded.updated_at
    `
  )
    .bind(googleEventId, now, now)
    .run();
};

export const deleteCalendarWorkflow = async (env: Env, googleEventId: string) => {
  await env.DB.prepare(
    'DELETE FROM calendar_event_workflow WHERE google_event_id = ?'
  )
    .bind(String(googleEventId || '').trim())
    .run();
};
