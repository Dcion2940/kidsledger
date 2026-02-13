
import { Transaction, Investment, Child } from "../types";

export class GoogleSheetsService {
  private accessToken: string;
  private sheetId: string;

  constructor(accessToken: string, sheetId: string) {
    this.accessToken = accessToken;
    this.sheetId = sheetId;
  }

  private async request(range: string, method: string = 'GET', body?: any) {
    if (!this.sheetId) throw new Error("尚未設定 Google Sheet ID");
    
    let url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}`;
    
    if (method === 'APPEND') {
      url += ':append?valueInputOption=USER_ENTERED';
      method = 'POST';
    } else if (method === 'UPDATE') {
      url += '?valueInputOption=USER_ENTERED';
      method = 'PUT';
    }
    
    const options: RequestInit = {
      method: method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Google Sheets API 錯誤');
    }
    return await response.json();
  }

  private async findRowIndex(sheetName: string, id: string): Promise<number | null> {
    const data = await this.request(`${sheetName}!A:A`);
    const rows = data.values || [];
    const index = rows.findIndex((row: any[]) => row[0] === id);
    return index !== -1 ? index + 1 : null;
  }

  async getChildren(): Promise<Child[]> {
    try {
      const data = await this.request('Children!A2:C');
      return (data.values || [])
        .filter((row: any[]) => row[0] && row[1])
        .map((row: any[]) => ({
          id: row[0],
          name: row[1],
          avatar: row[2]
        }));
    } catch (e) {
      return JSON.parse(localStorage.getItem('children_list') || '[]');
    }
  }

  async syncChildren(children: Child[]) {
    const header = ['ID', 'Name', 'Avatar'];
    const rows = children.map(c => [c.id, c.name, c.avatar]);
    // 清除至第 51 行
    const emptyRows = Array(Math.max(0, 50 - rows.length)).fill(['', '', '']);
    const values = [header, ...rows, ...emptyRows];
    
    try {
      await this.request('Children!A1:C51', 'UPDATE', { values });
      localStorage.setItem('children_list', JSON.stringify(children));
    } catch (e) {
      console.error("同步小朋友失敗", e);
    }
  }

  async getTransactions(): Promise<Transaction[]> {
    try {
      const data = await this.request('Transactions!A2:G');
      return (data.values || [])
        .filter((row: any[]) => row[0])
        .map((row: any[]) => ({
          id: row[0],
          childId: row[1],
          date: row[2],
          type: row[3],
          category: row[4],
          amount: Number(row[5]),
          description: row[6]
        }));
    } catch (e) {
      return JSON.parse(localStorage.getItem('transactions') || '[]');
    }
  }

  async addTransaction(t: Transaction) {
    const values = [[t.id, t.childId, t.date, t.type, t.category, t.amount, t.description]];
    await this.request('Transactions!A:G', 'APPEND', { values });
  }

  async updateTransaction(t: Transaction) {
    const rowIndex = await this.findRowIndex('Transactions', t.id);
    if (rowIndex) {
      const values = [[t.id, t.childId, t.date, t.type, t.category, t.amount, t.description]];
      await this.request(`Transactions!A${rowIndex}:G${rowIndex}`, 'UPDATE', { values });
    }
  }

  async deleteTransaction(id: string) {
    const rowIndex = await this.findRowIndex('Transactions', id);
    if (rowIndex) {
      const values = [['', '', '', '', '', '', '']];
      await this.request(`Transactions!A${rowIndex}:G${rowIndex}`, 'UPDATE', { values });
    }
  }

  async getInvestments(): Promise<Investment[]> {
    try {
      const data = await this.request('Investments!A2:I');
      return (data.values || [])
        .filter((row: any[]) => row[0])
        .map((row: any[]) => ({
          id: row[0],
          childId: row[1],
          date: row[2],
          symbol: row[3],
          companyName: row[4],
          quantity: Number(row[5]),
          price: Number(row[6]),
          totalAmount: Number(row[7]),
          action: row[8] as 'BUY' | 'SELL'
        }));
    } catch (e) {
      return JSON.parse(localStorage.getItem('investments') || '[]');
    }
  }

  async addInvestment(inv: Investment) {
    const values = [[inv.id, inv.childId, inv.date, inv.symbol, inv.companyName, inv.quantity, inv.price, inv.totalAmount, inv.action]];
    await this.request('Investments!A:I', 'APPEND', { values });
  }

  async updateInvestment(inv: Investment) {
    const rowIndex = await this.findRowIndex('Investments', inv.id);
    if (rowIndex) {
      const values = [[inv.id, inv.childId, inv.date, inv.symbol, inv.companyName, inv.quantity, inv.price, inv.totalAmount, inv.action]];
      await this.request(`Investments!A${rowIndex}:I${rowIndex}`, 'UPDATE', { values });
    }
  }

  async deleteInvestment(id: string) {
    const rowIndex = await this.findRowIndex('Investments', id);
    if (rowIndex) {
      const values = [['', '', '', '', '', '', '', '', '']];
      await this.request(`Investments!A${rowIndex}:I${rowIndex}`, 'UPDATE', { values });
    }
  }
}
