import { createOpenAiTextResponse } from '../_lib/openai';

interface Env {
  OPENAI_API_KEY?: string;
}

interface FinancialAdvicePayload {
  childName?: string;
  transactions?: Array<{
    type?: string;
    amount?: number;
  }>;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  let payload: FinancialAdvicePayload = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body' });
  }

  const childName = String(payload.childName || '').trim() || '小朋友';
  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const summary = transactions.reduce(
    (acc, item) => {
      const amount = Number(item?.amount || 0);
      const type = String(item?.type || '').toUpperCase();
      if (type === 'INCOME') acc.income += amount;
      else if (type === 'EXPENSE') acc.expense += amount;
      else acc.investment += amount;
      return acc;
    },
    { income: 0, expense: 0, investment: 0 }
  );

  try {
    const advice = await createOpenAiTextResponse(
      env,
      [
        {
          role: 'system',
          content:
            '你是一位溫柔、鼓勵型的兒童理財導師。請用繁體中文回答，適合 8-12 歲閱讀，語氣親切，字數控制在 150 字內。'
        },
        {
          role: 'user',
          content: `請根據以下資料給 ${childName} 一段理財建議：
總收入：${summary.income}
總支出：${summary.expense}
投資金額：${summary.investment}
結餘：${summary.income - summary.expense - summary.investment}`
        }
      ],
      { temperature: 0.4 }
    );

    return json(200, { ok: true, advice });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'OpenAI financial advice failed'
    });
  }
};
