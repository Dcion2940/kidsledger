interface Env {
  APP_LOCK_KEY?: string;
}

interface VerifyRequestBody {
  password?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.APP_LOCK_KEY) {
    return json(500, { ok: false, error: 'APP_LOCK_KEY is not configured' });
  }

  let payload: VerifyRequestBody = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  if (!payload.password) {
    return json(400, { ok: false, error: 'Password is required' });
  }

  if (payload.password !== env.APP_LOCK_KEY) {
    return json(401, { ok: false, error: 'Invalid password' });
  }

  return json(200, { ok: true });
};
