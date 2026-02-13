
import { GoogleGenAI } from "@google/genai";
import { Transaction, TransactionType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getFinancialAdvice = async (childName: string, transactions: Transaction[]) => {
  const summary = transactions.reduce((acc, t) => {
    if (t.type === TransactionType.INCOME) acc.income += t.amount;
    else if (t.type === TransactionType.EXPENSE) acc.expense += t.amount;
    else acc.investment += t.amount;
    return acc;
  }, { income: 0, expense: 0, investment: 0 });

  const prompt = `
    你是一位溫柔有趣的理財導師。請根據以下小朋友的收支狀況給予一段短評與建議：
    小朋友姓名：${childName}
    總收入：$${summary.income}
    總支出：$${summary.expense}
    投資金額：$${summary.investment}
    結餘：$${summary.income - summary.expense - summary.investment}

    請用適合 8-12 歲小孩閱讀的語氣（使用繁體中文），並加入一些鼓勵。
    字數在 150 字以內。
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "理財小幫手正在休息，請晚點再試！";
  }
};
