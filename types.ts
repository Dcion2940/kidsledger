
export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  INVESTMENT = 'INVESTMENT'
}

export type FamilyCashType = 'DEPOSIT' | 'WITHDRAW';
export type InvestmentMarket = 'TW' | 'US';
export type TradeAction = 'BUY' | 'SELL';
export type OrderChannel = 'ELECTRONIC' | 'MANUAL';
export type SupportedCurrency = 'TWD' | 'USD';

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
  market: InvestmentMarket;
  symbol: string;
  companyName: string;
  quantity: number;
  price: number;
  totalAmount: number;
  action: TradeAction;
  broker?: string;
  orderChannel?: OrderChannel;
  tradeCurrency?: SupportedCurrency;
  settlementCurrency?: SupportedCurrency;
  fxRateToTwd?: number;
  feeAmount?: number;
  feeCurrency?: SupportedCurrency;
  netAmountTwd?: number;
  sellStrategy?: 'FIFO' | 'LOWEST_COST' | 'SPECIFIC';
  sellAllocations?: string;
}

export interface FamilyCashRecord {
  id: string;
  date: string;
  type: FamilyCashType;
  amount: number;
  actorName: string;
  actorEmail: string;
}

export interface Price {
  symbol: string;
  companyName?: string;
  market?: InvestmentMarket;
  currency?: SupportedCurrency;
  price: number;
  fxRateToTwd?: number;
  updatedAt?: string;
}

export interface Child {
  id: string;
  name: string;
  avatar: string;
  role?: 'CHILD' | 'ADULT';
  avatarSeed?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
  accessToken: string;
  expiresAt?: number;
}

export interface AppSettings {
  aiMentorEnabled: boolean;
  aiApiLink: string;
  idleLockMinutes: number;
  telegramChatId: string;
  telegramNotifyOnCreate: boolean;
  telegramNotifyOnStart: boolean;
  telegramBotTokenConfigured: boolean;
  usdTwdReferenceRate: number;
  usdTwdReferenceUpdatedAt: string;
  usdTwdReferenceSource: string;
}

export interface CalendarConnectionStatus {
  authorized?: boolean;
  connected: boolean;
  provider: string;
  googleEmail: string;
  googleDisplayName: string;
  calendarId: string;
  calendarName: string;
  scope: string;
  tokenExpiresAt: string;
  updatedAt: string;
}

export interface GoogleCalendarOption {
  id: string;
  summary: string;
  description: string;
  primary: boolean;
  selected: boolean;
  accessRole: string;
  backgroundColor: string;
  foregroundColor: string;
}

export interface CalendarEventSummary {
  id: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  attendeesCount: number;
  creatorEmail: string;
  organizerEmail: string;
  status: string;
  autoRolloverEnabled?: boolean;
  isConfirmed?: boolean;
  confirmedAt?: string;
  confirmedByName?: string;
  rolloverCount?: number;
}

export interface CalendarReminder {
  method: 'popup' | 'email';
  minutes: number;
}

export interface CalendarAttendee {
  email: string;
  displayName: string;
  responseStatus?: string;
}

export interface CalendarEventDraft {
  id?: string;
  title: string;
  description: string;
  location: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  reminders: CalendarReminder[];
  autoRolloverEnabled?: boolean;
  isConfirmed?: boolean;
}

export interface CalendarEventWorkflow {
  googleEventId: string;
  autoRolloverEnabled: boolean;
  isConfirmed: boolean;
  confirmedAt: string;
  confirmedByName: string;
  confirmedByEmail: string;
  lastRolloverAt: string;
  rolloverCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarMember {
  id: string;
  displayName: string;
  nickname: string;
  aliases: string[];
  email: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}
