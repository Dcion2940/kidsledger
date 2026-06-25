import { Transaction } from "../types";

export const getFinancialAdvice = async (childName: string, transactions: Transaction[]) => {
  try {
    const response = await fetch('/api/ai/financial-advice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ childName, transactions })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `AI advice API ${response.status}`);
    }

    return String(data?.advice || '今天也有認真管理金錢，做得很棒！');
  } catch (error) {
    console.error('OpenAI advice error:', error);
    return 'AI 小幫手目前忙碌中，稍後再試一次也可以。';
  }
};
