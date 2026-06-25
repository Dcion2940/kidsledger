interface CalendarRolloverWorkerEnv {
  CALENDAR_ROLLOVER_SECRET?: string;
  ROLLOVER_API_URL?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });

const triggerRollover = async (env: CalendarRolloverWorkerEnv) => {
  const rolloverApiUrl = String(env.ROLLOVER_API_URL || '').trim();
  const rolloverSecret = String(env.CALENDAR_ROLLOVER_SECRET || '').trim();

  if (!rolloverApiUrl) {
    throw new Error('ROLLOVER_API_URL is not configured');
  }
  if (!rolloverSecret) {
    throw new Error('CALENDAR_ROLLOVER_SECRET is not configured');
  }

  const response = await fetch(rolloverApiUrl, {
    method: 'POST',
    headers: {
      'x-calendar-rollover-secret': rolloverSecret
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as any)?.error || `Rollover API ${response.status}`));
  }

  return data as { ok?: boolean; processed?: number; yesterday?: string };
};

export default {
  async scheduled(_controller: ScheduledController, env: CalendarRolloverWorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(triggerRollover(env));
  },

  async fetch(request: Request, env: CalendarRolloverWorkerEnv) {
    const url = new URL(request.url);
    const targetDate = String(url.searchParams.get('targetDate') || '').trim();
    const dryRun = url.searchParams.get('dryRun') === '1';
    const rolloverApiUrl = String(env.ROLLOVER_API_URL || '').trim();
    const rolloverSecret = String(env.CALENDAR_ROLLOVER_SECRET || '').trim();

    const response = await fetch(rolloverApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-calendar-rollover-secret': rolloverSecret
      },
      body: JSON.stringify({
        targetDate,
        dryRun
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(response.status, {
        ok: false,
        error: String((result as any)?.error || `Rollover API ${response.status}`)
      });
    }

    return json(200, {
      ok: true,
      processed: Number((result as any)?.processed || 0),
      yesterday: String((result as any)?.yesterday || ''),
      dryRun: (result as any)?.dryRun === true,
      diagnostics: Array.isArray((result as any)?.diagnostics) ? (result as any).diagnostics : []
    });
  }
};
