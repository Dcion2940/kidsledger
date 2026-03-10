interface Env {
  HIDDEN_KEY?: string;
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
  if (!env.HIDDEN_KEY) {
    return json(500, { ok: false, error: 'HIDDEN_KEY is not configured' });
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

  if (payload.password !== env.HIDDEN_KEY) {
    return json(401, { ok: false });
  }

  return json(200, { ok: true });
};
