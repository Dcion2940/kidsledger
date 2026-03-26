
import { Transaction, Investment, Child, Price } from "../types";

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

  private async spreadsheetRequest(path: string, method: string = 'GET', body?: any) {
    if (!this.sheetId) throw new Error("尚未設定 Google Sheet ID");

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${path}`;
    const options: RequestInit = {
      method,
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

  private stripHeader(rows: any[][], expectedFirstColumn: string): any[][] {
    if (!rows.length) return rows;
    const firstCell = String(rows[0]?.[0] ?? '').trim().toLowerCase();
    if (firstCell === expectedFirstColumn.toLowerCase()) {
      return rows.slice(1);
    }
    return rows;
  }

  private async ensurePricesSheetExists() {
    try {
      await this.request('Prices!A1:D1');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('Unable to parse range') &&
        !message.includes('does not exist') &&
        !message.includes('Prices')
      ) {
        throw error;
      }
    }

    await this.spreadsheetRequest(':batchUpdate', 'POST', {
      requests: [
        {
          addSheet: {
            properties: {
              title: 'Prices'
            }
          }
        }
      ]
    });

    await this.request('Prices!A1:D1', 'UPDATE', {
      values: [['Symbol', 'CompanyName', 'Price', 'UpdatedAt']]
    });
  }

  async getChildren(): Promise<Child[]> {
    const data = await this.request('Children!A:E');
    const rows = this.stripHeader(data.values || [], 'ID');
    return rows
      .filter((row: any[]) => row[0] && row[1])
      .map((row: any[]) => {
        const col3 = row[3] || '';
        const col4 = row[4] || '';
        const role = col3 === 'ADULT' ? 'ADULT' : 'CHILD';
        const avatarSeed = col3 === 'CHILD' || col3 === 'ADULT' ? (col4 || '') : (col3 || col4 || '');
        return {
          id: row[0],
          name: row[1],
          avatar: row[2],
          role,
          avatarSeed
        };
      });
  }

  async syncChildren(children: Child[]) {
    const header = ['ID', 'Name', 'Avatar', 'Role', 'AvatarSeed'];
    const rows = children.map(c => [c.id, c.name, c.avatar, c.role || 'CHILD', c.avatarSeed || '']);
    // 清除至第 51 行
    const emptyRows = Array(Math.max(0, 50 - rows.length)).fill(['', '', '', '', '']);
    const values = [header, ...rows, ...emptyRows];
    
    await this.request('Children!A1:E51', 'UPDATE', { values });
    localStorage.setItem('children_list', JSON.stringify(children));
  }

  async getTransactions(): Promise<Transaction[]> {
    const data = await this.request('Transactions!A:G');
    const rows = this.stripHeader(data.values || [], 'ID');
    return rows
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
    const data = await this.request('Investments!A:K');
    const rows = this.stripHeader(data.values || [], 'ID');
    return rows
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
        action: row[8] as 'BUY' | 'SELL',
        sellStrategy: row[9] || undefined,
        sellAllocations: row[10] || undefined
      }));
  }

  async addInvestment(inv: Investment) {
    const values = [[
      inv.id,
      inv.childId,
      inv.date,
      inv.symbol,
      inv.companyName,
      inv.quantity,
      inv.price,
      inv.totalAmount,
      inv.action,
      inv.sellStrategy || '',
      inv.sellAllocations || ''
    ]];
    await this.request('Investments!A:K', 'APPEND', { values });
  }

  async updateInvestment(inv: Investment) {
    const rowIndex = await this.findRowIndex('Investments', inv.id);
    if (rowIndex) {
      const values = [[
        inv.id,
        inv.childId,
        inv.date,
        inv.symbol,
        inv.companyName,
        inv.quantity,
        inv.price,
        inv.totalAmount,
        inv.action,
        inv.sellStrategy || '',
        inv.sellAllocations || ''
      ]];
      await this.request(`Investments!A${rowIndex}:K${rowIndex}`, 'UPDATE', { values });
    }
  }

  async deleteInvestment(id: string) {
    const rowIndex = await this.findRowIndex('Investments', id);
    if (rowIndex) {
      const values = [['', '', '', '', '', '', '', '', '', '', '']];
      await this.request(`Investments!A${rowIndex}:K${rowIndex}`, 'UPDATE', { values });
    }
  }

  async getPrices(): Promise<Price[]> {
    try {
      const data = await this.request('Prices!A:D');
      const rows = this.stripHeader(data.values || [], 'Symbol');
      return rows
        .filter((row: any[]) => row[0])
        .map((row: any[]) => ({
          symbol: String(row[0]).toUpperCase(),
          companyName: row[1] || '',
          price: Number(row[2] || 0),
          updatedAt: row[3] || ''
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Unable to parse range') ||
        message.includes('does not exist') ||
        message.includes('Prices')
      ) {
        await this.ensurePricesSheetExists();
        return [];
      }
      throw error;
    }
  }

  async addPrice(price: Price) {
    await this.ensurePricesSheetExists();
    const values = [[price.symbol.toUpperCase(), price.companyName || '', price.price || '', price.updatedAt || '']];
    await this.request('Prices!A:D', 'APPEND', { values });
  }
}
