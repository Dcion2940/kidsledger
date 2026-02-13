
export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  INVESTMENT = 'INVESTMENT'
}

export interface Transaction {
  id: string;
  childId: string;
  date: string;
  type: TransactionType;
  category: string;
  amount: number;
  description: string;
}

export interface Investment {
  id: string;
  childId: string;
  date: string;
  symbol: string;
  companyName: string;
  quantity: number;
  price: number;
  totalAmount: number;
  action: 'BUY' | 'SELL';
}

export interface Child {
  id: string;
  name: string;
  avatar: string;
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
  accessToken: string;
}

export interface AppSettings {
  googleSheetId: string;
}
