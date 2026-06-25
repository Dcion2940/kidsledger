import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Transaction, Investment, Child, UserProfile, TransactionType, AppSettings, Price, FamilyCashRecord, FamilyCashType, CalendarConnectionStatus, CalendarMember, GoogleCalendarOption, CalendarEventSummary, CalendarEventDraft } from './types';
import TransactionForm from './components/TransactionForm';
import InvestmentRecord from './components/InvestmentRecord';
import AppLockOverlay from './components/AppLockOverlay';
import { getFinancialAdvice } from './services/openaiService';
import { storageManager } from './utils/storage';
import {
  DEFAULT_US_BROKER,
  DEFAULT_US_ORDER_CHANNEL,
  calculateNetAmountTwd,
  calculateTradeTotal,
  getPriceFxRateToTwd,
  normalizeInvestment,
  normalizePrice
} from './utils/investments';
import { 
  Wallet, 
  BarChart3, 
  Settings, 
  LogOut, 
  Sparkles, 
  ArrowUpCircle, 
  ArrowDownCircle,
  PiggyBank,
  Download,
  Database,
  Pencil,
  Trash2,
  UserPlus,
  UserMinus,
  X,
  Plus,
  PlusCircle,
  AlertTriangle,
  Menu,
  RefreshCcw,
  CalendarDays,
  Link2,
  Clock3,
  Mic,
  Square,
  ChevronLeft
} from 'lucide-react';
import { 
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

const DEFAULT_CHILDREN: Child[] = [
  { id: '1', name: '小明', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ming', role: 'CHILD', avatarSeed: 'Ming' }
];

const buildAvatarUrl = (seed: string) => `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;

const extractAvatarSeed = (avatar?: string) => {
  if (!avatar) return '';
  try {
    const url = new URL(avatar);
    return url.searchParams.get('seed') || '';
  } catch {
    return '';
  }
};

const normalizeChild = (child: Child): Child => {
  const role = child.role || 'CHILD';
  const avatarSeed = child.avatarSeed || extractAvatarSeed(child.avatar) || child.name || child.id;
  return {
    ...child,
    role,
    avatarSeed,
    avatar: child.avatar || buildAvatarUrl(avatarSeed)
  };
};

const USER_STORAGE_KEY = 'kidsledger_user';
const APP_TABS = ['DASHBOARD', 'INVESTMENTS', 'FAMILY_CASH', 'CALENDAR'] as const;
const DEFAULT_ACTIVE_TAB = 'CALENDAR';
const DEFAULT_IDLE_LOCK_MINUTES = 10;
const APP_LOCK_SESSION_KEY = 'kidsledger_app_lock_session';
const PASSKEY_SESSION_LIFETIME_SECONDS = 900;
const DEFAULT_CALENDAR_CONNECTION_STATUS: CalendarConnectionStatus = {
  authorized: false,
  connected: false,
  provider: 'google',
  googleEmail: '',
  googleDisplayName: '',
  calendarId: '',
  calendarName: '',
  scope: '',
  tokenExpiresAt: '',
  updatedAt: ''
};
const CALENDAR_WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const CALENDAR_REMINDER_PRESET_OPTIONS = [0, 10, 30, 60, 1440];

type AppTab = typeof APP_TABS[number];

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildCalendarMonthGrid = (monthDate: Date) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + index);
    return cellDate;
  });
};

const formatCalendarMonthLabel = (monthDate: Date) =>
  `${monthDate.getFullYear()} 年 ${monthDate.getMonth() + 1} 月`;

const formatCalendarEventTime = (event: CalendarEventSummary) => {
  if (event.allDay) return '全天';
  const start = event.start.includes('T') ? event.start.slice(11, 16) : '';
  const end = event.end.includes('T') ? event.end.slice(11, 16) : '';
  return start && end ? `${start} - ${end}` : start || '未設定時間';
};

const formatCalendarEventChipLabel = (event: CalendarEventSummary) => {
  const title = event.title || '未命名事件';
  if (event.allDay) return title;
  const start = event.start.includes('T') ? event.start.slice(11, 16) : '';
  return start ? `${title} ${start}` : title;
};

const formatCalendarDayLabel = (dateText: string) => {
  if (!dateText) return '';
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  return `${dateText}（${CALENDAR_WEEKDAY_LABELS[date.getDay()]}）`;
};

const formatTimeFromDate = (date: Date) =>
  `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;

const createEmptyCalendarDraft = (): CalendarEventDraft => {
  const now = new Date();
  now.setSeconds(0, 0);
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    title: '',
    description: '',
    location: '',
    startDate: formatLocalDate(now),
    endDate: formatLocalDate(end),
    startTime: formatTimeFromDate(now),
    endTime: formatTimeFromDate(end),
    allDay: false,
    reminders: [{ method: 'popup', minutes: 30 }],
    autoRolloverEnabled: false,
    isConfirmed: false
  };
};

const ensureCalendarDraftEndAfterStart = (
  draft: CalendarEventDraft,
  nextStartDate: string,
  nextStartTime: string
): CalendarEventDraft => {
  if (draft.allDay) {
    return {
      ...draft,
      startDate: nextStartDate,
      endDate: !draft.endDate || draft.endDate < nextStartDate ? nextStartDate : draft.endDate
    };
  }

  const startAt = new Date(`${nextStartDate}T${nextStartTime || draft.startTime || '09:00'}:00+08:00`);
  const currentEndAt = new Date(`${draft.endDate || nextStartDate}T${draft.endTime || '10:00'}:00+08:00`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(currentEndAt.getTime())) {
    return {
      ...draft,
      startDate: nextStartDate,
      startTime: nextStartTime
    };
  }

  if (currentEndAt <= startAt) {
    const nextEndAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    return {
      ...draft,
      startDate: nextStartDate,
      startTime: nextStartTime,
      endDate: formatLocalDate(nextEndAt),
      endTime: formatTimeFromDate(nextEndAt)
    };
  }

  return {
    ...draft,
    startDate: nextStartDate,
    startTime: nextStartTime
  };
};

const createCalendarAiMessage = (
  role: 'user' | 'assistant',
  text: string,
  tone: 'default' | 'clarification' | 'success' = 'default'
) => ({
  id: `calendar-ai-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  text,
  tone
});

type AppUnlockMethod = 'password' | 'passkey';

interface PasskeySummary {
  id: string;
  deviceName: string;
  transports: string[];
  rpId: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

interface AppLockSessionPayload {
  locked: boolean;
  unlockedAt?: number;
  unlockMethod?: AppUnlockMethod;
  passkeyToken?: string;
  passkeyExpiresAt?: number;
}

interface CalendarAiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tone?: 'default' | 'clarification' | 'success';
}

interface SellAllocationEntry {
  lotId: string;
  quantity: number;
}

interface DashboardLotState {
  lotId: string;
  symbol: string;
  market: 'TW' | 'US';
  buyDate: string;
  remainingQuantity: number;
  remainingCost: number;
  remainingCostTwd: number;
  unitCost: number;
  unitCostTwd: number;
}

const getInvestmentLookupKey = (market: 'TW' | 'US', symbol: string) => `${market}:${symbol.trim().toUpperCase()}`;

const normalizeIdleLockMinutes = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_IDLE_LOCK_MINUTES;
  }
  return Math.max(1, Math.round(parsed));
};

const parseSellAllocations = (raw?: string): SellAllocationEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        lotId: String(item?.lotId || ''),
        quantity: Number(item?.quantity || 0)
      }))
      .filter((item) => item.lotId && item.quantity > 0);
  } catch {
    return [];
  }
};

const arrayBufferToBase64Url = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToUint8Array = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const isIgnorablePasskeyError = (error: unknown) => {
  if (!(error instanceof Error)) return false;

  const normalizedMessage = error.message.toLowerCase();
  return (
    error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    normalizedMessage.includes('user denied permission') ||
    normalizedMessage.includes('the request is not allowed') ||
    normalizedMessage.includes('passkey 驗證已取消')
  );
};

const readAppLockSession = () => {
  try {
    const raw = sessionStorage.getItem(APP_LOCK_SESSION_KEY);
    if (!raw) return { locked: false } as AppLockSessionPayload;
    const parsed = JSON.parse(raw) as AppLockSessionPayload;
    const inferredUnlockMethod =
      parsed.unlockMethod === 'password' || parsed.unlockMethod === 'passkey'
        ? parsed.unlockMethod
        : parsed.unlockedAt
          ? 'password'
          : undefined;
    return {
      locked: parsed.locked === true,
      unlockedAt: typeof parsed.unlockedAt === 'number' ? parsed.unlockedAt : undefined,
      unlockMethod: inferredUnlockMethod,
      passkeyToken: typeof parsed.passkeyToken === 'string' ? parsed.passkeyToken : undefined,
      passkeyExpiresAt: typeof parsed.passkeyExpiresAt === 'number' ? parsed.passkeyExpiresAt : undefined
    };
  } catch {
    sessionStorage.removeItem(APP_LOCK_SESSION_KEY);
    return { locked: false } as AppLockSessionPayload;
  }
};

const saveAppLockSession = (payload: AppLockSessionPayload) => {
  sessionStorage.setItem(APP_LOCK_SESSION_KEY, JSON.stringify(payload));
};

const clearAppLockSession = () => {
  sessionStorage.removeItem(APP_LOCK_SESSION_KEY);
};

const shouldRequireAppUnlock = () => {
  const savedUser = getSavedUser();
  if (!savedUser) return false;
  if (!storageManager.getCurrentDeviceAppLockPreference(savedUser.email).requireAppUnlock) {
    return false;
  }

  const session = readAppLockSession();
  if (
    session.unlockMethod === 'passkey' &&
    session.passkeyExpiresAt &&
    session.passkeyExpiresAt <= Date.now()
  ) {
    clearAppLockSession();
    return true;
  }
  return session.locked || !session.unlockedAt;
};

const getSavedUser = (): UserProfile | null => {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
};

const getSavedPrices = (): Price[] => {
  try {
    return (JSON.parse(localStorage.getItem('prices') || '[]') as any[])
      .map(normalizePrice)
      .filter((item) => item.symbol);
  } catch {
    return [];
  }
};

const getSavedTransactions = (): Transaction[] => {
  try {
    return JSON.parse(localStorage.getItem('transactions') || '[]');
  } catch {
    return [];
  }
};

const getSavedInvestments = (): Investment[] => {
  try {
    return (JSON.parse(localStorage.getItem('investments') || '[]') as any[])
      .map(normalizeInvestment)
      .filter((item) => item.id);
  } catch {
    return [];
  }
};

const getSavedFamilyCashRecords = (): FamilyCashRecord[] => {
  try {
    return (JSON.parse(localStorage.getItem('family_cash_records') || '[]') as FamilyCashRecord[]).map((record) => ({
      ...record,
      actorName: String(record?.actorName || ''),
      actorEmail: String(record?.actorEmail || '')
    }));
  } catch {
    return [];
  }
};

const getSavedChildren = (): Child[] => {
  try {
    return (JSON.parse(localStorage.getItem('children_list') || '[]') as Child[]).map(normalizeChild);
  } catch {
    return [];
  }
};

const normalizeUserEmail = (email?: string | null) => String(email || '').trim().toLowerCase();

const isAppTab = (value: unknown): value is AppTab =>
  typeof value === 'string' && APP_TABS.includes(value as AppTab);

const getLastActiveTabStorageKey = (email?: string | null) =>
  `kidsledger_last_active_tab_${normalizeUserEmail(email)}`;

const loadSavedActiveTab = (email?: string | null): AppTab => {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail) return DEFAULT_ACTIVE_TAB;

  try {
    const raw = localStorage.getItem(getLastActiveTabStorageKey(normalizedEmail));
    return isAppTab(raw) ? raw : DEFAULT_ACTIVE_TAB;
  } catch {
    return DEFAULT_ACTIVE_TAB;
  }
};

const saveActiveTab = (email: string, tab: AppTab) => {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail || !isAppTab(tab)) return;

  try {
    localStorage.setItem(getLastActiveTabStorageKey(normalizedEmail), tab);
  } catch {
    // Ignore storage write failures and fall back to the default tab behavior.
  }
};

declare global {
  interface Window {
    google?: any;
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

const App: React.FC = () => {
  const envGoogleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const googleClientId = envGoogleClientId || '';
  const [user, setUser] = useState<UserProfile | null>(() => getSavedUser());
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(() => loadSavedActiveTab(getSavedUser()?.email));
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [familyCashRecords, setFamilyCashRecords] = useState<FamilyCashRecord[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(storageManager.getSettings());
  const [idleLockMinutesInput, setIdleLockMinutesInput] = useState<string>(() => String(storageManager.getSettings().idleLockMinutes));
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState('');
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [isRefreshingFxReference, setIsRefreshingFxReference] = useState(false);
  const [priceUpdateNotice, setPriceUpdateNotice] = useState<string | null>(null);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnectionStatus>(DEFAULT_CALENDAR_CONNECTION_STATUS);
  const [calendarMembers, setCalendarMembers] = useState<CalendarMember[]>([]);
  const [calendarOptions, setCalendarOptions] = useState<GoogleCalendarOption[]>([]);
  const [calendarMonthDate, setCalendarMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSummary[]>([]);
  const [editingCalendarEvent, setEditingCalendarEvent] = useState<CalendarEventDraft | null>(null);
  const [editingCalendarEventId, setEditingCalendarEventId] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => formatLocalDate(new Date()));
  const [selectedCalendarConfirmIds, setSelectedCalendarConfirmIds] = useState<string[]>([]);
  const [showMobileCalendarDayView, setShowMobileCalendarDayView] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [calendarAiInput, setCalendarAiInput] = useState('');
  const [calendarAiMessages, setCalendarAiMessages] = useState<CalendarAiMessage[]>([]);
  const [calendarAiResult, setCalendarAiResult] = useState<any | null>(null);
  const [calendarAiCandidates, setCalendarAiCandidates] = useState<any[]>([]);
  const [calendarAiSelectedEventId, setCalendarAiSelectedEventId] = useState('');
  const [calendarAiPendingRequest, setCalendarAiPendingRequest] = useState<string | null>(null);
  const [isRecordingCalendarAi, setIsRecordingCalendarAi] = useState(false);
  const [calendarAiVoiceError, setCalendarAiVoiceError] = useState<string | null>(null);
  const [showCalendarMemberManager, setShowCalendarMemberManager] = useState(false);
  const [calendarStatusError, setCalendarStatusError] = useState<string | null>(null);
  const [calendarEventsError, setCalendarEventsError] = useState<string | null>(null);
  const [calendarMembersError, setCalendarMembersError] = useState<string | null>(null);
  const [calendarConnectionNotice, setCalendarConnectionNotice] = useState<string | null>(null);
  const [isCalendarConnecting, setIsCalendarConnecting] = useState(false);
  const [isLoadingCalendarEvents, setIsLoadingCalendarEvents] = useState(false);
  const [isLoadingCalendarOptions, setIsLoadingCalendarOptions] = useState(false);
  const [isSavingSelectedCalendar, setIsSavingSelectedCalendar] = useState(false);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [isSavingCalendarMembers, setIsSavingCalendarMembers] = useState(false);
  const [isSavingCalendarEvent, setIsSavingCalendarEvent] = useState(false);
  const [isRunningCalendarAi, setIsRunningCalendarAi] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => shouldRequireAppUnlock());
  const [appUnlockMethod, setAppUnlockMethod] = useState<AppUnlockMethod | null>(() => readAppLockSession().unlockMethod || null);
  const [passkeySessionExpiresAt, setPasskeySessionExpiresAt] = useState<number | null>(() => readAppLockSession().passkeyExpiresAt || null);
  const [currentDeviceRequiresAppUnlock, setCurrentDeviceRequiresAppUnlock] = useState<boolean>(() => {
    const savedUser = getSavedUser();
    return storageManager.getCurrentDeviceAppLockPreference(savedUser?.email).requireAppUnlock;
  });
  const [appLockPassword, setAppLockPassword] = useState('');
  const [appLockError, setAppLockError] = useState<string | null>(null);
  const [isUnlockingApp, setIsUnlockingApp] = useState(false);
  const [isUnlockingWithPasskey, setIsUnlockingWithPasskey] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeysError, setPasskeysError] = useState<string | null>(null);
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(false);
  const [newPasskeyDeviceName, setNewPasskeyDeviceName] = useState('');
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
  const [editingFamilyCashRecord, setEditingFamilyCashRecord] = useState<FamilyCashRecord | null>(null);
  const [childToDelete, setChildToDelete] = useState<Child | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newFamilyCashDate, setNewFamilyCashDate] = useState(new Date().toISOString().split('T')[0]);
  const [newFamilyCashType, setNewFamilyCashType] = useState<FamilyCashType>('DEPOSIT');
  const [newFamilyCashAmount, setNewFamilyCashAmount] = useState('');
  
  const [newChildName, setNewChildName] = useState('');
  const [isAddingChild, setIsAddingChild] = useState(false);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editingChildName, setEditingChildName] = useState('');
  const [adultManagerUnlocked, setAdultManagerUnlocked] = useState(false);
  const [adultManagerEnabled, setAdultManagerEnabled] = useState<boolean>(() => storageManager.getAdultManagerEnabled());
  const [showHiddenKeyPrompt, setShowHiddenKeyPrompt] = useState(false);
  const [hiddenKeyInput, setHiddenKeyInput] = useState('');
  const [hiddenKeyError, setHiddenKeyError] = useState<string | null>(null);
  const [hiddenTapCount, setHiddenTapCount] = useState(0);
  const [hiddenTapAt, setHiddenTapAt] = useState(0);
  const [avatarChangeArmed, setAvatarChangeArmed] = useState(false);
  const [newCalendarMemberEmail, setNewCalendarMemberEmail] = useState('');
  const [newCalendarMemberNicknames, setNewCalendarMemberNicknames] = useState('');
  const tokenClientRef = useRef<any>(null);
  const isSilentAuthRef = useRef(false);
  const pendingTokenRequestRef = useRef<{ resolve: (accessToken: string) => void; reject: (error: Error) => void } | null>(null);
  const refreshTokenPromiseRef = useRef<Promise<string> | null>(null);
  const lastActivityAtRef = useRef<number>(Date.now());
  const appLockTimerRef = useRef<number | null>(null);
  const previousUserRef = useRef<UserProfile | null>(getSavedUser());
  const activeTabUserEmailRef = useRef<string>(normalizeUserEmail(getSavedUser()?.email));
  const calendarSpeechRecognitionRef = useRef<any>(null);
  const calendarMemberManagerRef = useRef<HTMLDivElement | null>(null);

  const loadPricesFromApi = async (): Promise<Price[]> => {
    try {
      const response = await fetch('/api/prices');
      if (!response.ok) {
        throw new Error(`Prices API ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data?.prices)) {
        throw new Error('Invalid prices payload');
      }

      const normalized = data.prices
        .map(normalizePrice)
        .filter((item: Price) => item.symbol);

      localStorage.setItem('prices', JSON.stringify(normalized));
      return normalized;
    } catch (error) {
      console.warn('Unable to load D1 prices, fallback to local cache.', error);
      return getSavedPrices();
    }
  };

  const loadSettingsFromApi = async (): Promise<AppSettings> => {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error(`Settings API ${response.status}`);
      }
      const data = await response.json();
      const loadedSettingsFromD1: AppSettings = {
        aiMentorEnabled: data?.settings?.aiMentorEnabled !== false,
        aiApiLink: String(data?.settings?.aiApiLink || ''),
        idleLockMinutes: normalizeIdleLockMinutes(data?.settings?.idleLockMinutes),
        telegramChatId: String(data?.settings?.telegramChatId || ''),
        telegramNotifyOnCreate: data?.settings?.telegramNotifyOnCreate === true,
        telegramNotifyOnStart: data?.settings?.telegramNotifyOnStart === true,
        telegramBotTokenConfigured: data?.settings?.telegramBotTokenConfigured === true,
        usdTwdReferenceRate: Number(data?.settings?.usdTwdReferenceRate || 0),
        usdTwdReferenceUpdatedAt: String(data?.settings?.usdTwdReferenceUpdatedAt || ''),
        usdTwdReferenceSource: String(data?.settings?.usdTwdReferenceSource || '')
      };
      const localSettings = storageManager.getSettings();
      const d1IsDefault =
        loadedSettingsFromD1.aiMentorEnabled &&
        !loadedSettingsFromD1.aiApiLink &&
        loadedSettingsFromD1.idleLockMinutes === DEFAULT_IDLE_LOCK_MINUTES;
      const localHasValue =
        !localSettings.aiMentorEnabled ||
        !!localSettings.aiApiLink ||
        localSettings.idleLockMinutes !== DEFAULT_IDLE_LOCK_MINUTES;

      if (d1IsDefault && localHasValue) {
        await saveSettingsToD1(localSettings);
        storageManager.saveSettings(localSettings);
        setIdleLockMinutesInput(String(localSettings.idleLockMinutes));
        return localSettings;
      }

      storageManager.saveSettings(loadedSettingsFromD1);
      setIdleLockMinutesInput(String(loadedSettingsFromD1.idleLockMinutes));
      return loadedSettingsFromD1;
    } catch (error) {
      console.warn('Unable to load D1 settings, fallback to local cache.', error);
      const fallbackSettings = storageManager.getSettings();
      setIdleLockMinutesInput(String(fallbackSettings.idleLockMinutes));
      return fallbackSettings;
    }
  };

  const saveSettingsToD1 = async (nextSettings: AppSettings, telegramBotToken?: string) => {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...nextSettings,
        telegramBotToken: String(telegramBotToken || '').trim()
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Settings API ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    return {
      aiMentorEnabled: data?.settings?.aiMentorEnabled !== false,
      aiApiLink: String(data?.settings?.aiApiLink || ''),
      idleLockMinutes: normalizeIdleLockMinutes(data?.settings?.idleLockMinutes),
        telegramChatId: String(data?.settings?.telegramChatId || ''),
        telegramNotifyOnCreate: data?.settings?.telegramNotifyOnCreate === true,
        telegramNotifyOnStart: data?.settings?.telegramNotifyOnStart === true,
      telegramBotTokenConfigured: data?.settings?.telegramBotTokenConfigured === true,
      usdTwdReferenceRate: Number(data?.settings?.usdTwdReferenceRate || 0),
      usdTwdReferenceUpdatedAt: String(data?.settings?.usdTwdReferenceUpdatedAt || ''),
      usdTwdReferenceSource: String(data?.settings?.usdTwdReferenceSource || '')
    } as AppSettings;
  };

  const refreshUsdTwdReferenceRate = async (force = false) => {
    setIsRefreshingFxReference(true);
    try {
      const response = await fetch(`/api/fx/usd-twd${force ? '?force=1' : ''}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `FX API ${response.status}`);
      }

      const data = await response.json();
      const rate = Number(data?.rate || 0);
      const updatedAt = String(data?.updatedAt || '');
      const source = String(data?.source || 'Frankfurter');
      if (!(rate > 0)) {
        throw new Error('Invalid FX rate');
      }

      setSettings((prev) => {
        const nextSettings = {
          ...prev,
          usdTwdReferenceRate: rate,
          usdTwdReferenceUpdatedAt: updatedAt,
          usdTwdReferenceSource: source
        };
        storageManager.saveSettings(nextSettings);
        return nextSettings;
      });
      return { rate, updatedAt, source };
    } finally {
      setIsRefreshingFxReference(false);
    }
  };

  const withCalendarUserHeaders = (headers?: HeadersInit) => ({
    ...(headers || {}),
    'x-kidsledger-user-email': user?.email || ''
  });

  const loadCalendarStatusFromApi = async (): Promise<CalendarConnectionStatus> => {
    const response = await fetch('/api/calendar/status', {
      cache: 'no-store',
      headers: withCalendarUserHeaders()
    });
    if (!response.ok) {
      throw new Error(`Calendar status API ${response.status}`);
    }

    const data = await response.json();
    return {
      authorized: data?.connection?.authorized === true,
      connected: data?.connection?.connected === true,
      provider: String(data?.connection?.provider || 'google'),
      googleEmail: String(data?.connection?.googleEmail || ''),
      googleDisplayName: String(data?.connection?.googleDisplayName || ''),
      calendarId: String(data?.connection?.calendarId || ''),
      calendarName: String(data?.connection?.calendarName || ''),
      scope: String(data?.connection?.scope || ''),
      tokenExpiresAt: String(data?.connection?.tokenExpiresAt || ''),
      updatedAt: String(data?.connection?.updatedAt || '')
    };
  };

  const loadGoogleCalendarsFromApi = async (): Promise<GoogleCalendarOption[]> => {
    const response = await fetch('/api/calendar/calendars', {
      cache: 'no-store',
      headers: withCalendarUserHeaders()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar list API ${response.status}`);
    }

    return Array.isArray(data?.calendars)
      ? data.calendars.map((item: any) => ({
          id: String(item?.id || ''),
          summary: String(item?.summary || ''),
          description: String(item?.description || ''),
          primary: item?.primary === true,
          selected: item?.selected === true,
          accessRole: String(item?.accessRole || ''),
          backgroundColor: String(item?.backgroundColor || ''),
          foregroundColor: String(item?.foregroundColor || '')
        }))
      : [];
  };

  const saveSelectedCalendarToApi = async (calendarId: string, calendarName: string) => {
    const response = await fetch('/api/calendar/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify({ calendarId, calendarName })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar select API ${response.status}`);
    }

    return {
      authorized: data?.connection?.authorized === true,
      connected: data?.connection?.connected === true,
      provider: String(data?.connection?.provider || 'google'),
      googleEmail: String(data?.connection?.googleEmail || ''),
      googleDisplayName: String(data?.connection?.googleDisplayName || ''),
      calendarId: String(data?.connection?.calendarId || ''),
      calendarName: String(data?.connection?.calendarName || ''),
      scope: String(data?.connection?.scope || ''),
      tokenExpiresAt: String(data?.connection?.tokenExpiresAt || ''),
      updatedAt: String(data?.connection?.updatedAt || '')
    } as CalendarConnectionStatus;
  };

  const loadCalendarMonthEventsFromApi = async (monthDate: Date): Promise<CalendarEventSummary[]> => {
    const response = await fetch(
      `/api/calendar/month?year=${monthDate.getFullYear()}&month=${monthDate.getMonth() + 1}`,
      {
        cache: 'no-store',
        headers: withCalendarUserHeaders()
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar month API ${response.status}`);
    }

    return Array.isArray(data?.events)
      ? data.events.map((item: any) => ({
          id: String(item?.id || ''),
          title: String(item?.title || ''),
          description: String(item?.description || ''),
          location: String(item?.location || ''),
          start: String(item?.start || ''),
          end: String(item?.end || ''),
          startDate: String(item?.startDate || ''),
          endDate: String(item?.endDate || ''),
          allDay: item?.allDay === true,
          attendeesCount: Number(item?.attendeesCount || 0),
          creatorEmail: String(item?.creatorEmail || ''),
          organizerEmail: String(item?.organizerEmail || ''),
          status: String(item?.status || ''),
          autoRolloverEnabled: item?.autoRolloverEnabled === true,
          isConfirmed: item?.isConfirmed === true,
          confirmedAt: String(item?.confirmedAt || ''),
          confirmedByName: String(item?.confirmedByName || ''),
          rolloverCount: Math.max(0, Number(item?.rolloverCount ?? 0) || 0)
        }))
      : [];
  };

  const loadCalendarEventFromApi = async (eventId: string): Promise<CalendarEventDraft> => {
    const response = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
      cache: 'no-store',
      headers: withCalendarUserHeaders()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar event API ${response.status}`);
    }

    return {
      id: String(data?.event?.id || ''),
      title: String(data?.event?.title || ''),
      description: String(data?.event?.description || ''),
      location: String(data?.event?.location || ''),
      startDate: String(data?.event?.startDate || ''),
      endDate: String(data?.event?.endDate || ''),
      startTime: String(data?.event?.startTime || ''),
      endTime: String(data?.event?.endTime || ''),
      allDay: data?.event?.allDay === true,
      reminders: Array.isArray(data?.event?.reminders)
        ? data.event.reminders.map((item: any) => ({
            method: String(item?.method || 'popup') === 'email' ? 'email' : 'popup',
            minutes: Number(item?.minutes || 0)
          }))
        : [{ method: 'popup', minutes: 30 }],
      autoRolloverEnabled: data?.event?.autoRolloverEnabled === true,
      isConfirmed: data?.event?.isConfirmed === true
    };
  };

  const createCalendarEventInApi = async (payload: CalendarEventDraft & Record<string, unknown>) => {
    const response = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar create API ${response.status}`);
    }
  };

  const updateCalendarEventInApi = async (eventId: string, payload: CalendarEventDraft & Record<string, unknown>) => {
    const response = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar update API ${response.status}`);
    }
  };

  const deleteCalendarEventInApi = async (eventId: string) => {
    const response = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: withCalendarUserHeaders()
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar delete API ${response.status}`);
    }
  };

  const confirmCalendarEventInApi = async (eventId: string) => {
    const response = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify({
        actorName: user?.name || user?.email || '',
        actorEmail: user?.email || ''
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar confirm API ${response.status}`);
    }
  };

  const unconfirmCalendarEventInApi = async (eventId: string) => {
    const response = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}/unconfirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar unconfirm API ${response.status}`);
    }
  };

  const bulkConfirmCalendarEventsInApi = async (eventIds: string[]) => {
    const response = await fetch('/api/calendar/events/confirm-bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify({
        eventIds,
        actorName: user?.name || user?.email || '',
        actorEmail: user?.email || ''
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar bulk confirm API ${response.status}`);
    }
  };

  const parseCalendarAiInput = async (text: string) => {
    const response = await fetch('/api/calendar/ai/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify({ text })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar AI parse API ${response.status}`);
    }

    return data?.parsed;
  };

  const resolveCalendarAiCandidates = async (payload: {
    titleKeyword?: string;
    date?: string;
    dateRangeStart?: string;
    dateRangeEnd?: string;
  }) => {
    const response = await fetch('/api/calendar/ai/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar AI resolve API ${response.status}`);
    }

    return Array.isArray(data?.candidates) ? data.candidates : [];
  };

  const executeCalendarAiAction = async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/calendar/ai/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withCalendarUserHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Calendar AI execute API ${response.status}`);
    }

    return data?.result;
  };

  const loadCalendarMembersFromApi = async (): Promise<CalendarMember[]> => {
    const response = await fetch('/api/calendar/members', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Calendar members API ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data?.members)
      ? data.members.map((item: any) => ({
          id: String(item?.id || ''),
          displayName: String(item?.displayName || ''),
          nickname: String(item?.nickname || ''),
          aliases: Array.isArray(item?.aliases)
            ? item.aliases.map((alias: unknown) => String(alias || '').trim()).filter(Boolean)
            : [],
          email: String(item?.email || ''),
          isActive: item?.isActive !== false,
          createdAt: String(item?.createdAt || ''),
          updatedAt: String(item?.updatedAt || '')
        }))
      : [];
  };

  const saveCalendarMembersToApi = async (items: CalendarMember[]) => {
    const response = await fetch('/api/calendar/members', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: items.map((item) => ({
          id: item.id,
          displayName: item.displayName,
          nickname: item.nickname,
          aliases: item.aliases,
          email: item.email,
          isActive: item.isActive
        }))
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Calendar members API ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data?.members)
      ? data.members.map((item: any) => ({
          id: String(item?.id || ''),
          displayName: String(item?.displayName || ''),
          nickname: String(item?.nickname || ''),
          aliases: Array.isArray(item?.aliases)
            ? item.aliases.map((alias: unknown) => String(alias || '').trim()).filter(Boolean)
            : [],
          email: String(item?.email || ''),
          isActive: item?.isActive !== false,
          createdAt: String(item?.createdAt || ''),
          updatedAt: String(item?.updatedAt || '')
        }))
      : [];
  };

  const loadChildrenFromApi = async (): Promise<Child[]> => {
    const normalize = (items: any[]) =>
      items
        .map((item: any) =>
          normalizeChild({
            id: String(item?.id || ''),
            name: String(item?.name || ''),
            avatar: String(item?.avatar || ''),
            role: String(item?.role || 'CHILD') as 'CHILD' | 'ADULT',
            avatarSeed: String(item?.avatarSeed || '')
          })
        )
        .filter((item: Child) => item.id && item.name);

    try {
      const response = await fetch('/api/children');
      if (!response.ok) {
        throw new Error(`Children API ${response.status}`);
      }

      const data = await response.json();
      const d1Children = normalize(Array.isArray(data?.children) ? data.children : []);
      if (!d1Children.length) {
        const localChildren = getSavedChildren();
        if (localChildren.length) {
          const bootstrapResponse = await fetch('/api/children/bulk-upsert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: localChildren })
          });
          if (!bootstrapResponse.ok) {
            const bootstrapData = await bootstrapResponse.json().catch(() => ({}));
            throw new Error(bootstrapData?.error || `Children bootstrap ${bootstrapResponse.status}`);
          }
          localStorage.setItem('children_list', JSON.stringify(localChildren));
          return localChildren;
        }
      }

      const finalChildren = d1Children.length ? d1Children : DEFAULT_CHILDREN.map(normalizeChild);
      localStorage.setItem('children_list', JSON.stringify(finalChildren));
      return finalChildren;
    } catch (error) {
      console.warn('Unable to load D1 children, fallback to local cache.', error);
      const localChildren = getSavedChildren();
      return localChildren.length ? localChildren : DEFAULT_CHILDREN.map(normalizeChild);
    }
  };

  const createChildInD1 = async (child: Child) => {
    const response = await fetch('/api/children', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(child)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Children API ${response.status}`);
    }
  };

  const updateChildInD1 = async (child: Child) => {
    const response = await fetch(`/api/children/${encodeURIComponent(child.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(child)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Children API ${response.status}`);
    }
  };

  const deleteChildInD1 = async (id: string) => {
    const response = await fetch(`/api/children/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Children API ${response.status}`);
    }
  };

  const loadTransactionsFromApi = async (): Promise<Transaction[]> => {
    const normalize = (items: any[]) =>
      items
        .map((item: any) => ({
          id: String(item?.id || ''),
          childId: String(item?.childId || ''),
          date: String(item?.date || ''),
          type: String(item?.type || '') as TransactionType,
          category: String(item?.category || ''),
          amount: Number(item?.amount || 0),
          description: String(item?.description || '')
        }))
        .filter((item: Transaction) => item.id);

    try {
      const response = await fetch('/api/transactions');
      if (!response.ok) {
        throw new Error(`Transactions API ${response.status}`);
      }

      const data = await response.json();
      const d1Transactions = normalize(Array.isArray(data?.transactions) ? data.transactions : []);
      if (!d1Transactions.length) {
        const localTransactions = getSavedTransactions().filter((item) => item.id);
        if (localTransactions.length) {
          const bootstrapResponse = await fetch('/api/transactions/bulk-upsert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: localTransactions })
          });
          if (!bootstrapResponse.ok) {
            const bootstrapData = await bootstrapResponse.json().catch(() => ({}));
            throw new Error(bootstrapData?.error || `Transactions bootstrap ${bootstrapResponse.status}`);
          }
          const sortedLocalTransactions = [...localTransactions].sort(
            (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
          );
          localStorage.setItem('transactions', JSON.stringify(sortedLocalTransactions));
          return sortedLocalTransactions;
        }
      }

      localStorage.setItem('transactions', JSON.stringify(d1Transactions));
      return d1Transactions;
    } catch (error) {
      console.warn('Unable to load D1 transactions, fallback to local cache.', error);
      return getSavedTransactions();
    }
  };

  const loadInvestmentsFromApi = async (): Promise<Investment[]> => {
    const normalize = (items: any[]) =>
      items.map(normalizeInvestment).filter((item) => Boolean(item.id)) as Investment[];

    try {
      const response = await fetch('/api/investments');
      if (!response.ok) {
        throw new Error(`Investments API ${response.status}`);
      }

      const data = await response.json();
      const d1Investments = normalize(Array.isArray(data?.investments) ? data.investments : []);
      if (!d1Investments.length) {
        const localInvestments = getSavedInvestments().filter((item) => item.id);
        if (localInvestments.length) {
          const bootstrapResponse = await fetch('/api/investments/bulk-upsert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: localInvestments })
          });
          if (!bootstrapResponse.ok) {
            const bootstrapData = await bootstrapResponse.json().catch(() => ({}));
            throw new Error(bootstrapData?.error || `Investments bootstrap ${bootstrapResponse.status}`);
          }
          const sortedLocalInvestments = [...localInvestments].sort(
            (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
          );
          localStorage.setItem('investments', JSON.stringify(sortedLocalInvestments));
          return sortedLocalInvestments;
        }
      }

      localStorage.setItem('investments', JSON.stringify(d1Investments));
      return d1Investments;
    } catch (error) {
      console.warn('Unable to load D1 investments, fallback to local cache.', error);
      return getSavedInvestments();
    }
  };

  const loadFamilyCashRecordsFromApi = async (): Promise<FamilyCashRecord[]> => {
    const normalize = (items: any[]) =>
      items
        .map((item: any) => ({
          id: String(item?.id || ''),
          date: String(item?.date || ''),
          type: String(item?.type || '') as FamilyCashType,
          amount: Number(item?.amount || 0),
          actorName: String(item?.actorName || ''),
          actorEmail: String(item?.actorEmail || '')
        }))
        .filter((item: FamilyCashRecord) => item.id);

    try {
      const response = await fetch('/api/family-cash-records');
      if (!response.ok) {
        throw new Error(`Family cash API ${response.status}`);
      }

      const data = await response.json();
      const d1Records = normalize(Array.isArray(data?.records) ? data.records : []);
      if (!d1Records.length) {
        const localRecords = getSavedFamilyCashRecords().filter((item) => item.id);
        if (localRecords.length) {
          const bootstrapResponse = await fetch('/api/family-cash-records/bulk-upsert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: localRecords })
          });
          if (!bootstrapResponse.ok) {
            const bootstrapData = await bootstrapResponse.json().catch(() => ({}));
            throw new Error(bootstrapData?.error || `Family cash bootstrap ${bootstrapResponse.status}`);
          }
          const sortedLocalRecords = [...localRecords].sort(
            (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
          );
          localStorage.setItem('family_cash_records', JSON.stringify(sortedLocalRecords));
          return sortedLocalRecords;
        }
      }

      localStorage.setItem('family_cash_records', JSON.stringify(d1Records));
      return d1Records;
    } catch (error) {
      console.warn('Unable to load D1 family cash records, fallback to local cache.', error);
      return getSavedFamilyCashRecords();
    }
  };

  const createInvestmentInD1 = async (investment: Investment) => {
    const response = await fetch('/api/investments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(investment)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Investments API ${response.status}`);
    }
  };

  const updateInvestmentInD1 = async (investment: Investment) => {
    const response = await fetch(`/api/investments/${encodeURIComponent(investment.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(investment)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Investments API ${response.status}`);
    }
  };

  const deleteInvestmentInD1 = async (id: string) => {
    const response = await fetch(`/api/investments/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Investments API ${response.status}`);
    }
  };

  const createTransactionInD1 = async (transaction: Transaction) => {
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transaction)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Transactions API ${response.status}`);
    }
  };

  const createFamilyCashRecordInD1 = async (record: FamilyCashRecord) => {
    const response = await fetch('/api/family-cash-records', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Family cash API ${response.status}`);
    }
  };

  const updateTransactionInD1 = async (transaction: Transaction) => {
    const response = await fetch(`/api/transactions/${encodeURIComponent(transaction.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transaction)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Transactions API ${response.status}`);
    }
  };

  const updateFamilyCashRecordInD1 = async (record: FamilyCashRecord) => {
    const response = await fetch(`/api/family-cash-records/${encodeURIComponent(record.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Family cash API ${response.status}`);
    }
  };

  const deleteTransactionInD1 = async (id: string) => {
    const response = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Transactions API ${response.status}`);
    }
  };

  const deleteFamilyCashRecordInD1 = async (id: string) => {
    const response = await fetch(`/api/family-cash-records/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Family cash API ${response.status}`);
    }
  };

  const ensurePriceInD1 = async (price: Pick<Price, 'symbol' | 'companyName' | 'market' | 'currency' | 'fxRateToTwd'>) => {
    try {
      const response = await fetch('/api/prices/ensure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: price.symbol,
          companyName: price.companyName || '',
          market: price.market || 'TW',
          currency: price.currency || 'TWD',
          fxRateToTwd: price.fxRateToTwd || 0
        })
      });

      if (!response.ok) {
        throw new Error(`Prices ensure API ${response.status}`);
      }
    } catch (error) {
      console.warn('Unable to ensure D1 price row.', error);
    }
  };

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [user]);

  useEffect(() => {
    const normalizedEmail = normalizeUserEmail(user?.email);
    if (!normalizedEmail) {
      activeTabUserEmailRef.current = '';
      setActiveTab(DEFAULT_ACTIVE_TAB);
      return;
    }

    if (activeTabUserEmailRef.current === normalizedEmail) {
      return;
    }

    activeTabUserEmailRef.current = normalizedEmail;
    setActiveTab(loadSavedActiveTab(normalizedEmail));
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email || !isAppTab(activeTab)) return;
    saveActiveTab(user.email, activeTab);
  }, [activeTab, user?.email]);

  const visibleChildren = useMemo(
    () => children.filter((child) => adultManagerEnabled || (child.role || 'CHILD') !== 'ADULT'),
    [children, adultManagerEnabled]
  );

  useEffect(() => {
    if (!visibleChildren.some((child) => child.id === selectedChildId)) {
      setSelectedChildId(visibleChildren[0]?.id || '');
    }
  }, [visibleChildren, selectedChildId]);

  const handleSecretTitleTap = () => {
    const now = Date.now();
    const nextCount = now - hiddenTapAt < 1500 ? hiddenTapCount + 1 : 1;
    setHiddenTapAt(now);
    setHiddenTapCount(nextCount);
    if (nextCount >= 7) {
      setHiddenTapCount(0);
      if (adultManagerUnlocked) {
        setAdultManagerUnlocked(false);
        setAdultManagerEnabled(false);
        storageManager.saveAdultManagerEnabled(false);
        setShowHiddenKeyPrompt(false);
        setHiddenKeyInput('');
        setHiddenKeyError(null);
        return;
      }
      setShowHiddenKeyPrompt(true);
      setHiddenKeyInput('');
      setHiddenKeyError(null);
    }
  };

  const setAdultManagerEnabledWithStorage = (enabled: boolean) => {
    setAdultManagerEnabled(enabled);
    storageManager.saveAdultManagerEnabled(enabled);
  };

  const verifyHiddenKey = async () => {
    const password = hiddenKeyInput.trim();
    if (!password) {
      setHiddenKeyError('請輸入密碼');
      return;
    }

    try {
      const response = await fetch('/api/verify-hidden-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        setHiddenKeyError('密碼錯誤或驗證服務不可用');
        return;
      }

      const data = await response.json();
      if (!data?.ok) {
        setHiddenKeyError('密碼錯誤');
        return;
      }

      setAdultManagerUnlocked(true);
      setShowHiddenKeyPrompt(false);
      setHiddenKeyInput('');
      setHiddenKeyError(null);
    } catch {
      setHiddenKeyError('驗證失敗，請確認目前網域已部署 Cloudflare Functions');
    }
  };

  const browserSupportsPasskeys =
    typeof window !== 'undefined' &&
    'PublicKeyCredential' in window &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function';

  const loadPasskeys = async () => {
    if (!user) return;

    try {
      setIsLoadingPasskeys(true);
      const response = await fetch('/api/app-lock/passkeys');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Passkeys API ${response.status}`));
      }
      const items = Array.isArray(data?.passkeys) ? data.passkeys : [];
      setPasskeys(
        items.map((item: any) => ({
          id: String(item?.id || ''),
          deviceName: String(item?.deviceName || '未命名裝置'),
          transports: Array.isArray(item?.transports) ? item.transports.map((value: unknown) => String(value)) : [],
          rpId: String(item?.rpId || ''),
          createdAt: String(item?.createdAt || ''),
          updatedAt: String(item?.updatedAt || ''),
          lastUsedAt: String(item?.lastUsedAt || '')
        }))
      );
      setPasskeysError(null);
    } catch (error) {
      setPasskeysError(error instanceof Error ? error.message : '無法讀取 Passkey 清單');
    } finally {
      setIsLoadingPasskeys(false);
    }
  };

  const markAppActivity = () => {
    lastActivityAtRef.current = Date.now();
  };

  const lockApp = () => {
    setIsAppLocked(true);
    setAppUnlockMethod(null);
    setPasskeySessionExpiresAt(null);
    setAppLockError(null);
    setAppLockPassword('');
    saveAppLockSession({ locked: true });
  };

  const unlockApp = (payload?: { method?: AppUnlockMethod; passkeyToken?: string; passkeyExpiresAt?: number }) => {
    const now = Date.now();
    const trustedPreference = storageManager.ensureTrustedCurrentDevice(user?.email);
    setIsAppLocked(false);
    setAppUnlockMethod(payload?.method || 'password');
    setPasskeySessionExpiresAt(payload?.passkeyExpiresAt || null);
    setCurrentDeviceRequiresAppUnlock(trustedPreference.requireAppUnlock);
    setAppLockError(null);
    setAppLockPassword('');
    lastActivityAtRef.current = now;
    saveAppLockSession({
      locked: false,
      unlockedAt: now,
      unlockMethod: payload?.method || 'password',
      passkeyToken: payload?.passkeyToken,
      passkeyExpiresAt: payload?.passkeyExpiresAt
    });
  };

  const verifyAppLockPassword = async () => {
    const password = appLockPassword.trim();
    if (!password) {
      setAppLockError('請輸入解鎖密碼');
      return;
    }

    try {
      setIsUnlockingApp(true);
      setAppLockError(null);
      const response = await fetch('/api/verify-app-lock-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        setAppLockError(
          response.status === 401
            ? '解鎖密碼錯誤'
            : String(data?.error || '驗證服務目前不可用，請稍後再試')
        );
        return;
      }

      unlockApp({ method: 'password' });
    } catch {
      setAppLockError('無法連線到解鎖服務，請確認 Cloudflare Functions 已部署');
    } finally {
      setIsUnlockingApp(false);
    }
  };

  const unlockWithPasskey = async () => {
    if (!browserSupportsPasskeys) {
      setAppLockError('此裝置或瀏覽器目前不支援 Passkey');
      return;
    }

    try {
      setIsUnlockingWithPasskey(true);
      setAppLockError(null);

      const optionsResponse = await fetch('/api/app-lock/passkeys/auth/options', {
        method: 'POST'
      });
      const optionsData = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok || !optionsData?.authentication?.publicKey) {
        throw new Error(String(optionsData?.error || '無法取得 Passkey 驗證資訊'));
      }

      const publicKey = optionsData.authentication.publicKey;
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: base64UrlToUint8Array(String(publicKey.challenge || '')),
          rpId: String(publicKey.rpId || ''),
          timeout: Number(publicKey.timeout || 300000),
          userVerification: publicKey.userVerification || 'required',
          allowCredentials: Array.isArray(publicKey.allowCredentials)
            ? publicKey.allowCredentials.map((item: any) => ({
                id: base64UrlToUint8Array(String(item?.id || '')),
                type: 'public-key' as const,
                transports: Array.isArray(item?.transports) ? item.transports : undefined
              }))
            : []
        }
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey 驗證已取消');
      }

      const assertionResponse = credential.response as AuthenticatorAssertionResponse;
      const verifyResponse = await fetch('/api/app-lock/passkeys/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          challengeId: optionsData.authentication.challengeId,
          credential: {
            id: credential.id,
            rawId: arrayBufferToBase64Url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: arrayBufferToBase64Url(assertionResponse.clientDataJSON),
              authenticatorData: arrayBufferToBase64Url(assertionResponse.authenticatorData),
              signature: arrayBufferToBase64Url(assertionResponse.signature),
              userHandle: assertionResponse.userHandle ? arrayBufferToBase64Url(assertionResponse.userHandle) : null
            }
          }
        })
      });

      const verifyData = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyData?.unlock?.token) {
        throw new Error(String(verifyData?.error || 'Passkey 解鎖失敗'));
      }

      unlockApp({
        method: 'passkey',
        passkeyToken: String(verifyData.unlock.token),
        passkeyExpiresAt: Date.now() + Number(verifyData.unlock.expiresInSeconds || PASSKEY_SESSION_LIFETIME_SECONDS) * 1000
      });
    } catch (error) {
      if (isIgnorablePasskeyError(error)) {
        setAppLockError(null);
        return;
      }

      setAppLockError(error instanceof Error ? error.message : 'Passkey 解鎖失敗');
    } finally {
      setIsUnlockingWithPasskey(false);
    }
  };

  const registerPasskey = async () => {
    if (!browserSupportsPasskeys) {
      setPasskeysError('此裝置或瀏覽器目前不支援 Passkey');
      return;
    }
    if (appUnlockMethod !== 'password') {
      setPasskeysError('請先使用密碼解鎖後再新增 Passkey');
      return;
    }

    try {
      setIsRegisteringPasskey(true);
      setPasskeysError(null);

      const optionsResponse = await fetch('/api/app-lock/passkeys/register/options', {
        method: 'POST'
      });
      const optionsData = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok || !optionsData?.registration?.publicKey) {
        throw new Error(String(optionsData?.error || '無法取得 Passkey 註冊資訊'));
      }

      const publicKey = optionsData.registration.publicKey;
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: base64UrlToUint8Array(String(publicKey.challenge || '')),
          rp: {
            id: String(publicKey.rp.id || ''),
            name: String(publicKey.rp.name || '')
          },
          user: {
            id: base64UrlToUint8Array(String(publicKey.user.id || '')),
            name: String(publicKey.user.name || ''),
            displayName: String(publicKey.user.displayName || '')
          },
          pubKeyCredParams: Array.isArray(publicKey.pubKeyCredParams) ? publicKey.pubKeyCredParams : [],
          authenticatorSelection: publicKey.authenticatorSelection,
          timeout: Number(publicKey.timeout || 300000),
          attestation: publicKey.attestation || 'none',
          excludeCredentials: Array.isArray(publicKey.excludeCredentials)
            ? publicKey.excludeCredentials.map((item: any) => ({
                id: base64UrlToUint8Array(String(item?.id || '')),
                type: 'public-key' as const
              }))
            : [],
          extensions: publicKey.extensions
        }
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey 註冊已取消');
      }

      const attestationResponse = credential.response as AuthenticatorAttestationResponse & {
        getTransports?: () => string[];
      };
      const verifyResponse = await fetch('/api/app-lock/passkeys/register/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          challengeId: optionsData.registration.challengeId,
          deviceName: newPasskeyDeviceName.trim() || `${user?.name || 'KidsLedger'} 的裝置`,
          credential: {
            id: credential.id,
            rawId: arrayBufferToBase64Url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: arrayBufferToBase64Url(attestationResponse.clientDataJSON),
              attestationObject: arrayBufferToBase64Url(attestationResponse.attestationObject),
              transports: typeof attestationResponse.getTransports === 'function' ? attestationResponse.getTransports() : []
            }
          }
        })
      });

      const verifyData = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyData?.ok) {
        throw new Error(String(verifyData?.error || 'Passkey 註冊失敗'));
      }

      setNewPasskeyDeviceName('');
      await loadPasskeys();
    } catch (error) {
      setPasskeysError(error instanceof Error ? error.message : 'Passkey 註冊失敗');
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const deletePasskey = async (passkey: PasskeySummary) => {
    const confirmed = window.confirm(`確定要移除 Passkey「${passkey.deviceName || '未命名裝置'}」嗎？移除後這台裝置將不能再用 Face ID / Passkey 解鎖。`);
    if (!confirmed) return;

    try {
      setDeletingPasskeyId(passkey.id);
      setPasskeysError(null);
      const response = await fetch(`/api/app-lock/passkeys/${encodeURIComponent(passkey.id)}`, {
        method: 'DELETE'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || '刪除 Passkey 失敗'));
      }

      setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
    } catch (error) {
      setPasskeysError(error instanceof Error ? error.message : '刪除 Passkey 失敗');
    } finally {
      setDeletingPasskeyId(null);
    }
  };

  useEffect(() => {
    if (!user) {
      setIsAppLocked(false);
      setAppUnlockMethod(null);
      setPasskeySessionExpiresAt(null);
      setCurrentDeviceRequiresAppUnlock(true);
      setAppLockPassword('');
      setAppLockError(null);
      markAppActivity();
      clearAppLockSession();
      previousUserRef.current = null;
      return;
    }

    const previousUser = previousUserRef.current;
    const isNewLogin = !previousUser || previousUser.email !== user.email;
    const currentDevicePreference = storageManager.getCurrentDeviceAppLockPreference(user.email);
    setCurrentDeviceRequiresAppUnlock(currentDevicePreference.requireAppUnlock);
    previousUserRef.current = user;

    if (isNewLogin && shouldRequireAppUnlock()) {
      lockApp();
      return;
    }

    if (shouldRequireAppUnlock()) {
      setIsAppLocked(true);
    }
  }, [user]);

  useEffect(() => {
    markAppActivity();
  }, [settings.idleLockMinutes]);

  useEffect(() => {
    if (!currentDeviceRequiresAppUnlock) return;
    if (isAppLocked || appUnlockMethod !== 'passkey' || !passkeySessionExpiresAt) return;

    const remaining = passkeySessionExpiresAt - Date.now();
    if (remaining <= 0) {
      lockApp();
      return;
    }

    const timer = window.setTimeout(() => {
      lockApp();
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [isAppLocked, appUnlockMethod, passkeySessionExpiresAt, currentDeviceRequiresAppUnlock]);

  useEffect(() => {
    if (!user) {
      setPasskeys([]);
      setPasskeysError(null);
      return;
    }

    loadPasskeys();
  }, [user]);

  useEffect(() => {
    if (showSettings) {
      setIdleLockMinutesInput(String(settings.idleLockMinutes));
    }
  }, [showSettings, settings.idleLockMinutes]);

  useEffect(() => {
    if (!user) return;
    if (!currentDeviceRequiresAppUnlock) return;

    const thresholdMs = normalizeIdleLockMinutes(settings.idleLockMinutes) * 60 * 1000;
    const handleActivity = () => {
      if (document.hidden || isAppLocked) return;
      markAppActivity();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (isAppLocked) return;
      markAppActivity();
    };

    const checkIdle = () => {
      if (document.hidden && Date.now() - lastActivityAtRef.current >= thresholdMs) {
        lockApp();
        return;
      }
      if (!isAppLocked && Date.now() - lastActivityAtRef.current >= thresholdMs) {
        lockApp();
      }
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);

    appLockTimerRef.current = window.setInterval(checkIdle, 1000);
    checkIdle();

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (appLockTimerRef.current) {
        window.clearInterval(appLockTimerRef.current);
        appLockTimerRef.current = null;
      }
    };
  }, [user, isAppLocked, settings.idleLockMinutes, currentDeviceRequiresAppUnlock]);

  const toggleCurrentDeviceAppLock = (requireAppUnlock: boolean) => {
    if (!user?.email) return;
    storageManager.saveCurrentDeviceAppLockPreference(user.email, requireAppUnlock);
    setCurrentDeviceRequiresAppUnlock(requireAppUnlock);

    if (!requireAppUnlock) {
      setIsAppLocked(false);
      setAppLockError(null);
      setAppLockPassword('');
      setAppUnlockMethod(null);
      setPasskeySessionExpiresAt(null);
      clearAppLockSession();
      markAppActivity();
      return;
    }

    markAppActivity();
  };

  useEffect(() => {
    const fetchData = async () => {
      const resolvedSettings = await loadSettingsFromApi();
      setSettings(resolvedSettings);
      try {
        await refreshUsdTwdReferenceRate();
      } catch (error) {
        console.warn('Unable to refresh FX reference rate on init.', error);
      }
      try {
        setSyncStatus('syncing');
        const finalChildren = await loadChildrenFromApi();
        setChildren(finalChildren);
        setSelectedChildId(finalChildren[0]?.id || '');
        const [ts, invs, cashRecords] = await Promise.all([
          loadTransactionsFromApi(),
          loadInvestmentsFromApi(),
          loadFamilyCashRecordsFromApi()
        ]);
        setTransactions(ts.filter((t) => t.id));
        setInvestments(invs.filter((i) => i.id));
        setFamilyCashRecords(cashRecords.filter((record) => record.id));
        const loadedPrices = await loadPricesFromApi();
        setPrices(loadedPrices.filter((p) => p.symbol));
        localStorage.setItem('prices', JSON.stringify(loadedPrices.filter((p) => p.symbol)));
        setSyncStatus('success');
        setSyncError(null);
      } catch (e) {
        console.error('Fetch Error:', e);
        setSyncStatus('error');
        setSyncError(e instanceof Error ? e.message : '無法讀取 D1 資料');
        const localChildren = getSavedChildren();
        const final = (localChildren.length > 0 ? localChildren : DEFAULT_CHILDREN).map((child: Child) => normalizeChild(child));
        setChildren(final);
        setSelectedChildId(final[0]?.id || '');
        setTransactions(getSavedTransactions());
        setInvestments(getSavedInvestments());
        setFamilyCashRecords(getSavedFamilyCashRecords());
        setPrices(getSavedPrices());
      }
    };
    fetchData();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCalendarConnection(DEFAULT_CALENDAR_CONNECTION_STATUS);
      setCalendarMembers([]);
      setCalendarOptions([]);
      setSelectedCalendarId('');
      setShowCalendarPicker(false);
      setCalendarStatusError(null);
      setCalendarMembersError(null);
      setCalendarConnectionNotice(null);
      return;
    }

    const loadCalendarData = async () => {
      try {
        const [connection, members] = await Promise.all([
          loadCalendarStatusFromApi(),
          loadCalendarMembersFromApi()
        ]);
        setCalendarConnection(connection);
        setCalendarMembers(members);
        setSelectedCalendarId(connection.calendarId || '');
        setCalendarStatusError(null);
        setCalendarMembersError(null);
      } catch (error) {
        console.error('Load calendar metadata failed:', error);
        setCalendarStatusError(error instanceof Error ? error.message : '無法讀取家庭行事曆設定');
      }
    };

    loadCalendarData();
  }, [user]);

  useEffect(() => {
    if (!user || !calendarConnection.authorized) {
      if (!calendarConnection.authorized) {
        setCalendarOptions([]);
        setSelectedCalendarId(calendarConnection.calendarId || '');
      }
      return;
    }

    const loadCalendarOptions = async () => {
      try {
        setIsLoadingCalendarOptions(true);
        const calendars = await loadGoogleCalendarsFromApi();
        setCalendarOptions(calendars);
        setSelectedCalendarId((current) => current || calendarConnection.calendarId || calendars[0]?.id || '');
      } catch (error) {
        console.error('Load Google calendars failed:', error);
        setCalendarStatusError(error instanceof Error ? error.message : '無法讀取 Google Calendar 清單');
      } finally {
        setIsLoadingCalendarOptions(false);
      }
    };

    loadCalendarOptions();
  }, [user, calendarConnection.authorized, calendarConnection.calendarId]);

  useEffect(() => {
    if (!user || !calendarConnection.connected) {
      setCalendarEvents([]);
      setCalendarEventsError(null);
      return;
    }

    const loadCalendarEvents = async () => {
      try {
        setIsLoadingCalendarEvents(true);
        const events = await loadCalendarMonthEventsFromApi(calendarMonthDate);
        setCalendarEvents(events);
        setCalendarEventsError(null);
      } catch (error) {
        console.error('Load calendar month events failed:', error);
        setCalendarEvents([]);
        setCalendarEventsError(error instanceof Error ? error.message : '無法讀取家庭 calendar 事件');
      } finally {
        setIsLoadingCalendarEvents(false);
      }
    };

    loadCalendarEvents();
  }, [user, calendarConnection.connected, calendarMonthDate]);

  useEffect(() => {
    return () => {
      if (calendarSpeechRecognitionRef.current) {
        try {
          calendarSpeechRecognitionRef.current.stop();
        } catch {
          // Ignore shutdown errors from browser speech recognition cleanup.
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!showCalendarMemberManager) return;
    window.setTimeout(() => {
      calendarMemberManagerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [showCalendarMemberManager]);

  useEffect(() => {
    setSelectedCalendarConfirmIds([]);
  }, [selectedCalendarDate, calendarEvents]);

  useEffect(() => {
    if (!user) return;

    const url = new URL(window.location.href);
    const oauthStatus = url.searchParams.get('calendar_oauth');
    const oauthMessage = url.searchParams.get('calendar_message');
    if (!oauthStatus) return;

    if (oauthStatus === 'success') {
      setActiveTab('CALENDAR');
      setShowCalendarPicker(true);
      setCalendarConnectionNotice('Google Calendar 授權成功，請選擇要綁定的家庭 calendar。');
      setCalendarStatusError(null);
      loadCalendarStatusFromApi()
        .then((connection) => {
          setCalendarConnection(connection);
          setSelectedCalendarId(connection.calendarId || '');
        })
        .catch((error) => {
          setCalendarStatusError(error instanceof Error ? error.message : 'Google Calendar 授權後讀取狀態失敗');
        });
    } else {
      setActiveTab('CALENDAR');
      setCalendarStatusError(oauthMessage || 'Google Calendar 授權失敗');
    }

    url.searchParams.delete('calendar_oauth');
    url.searchParams.delete('calendar_message');
    window.history.replaceState({}, document.title, url.toString());
  }, [user]);

  const fetchUserProfile = async (accessToken: string, expiresInSeconds?: number) => {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error('無法取得 Google 使用者資料');
    }

    const profile = await response.json();
    setUser({
      name: profile.name || profile.email || 'Google User',
      email: profile.email || '',
      picture: profile.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Parent',
      accessToken,
      expiresAt: expiresInSeconds ? Date.now() + (expiresInSeconds * 1000) : undefined
    });
    setAuthError(null);
  };

  const refreshGoogleAccessToken = async (prompt: '' | 'consent' = ''): Promise<string> => {
    if (!tokenClientRef.current) {
      throw new Error('Google 登入服務尚未載入完成，請稍後再試');
    }

    if (prompt === '' && refreshTokenPromiseRef.current) {
      return refreshTokenPromiseRef.current;
    }

    const requestPromise = new Promise<string>((resolve, reject) => {
      pendingTokenRequestRef.current = { resolve, reject };
      isSilentAuthRef.current = prompt === '';
      tokenClientRef.current.requestAccessToken({ prompt });
    }).finally(() => {
      pendingTokenRequestRef.current = null;
      isSilentAuthRef.current = false;
      if (prompt === '') {
        refreshTokenPromiseRef.current = null;
      }
    });

    if (prompt === '') {
      refreshTokenPromiseRef.current = requestPromise;
    }

    return requestPromise;
  };

  useEffect(() => {
    if (!googleClientId) {
      setAuthError('網站尚未完成 Google 登入設定，請聯絡管理者');
      return;
    }

    let cancelled = false;

    const initGoogleTokenClient = () => {
      if (cancelled) return true;
      if (!window.google?.accounts?.oauth2) return false;

      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
        callback: async (tokenResponse: any) => {
          const isSilentAuth = isSilentAuthRef.current;

          if (tokenResponse?.error) {
            if (pendingTokenRequestRef.current) {
              pendingTokenRequestRef.current.reject(new Error(`Google 授權失敗：${tokenResponse.error}`));
            }
            if (isSilentAuth) return;
            setAuthError(`Google 登入失敗：${tokenResponse.error}`);
            return;
          }

          try {
            await fetchUserProfile(tokenResponse.access_token, tokenResponse.expires_in);
            if (pendingTokenRequestRef.current) {
              pendingTokenRequestRef.current.resolve(tokenResponse.access_token);
            }
          } catch (error) {
            console.error('Google profile error:', error);
            if (pendingTokenRequestRef.current) {
              pendingTokenRequestRef.current.reject(error instanceof Error ? error : new Error('Google 個人資料讀取失敗'));
            }
            if (!isSilentAuth) {
              setAuthError('Google 登入成功，但取得個人資料失敗');
            }
          }
        }
      });

      const isExpired = !user?.expiresAt || user.expiresAt < Date.now() + 60_000;
      if (isExpired) {
        refreshGoogleAccessToken('').catch(() => {
          // 靜默刷新失敗時，保留現況，讓使用者在需要時手動重新登入。
        });
      }

      setAuthError(null);
      return true;
    };

    if (initGoogleTokenClient()) return;

    const timer = window.setInterval(() => {
      if (initGoogleTokenClient()) {
        window.clearInterval(timer);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [googleClientId, user?.expiresAt]);

  const handleLogin = () => {
    if (!googleClientId) {
      setAuthError('網站尚未完成 Google 登入設定，請聯絡管理者');
      return;
    }

    if (!tokenClientRef.current) {
      setAuthError('Google 登入服務尚未載入完成，請稍後再試');
      return;
    }

    refreshGoogleAccessToken('consent').catch((error) => {
      setAuthError(error instanceof Error ? error.message : 'Google 登入失敗');
    });
  };

  const handleLogout = () => {
    if (user?.accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(user.accessToken, () => setUser(null));
      return;
    }
    setUser(null);
  };

  const closeSettingsModal = () => {
    setShowSettings(false);
    setAvatarChangeArmed(false);
    setIsAddingChild(false);
    setNewChildName('');
    setEditingChildId(null);
    setEditingChildName('');
    setIdleLockMinutesInput(String(settings.idleLockMinutes));
    setTelegramBotTokenInput('');
  };

  const handleStartCalendarConnect = async () => {
    try {
      setIsCalendarConnecting(true);
      setCalendarStatusError(null);
      const response = await fetch('/api/calendar/connect/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          returnTo: window.location.pathname,
          appUserEmail: user?.email || ''
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.authUrl) {
        throw new Error(data?.error || '無法開始 Google Calendar 連線');
      }

      window.location.href = data.authUrl;
    } catch (error) {
      setCalendarStatusError(error instanceof Error ? error.message : '無法開始 Google Calendar 連線');
    } finally {
      setIsCalendarConnecting(false);
    }
  };

  const handleAddCalendarMember = () => {
    const email = newCalendarMemberEmail.trim().toLowerCase();
    const nicknameTokens = newCalendarMemberNicknames
      .split(/[;,，；]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const nickname = nicknameTokens[0] || '';
    const aliases = nicknameTokens.slice(1);
    const displayName = nickname;

    if (!nickname || !email) {
      setCalendarMembersError('請至少輸入一個暱稱與 Email');
      return;
    }

    setCalendarMembers((prev) => [
      ...prev,
      {
        id: `member-${Date.now()}`,
        displayName,
        nickname,
        aliases,
        email,
        isActive: true
      }
    ]);
    setCalendarMembersError(null);
    setNewCalendarMemberEmail('');
    setNewCalendarMemberNicknames('');
  };

  const handleToggleCalendarMember = (id: string) => {
    setCalendarMembers((prev) =>
      prev.map((member) =>
        member.id === id
          ? {
              ...member,
              isActive: !member.isActive
            }
          : member
      )
    );
  };

  const handleDeleteCalendarMember = (id: string) => {
    setCalendarMembers((prev) => prev.filter((member) => member.id !== id));
  };

  const handleSaveCalendarMembers = async () => {
    try {
      setIsSavingCalendarMembers(true);
      setCalendarMembersError(null);
      const savedMembers = await saveCalendarMembersToApi(calendarMembers);
      setCalendarMembers(savedMembers);
    } catch (error) {
      setCalendarMembersError(error instanceof Error ? error.message : '家庭成員名單儲存失敗');
    } finally {
      setIsSavingCalendarMembers(false);
    }
  };

  const handleSaveSelectedCalendar = async () => {
    const target = calendarOptions.find((item) => item.id === selectedCalendarId);
    if (!target) {
      setCalendarStatusError('請先選擇一個家庭 calendar');
      return;
    }

    try {
      setIsSavingSelectedCalendar(true);
      setCalendarStatusError(null);
      const updatedConnection = await saveSelectedCalendarToApi(target.id, target.summary);
      setCalendarConnection(updatedConnection);
      setCalendarConnectionNotice(`已綁定家庭 calendar：${target.summary}`);
      setShowCalendarPicker(false);
    } catch (error) {
      setCalendarStatusError(error instanceof Error ? error.message : '儲存家庭 calendar 失敗');
    } finally {
      setIsSavingSelectedCalendar(false);
    }
  };

  const appendCalendarAiMessage = (
    role: CalendarAiMessage['role'],
    text: string,
    tone: CalendarAiMessage['tone'] = 'default'
  ) => {
    setCalendarAiMessages((prev) => [...prev, createCalendarAiMessage(role, text, tone)]);
  };

  const resetCalendarAiSession = () => {
    setCalendarAiInput('');
    setCalendarAiMessages([]);
    setCalendarAiResult(null);
    setCalendarAiCandidates([]);
    setCalendarAiSelectedEventId('');
    setCalendarAiPendingRequest(null);
    setCalendarAiVoiceError(null);
  };

  const updateCalendarAiDraft = (patch: Record<string, unknown>) => {
    setCalendarAiResult((prev: any) =>
      prev
        ? {
            ...prev,
            eventDraft: {
              ...prev.eventDraft,
              ...patch
            }
          }
        : prev
    );
  };

  const moveCalendarMonth = (offset: number) => {
    const next = new Date(calendarMonthDate.getFullYear(), calendarMonthDate.getMonth() + offset, 1);
    setCalendarMonthDate(next);
    setSelectedCalendarDate(formatLocalDate(next));
  };

  const handleSelectCalendarDate = (date: string) => {
    setSelectedCalendarDate(date);
    if (window.innerWidth < 1280) {
      setShowMobileCalendarDayView(true);
    }
  };

  const openNewCalendarEventModal = () => {
    setEditingCalendarEventId(null);
    setEditingCalendarEvent(createEmptyCalendarDraft());
    setCalendarEventsError(null);
  };

  const openEditCalendarEventModal = async (eventId: string) => {
    try {
      setCalendarEventsError(null);
      setEditingCalendarEventId(eventId);
      const draft = await loadCalendarEventFromApi(eventId);
      setEditingCalendarEvent(draft);
    } catch (error) {
      setEditingCalendarEventId(null);
      setCalendarEventsError(error instanceof Error ? error.message : '無法讀取事件詳情');
    }
  };

  const handleSaveCalendarEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCalendarEvent) return;

    try {
      setIsSavingCalendarEvent(true);
      setCalendarEventsError(null);

      if (editingCalendarEventId) {
        await updateCalendarEventInApi(editingCalendarEventId, {
          ...editingCalendarEvent,
          actorName: user?.name || user?.email || '',
          actorEmail: user?.email || ''
        });
      } else {
        await createCalendarEventInApi({
          ...editingCalendarEvent,
          actorName: user?.name || user?.email || '',
          actorEmail: user?.email || ''
        });
      }

      const targetMonth = new Date(
        Number(editingCalendarEvent.startDate.slice(0, 4)),
        Number(editingCalendarEvent.startDate.slice(5, 7)) - 1,
        1
      );
      setCalendarMonthDate(targetMonth);
      setSelectedCalendarDate(editingCalendarEvent.startDate);
      const events = await loadCalendarMonthEventsFromApi(targetMonth);
      setCalendarEvents(events);
      setEditingCalendarEvent(null);
      setEditingCalendarEventId(null);
      setCalendarConnectionNotice(editingCalendarEventId ? '事件已更新到 Google Calendar' : '事件已新增到 Google Calendar');
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : '儲存事件失敗');
    } finally {
      setIsSavingCalendarEvent(false);
    }
  };

  const handleDeleteCalendarEvent = async (eventId: string) => {
    if (!window.confirm('確定要刪除這筆行事曆事件嗎？此動作會同步到 Google Calendar。')) {
      return;
    }

    try {
      setCalendarEventsError(null);
      await deleteCalendarEventInApi(eventId);
      const events = await loadCalendarMonthEventsFromApi(calendarMonthDate);
      setCalendarEvents(events);
      setCalendarConnectionNotice('事件已從 Google Calendar 刪除');
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : '刪除事件失敗');
    }
  };

  const handleConfirmCalendarEvent = async (eventId: string) => {
    try {
      setCalendarEventsError(null);
      await confirmCalendarEventInApi(eventId);
      const events = await loadCalendarMonthEventsFromApi(calendarMonthDate);
      setCalendarEvents(events);
      setSelectedCalendarConfirmIds((prev) => prev.filter((id) => id !== eventId));
      setCalendarConnectionNotice('事件已標記為完成');
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : '標記完成失敗');
    }
  };

  const handleBulkConfirmCalendarEvents = async () => {
    if (!selectedCalendarConfirmIds.length) return;

    try {
      setCalendarEventsError(null);
      await bulkConfirmCalendarEventsInApi(selectedCalendarConfirmIds);
      const events = await loadCalendarMonthEventsFromApi(calendarMonthDate);
      setCalendarEvents(events);
      setSelectedCalendarConfirmIds([]);
      setCalendarConnectionNotice(`已完成 ${selectedCalendarConfirmIds.length} 筆事件`);
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : '批次完成失敗');
    }
  };

  const handleUnconfirmCalendarEvent = async (eventId: string) => {
    try {
      setCalendarEventsError(null);
      await unconfirmCalendarEventInApi(eventId);
      const events = await loadCalendarMonthEventsFromApi(calendarMonthDate);
      setCalendarEvents(events);
      setCalendarConnectionNotice('事件已取消完成');
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : '取消完成失敗');
    }
  };

  const toggleCalendarConfirmSelection = (eventId: string, checked: boolean) => {
    setSelectedCalendarConfirmIds((prev) =>
      checked ? Array.from(new Set([...prev, eventId])) : prev.filter((id) => id !== eventId)
    );
  };

  const handleRunCalendarAi = async () => {
    const text = calendarAiInput.trim();
    if (!text) {
      setCalendarEventsError('請先輸入想讓 AI 處理的內容');
      return;
    }

    try {
      setIsRunningCalendarAi(true);
      setCalendarEventsError(null);
      setCalendarAiCandidates([]);
      setCalendarAiSelectedEventId('');
      appendCalendarAiMessage('user', text);
      setCalendarAiInput('');
      const requestText = calendarAiPendingRequest
        ? `原始需求：${calendarAiPendingRequest}\n\n補充回答：${text}`
        : text;
      const parsed = await parseCalendarAiInput(requestText);
      setCalendarAiResult(parsed);

      if (parsed?.needsClarification) {
        setCalendarAiPendingRequest(calendarAiPendingRequest || text);
        appendCalendarAiMessage('assistant', parsed?.clarificationQuestion || '我還需要更多資訊才能繼續。', 'clarification');
        return;
      }

      setCalendarAiPendingRequest(null);
      appendCalendarAiMessage('assistant', parsed?.userFacingSummary || '我已整理好這次行事曆操作。');

      if (parsed?.intent === 'update' || parsed?.intent === 'delete' || parsed?.intent === 'query') {
        const candidates = await resolveCalendarAiCandidates(parsed?.searchHint || {});
        setCalendarAiCandidates(candidates);
        if (candidates.length === 1) {
          setCalendarAiSelectedEventId(String(candidates[0]?.id || ''));
        }
        appendCalendarAiMessage(
          'assistant',
          candidates.length
            ? `我找到 ${candidates.length} 筆可能相關的事件，請在下方確認卡中選擇正確的項目。`
            : '我目前沒有找到對應事件，請補充更明確的日期、時間或標題。',
          candidates.length ? 'default' : 'clarification'
        );
      }
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : 'AI 解析失敗');
    } finally {
      setIsRunningCalendarAi(false);
    }
  };

  const handleToggleCalendarAiRecording = async () => {
    if (isRecordingCalendarAi && calendarSpeechRecognitionRef.current) {
      try {
        calendarSpeechRecognitionRef.current.stop();
      } catch {
        // Ignore stop errors when recognition is already ending.
      }
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setCalendarAiVoiceError('目前瀏覽器不支援語音輸入，請改用文字輸入。');
      return;
    }

    if (!window.isSecureContext) {
      setCalendarAiVoiceError('語音輸入需要在安全連線（https）下使用。');
      return;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      setCalendarAiVoiceError('無法取得麥克風權限，請先允許瀏覽器使用麥克風。');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let hasSpeechResult = false;
    let lastErrorCode = '';
    let startedAt = 0;

    recognition.onstart = () => {
      setCalendarAiVoiceError(null);
      setIsRecordingCalendarAi(true);
      startedAt = Date.now();
    };

    recognition.onresult = (event: any) => {
      hasSpeechResult = true;
      const transcript = Array.from(event.results || [])
        .map((result: any) => result?.[0]?.transcript || '')
        .join('')
        .trim();
      if (transcript) {
        setCalendarAiInput(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      const errorCode = String(event?.error || '');
      lastErrorCode = errorCode;
      const message =
        errorCode === 'not-allowed'
          ? '請先允許麥克風權限，才能使用語音輸入。'
          : errorCode === 'service-not-allowed'
            ? '目前瀏覽器封鎖了語音辨識服務，請改用 Chrome 或調整瀏覽器權限。'
          : errorCode === 'audio-capture'
            ? '找不到可用的麥克風裝置，請確認麥克風是否可用。'
          : errorCode === 'network'
            ? '語音辨識服務連線失敗，請稍後再試。'
          : errorCode === 'aborted'
            ? '語音輸入被中斷，請再試一次。'
          : errorCode === 'no-speech'
            ? '沒有偵測到語音，請再試一次。'
            : `語音輸入失敗（${errorCode || 'unknown'}），請改用文字輸入或稍後再試。`;
      setCalendarAiVoiceError(message);
      setIsRecordingCalendarAi(false);
      calendarSpeechRecognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecordingCalendarAi(false);
      calendarSpeechRecognitionRef.current = null;
      if (!hasSpeechResult && !lastErrorCode) {
        const elapsed = startedAt ? Date.now() - startedAt : 0;
        setCalendarAiVoiceError(
          elapsed < 1000
            ? '瀏覽器在開始語音辨識後立即結束，請確認目前使用 Chrome / Safari、已允許麥克風，或重新整理後再試。'
            : '這次沒有收到語音內容，請再說一次。'
        );
      }
    };

    calendarSpeechRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      calendarSpeechRecognitionRef.current = null;
      setIsRecordingCalendarAi(false);
      setCalendarAiVoiceError(error instanceof Error ? `無法啟動語音輸入：${error.message}` : '無法啟動語音輸入，請改用文字輸入。');
    }
  };

  const handleConfirmCalendarAi = async () => {
    if (!calendarAiResult) return;

    const intent = String(calendarAiResult.intent || '');
    if ((intent === 'update' || intent === 'delete') && !calendarAiSelectedEventId) {
      setCalendarEventsError('請先選擇要更新或刪除的事件');
      return;
    }

    try {
      setIsRunningCalendarAi(true);
      setCalendarEventsError(null);
      const result = await executeCalendarAiAction({
        action: intent,
        actorName: user?.name || '',
        actorEmail: user?.email || '',
        source: 'ai_text',
        eventId: calendarAiSelectedEventId || undefined,
        draft: {
          ...calendarAiResult.eventDraft,
          reminderMinutes: Number(calendarAiResult?.eventDraft?.reminderMinutes ?? 30),
          autoRolloverEnabled: calendarAiResult?.eventDraft?.autoRolloverEnabled === true
        }
      });

      if (intent !== 'query') {
        const events = await loadCalendarMonthEventsFromApi(calendarMonthDate);
        setCalendarEvents(events);
      }

      setCalendarConnectionNotice(String(result?.message || 'AI 操作完成'));
      appendCalendarAiMessage('assistant', String(result?.message || 'AI 操作完成'), 'success');
      setCalendarAiResult(null);
      setCalendarAiCandidates([]);
      setCalendarAiSelectedEventId('');
      setCalendarAiPendingRequest(null);
      setCalendarAiInput('');
    } catch (error) {
      setCalendarEventsError(error instanceof Error ? error.message : 'AI 執行失敗');
    } finally {
      setIsRunningCalendarAi(false);
    }
  };

  const saveSettings = async () => {
    const resolvedIdleLockMinutes = normalizeIdleLockMinutes(idleLockMinutesInput);
    const newSettings = {
      ...settings,
      aiApiLink: settings.aiApiLink.trim(),
      idleLockMinutes: resolvedIdleLockMinutes
    };
    try {
      setSyncStatus('syncing');
      const savedSettings = await saveSettingsToD1(newSettings, telegramBotTokenInput);
      setSettings(savedSettings);
      storageManager.saveSettings(savedSettings);
      setIdleLockMinutesInput(String(savedSettings.idleLockMinutes));
      setTelegramBotTokenInput('');
      setSyncStatus('success');
      setSyncError(null);
      closeSettingsModal();
    } catch (error) {
      console.error('Save settings in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '設定同步到 D1 失敗');
    }
  };

  const handleManualPriceSync = async () => {
    if (!user?.email) {
      setPriceUpdateError('請先登入後再更新股價');
      setPriceUpdateNotice(null);
      setSyncStatus('error');
      setSyncError('請先登入後再更新股價');
      return;
    }

    try {
      setIsUpdatingPrices(true);
      setPriceUpdateError(null);
      setPriceUpdateNotice(null);
      setSyncStatus('syncing');
      setSyncError(null);

      const response = await fetch('/api/prices/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...withCalendarUserHeaders()
        }
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Price sync API ${response.status}`);
      }

      const loadedPrices = await loadPricesFromApi();
      setPrices(loadedPrices.filter((p) => p.symbol));
      localStorage.setItem('prices', JSON.stringify(loadedPrices.filter((p) => p.symbol)));

      const updated = Math.max(0, Number(data?.updated || 0));
      const checkedAt = String(data?.checkedAt || '');
      const checkedLabel = checkedAt ? new Date(checkedAt).toLocaleString('zh-TW', { hour12: false }) : '';

      if (data?.skipped === true) {
        const reason = String(data?.reason || '條件不符，略過更新');
        setPriceUpdateNotice(checkedLabel ? `${reason}，檢查時間：${checkedLabel}` : reason);
      } else {
        setPriceUpdateNotice(checkedLabel ? `股價更新完成，共更新 ${updated} 檔，時間：${checkedLabel}` : `股價更新完成，共更新 ${updated} 檔`);
      }
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '股價更新失敗';
      setPriceUpdateError(message);
      setPriceUpdateNotice(null);
      setSyncStatus('error');
      setSyncError(message);
    } finally {
      setIsUpdatingPrices(false);
    }
  };

  const handleAddChild = async () => {
    if (!newChildName.trim()) return;
    const trimmedName = newChildName.trim();
    const avatarSeed = `${trimmedName}-${Date.now()}`;
    
    const newChild: Child = {
      id: Date.now().toString(),
      name: trimmedName,
      avatarSeed,
      avatar: buildAvatarUrl(avatarSeed),
      role: adultManagerEnabled ? 'ADULT' : 'CHILD'
    };
    
    const updated = [...children, newChild];
    setChildren(updated);
    setNewChildName('');
    setIsAddingChild(false);
    localStorage.setItem('children_list', JSON.stringify(updated));
    
    try {
      setSyncStatus('syncing');
      await createChildInD1(newChild);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Create child in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '新增小朋友同步到 D1 失敗');
    }
    
    if (!selectedChildId) setSelectedChildId(newChild.id);
  };

  const startEditingChild = (child: Child) => {
    setEditingChildId(child.id);
    setEditingChildName(child.name);
  };

  const cancelEditingChild = () => {
    setEditingChildId(null);
    setEditingChildName('');
  };

  const saveChildName = async (child: Child) => {
    const trimmedName = editingChildName.trim();
    if (!trimmedName) {
      alert('姓名不能空白');
      return;
    }

    const updatedChild: Child = {
      ...child,
      name: trimmedName
    };

    const updatedChildren = children.map((item) => (item.id === child.id ? updatedChild : item));
    setChildren(updatedChildren);
    localStorage.setItem('children_list', JSON.stringify(updatedChildren));
    cancelEditingChild();

    try {
      setSyncStatus('syncing');
      await updateChildInD1(updatedChild);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Rename child in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '修改姓名同步到 D1 失敗');
    }
  };

  const handleRefreshAvatar = async (childId: string) => {
    if (!avatarChangeArmed) {
      alert('更換頭像需要再次確認：請再點一次更換頭像按鈕以執行。');
      setAvatarChangeArmed(true);
      return;
    }

    const updated = children.map((child) => {
      if (child.id !== childId) return child;
      const nextSeed = `${child.name}-${Date.now()}`;
      return {
        ...child,
        avatarSeed: nextSeed,
        avatar: buildAvatarUrl(nextSeed)
      };
    });

    setChildren(updated);
    localStorage.setItem('children_list', JSON.stringify(updated));
    const target = updated.find((child) => child.id === childId);
    if (!target) return;
    try {
      setSyncStatus('syncing');
      await updateChildInD1(target);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Update child in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '更換頭像同步到 D1 失敗');
    }
  };

  const confirmRemoveChild = async () => {
    if (!childToDelete) return;
    const id = childToDelete.id;

    if (children.length <= 1) {
      alert("系統至少需要保留一位小朋友！");
      setChildToDelete(null);
      return;
    }
    
    const updated = children.filter(c => c.id !== id);
    setChildren(updated);
    localStorage.setItem('children_list', JSON.stringify(updated));
    
    if (selectedChildId === id) {
      setSelectedChildId(updated[0]?.id || '');
    }
    
    try {
      setSyncStatus('syncing');
      await deleteChildInD1(id);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Delete child in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '刪除小朋友同步到 D1 失敗');
    }
    setChildToDelete(null);
  };

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const dateTag = new Date().toISOString().split('T')[0];
    const workbook = XLSX.utils.book_new();

    const childrenSheet = XLSX.utils.aoa_to_sheet([
      ['ID', 'Name', 'Avatar', 'Role', 'AvatarSeed'],
      ...children.map((c) => [c.id, c.name, c.avatar, c.role || 'CHILD', c.avatarSeed || ''])
    ]);
    XLSX.utils.book_append_sheet(workbook, childrenSheet, 'Children');

    const transactionsSheet = XLSX.utils.aoa_to_sheet([
      ['ID', 'ChildId', 'Date', 'Type', 'Category', 'Amount', 'Description'],
      ...transactions.map((t) => [t.id, t.childId, t.date, t.type, t.category, t.amount, t.description])
    ]);
    XLSX.utils.book_append_sheet(workbook, transactionsSheet, 'Transactions');

    const investmentsSheet = XLSX.utils.aoa_to_sheet([
      ['ID', 'ChildId', 'Date', 'Symbol', 'CompanyName', 'Quantity', 'Price', 'TotalAmount', 'Action', 'SellStrategy', 'SellAllocations'],
      ...investments.map((i) => [i.id, i.childId, i.date, i.symbol, i.companyName, i.quantity, i.price, i.totalAmount, i.action, i.sellStrategy || '', i.sellAllocations || ''])
    ]);
    XLSX.utils.book_append_sheet(workbook, investmentsSheet, 'Investments');

    const pricesSheet = XLSX.utils.aoa_to_sheet([
      ['Symbol', 'CompanyName', 'Price', 'UpdatedAt'],
      ...prices.map((p) => [p.symbol, p.companyName || '', p.price, p.updatedAt || ''])
    ]);
    XLSX.utils.book_append_sheet(workbook, pricesSheet, 'Prices');

    const familyCashSheet = XLSX.utils.aoa_to_sheet([
      ['ID', 'Date', 'Type', 'Amount', 'ActorName', 'ActorEmail'],
      ...familyCashRecords.map((record) => [record.id, record.date, record.type, record.amount, record.actorName, record.actorEmail])
    ]);
    XLSX.utils.book_append_sheet(workbook, familyCashSheet, 'FamilyCash');

    XLSX.writeFile(workbook, `KidsLedger_GoogleSheet_Template_${dateTag}.xlsx`);
  };

  const handleAddTransaction = async (t: Transaction) => {
    const newList = [t, ...transactions];
    setTransactions(newList);
    localStorage.setItem('transactions', JSON.stringify(newList));
    try {
      await createTransactionInD1(t);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Create transaction in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '交易同步到 D1 失敗');
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    const updated = transactions.filter(t => t.id !== id);
    setTransactions(updated);
    localStorage.setItem('transactions', JSON.stringify(updated));
    try {
      await deleteTransactionInD1(id);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Delete transaction in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '交易刪除同步到 D1 失敗');
    }
  };

  const handleAddFamilyCashRecord = async (e: React.FormEvent) => {
    e.preventDefault();

    const amount = Number(newFamilyCashAmount);
    if (!newFamilyCashDate || !Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const record: FamilyCashRecord = {
      id: Date.now().toString(),
      date: newFamilyCashDate,
      type: newFamilyCashType,
      amount,
      actorName: user?.name || user?.email || '未知使用者',
      actorEmail: user?.email || ''
    };
    const newList = [record, ...familyCashRecords];
    setFamilyCashRecords(newList);
    localStorage.setItem('family_cash_records', JSON.stringify(newList));
    setNewFamilyCashAmount('');

    try {
      await createFamilyCashRecordInD1(record);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Create family cash record in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '家庭現金同步到 D1 失敗');
    }
  };

  const handleDeleteFamilyCashRecord = async (id: string) => {
    const updated = familyCashRecords.filter((record) => record.id !== id);
    setFamilyCashRecords(updated);
    localStorage.setItem('family_cash_records', JSON.stringify(updated));

    try {
      await deleteFamilyCashRecordInD1(id);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Delete family cash record in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '家庭現金刪除同步到 D1 失敗');
    }
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;
    const updated = transactions.map(t => t.id === editingTransaction.id ? editingTransaction : t);
    setTransactions(updated);
    localStorage.setItem('transactions', JSON.stringify(updated));
    try {
      await updateTransactionInD1(editingTransaction);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Update transaction in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '交易更新同步到 D1 失敗');
    }
    setEditingTransaction(null);
  };

  const handleUpdateFamilyCashRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFamilyCashRecord || !editingFamilyCashRecord.date || editingFamilyCashRecord.amount <= 0) {
      return;
    }

    const updated = familyCashRecords.map((record) =>
      record.id === editingFamilyCashRecord.id ? editingFamilyCashRecord : record
    );
    setFamilyCashRecords(updated);
    localStorage.setItem('family_cash_records', JSON.stringify(updated));

    try {
      await updateFamilyCashRecordInD1(editingFamilyCashRecord);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Update family cash record in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '家庭現金更新同步到 D1 失敗');
    }

    setEditingFamilyCashRecord(null);
  };

  const handleUpdateInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvestment) return;

    const validationError = validateInvestmentSequence(
      investments.map(i => i.id === editingInvestment.id ? editingInvestment : i),
      editingInvestment.childId
    );
    if (validationError) {
      alert(validationError);
      return;
    }

    const updated = investments.map(i => i.id === editingInvestment.id ? editingInvestment : i);
    setInvestments(updated);
    localStorage.setItem('investments', JSON.stringify(updated));
    try {
      await updateInvestmentInD1(editingInvestment);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Update investment in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '投資更新同步到 D1 失敗');
    }
    setEditingInvestment(null);
  };

  const handleDeleteInvestment = async (id: string) => {
    const updated = investments.filter(i => i.id !== id);

    const deletedItem = investments.find((i) => i.id === id);
    if (deletedItem) {
      const validationError = validateInvestmentSequence(updated, deletedItem.childId);
      if (validationError) {
        alert(`無法刪除此筆紀錄：${validationError}`);
        return;
      }
    }

    setInvestments(updated);
    localStorage.setItem('investments', JSON.stringify(updated));
    try {
      await deleteInvestmentInD1(id);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Delete investment in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '投資刪除同步到 D1 失敗');
    }
  };

  const validateInvestmentSequence = (allInvestments: Investment[], childId: string): string | null => {
    const holdings = new Map<string, number>();
    const childRows = allInvestments
      .filter((item) => item.childId === childId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    for (const item of childRows) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        return `股票 ${item.symbol} 的股數必須大於 0`;
      }

      const symbol = item.symbol.toUpperCase();
      const current = holdings.get(symbol) || 0;
      if (item.action === 'BUY') {
        holdings.set(symbol, current + item.quantity);
        continue;
      }

      if (current < item.quantity) {
        return `股票 ${symbol} 在 ${item.date} 嘗試賣出 ${item.quantity} 股，但可用持股僅 ${current} 股`;
      }
      holdings.set(symbol, current - item.quantity);
    }

    return null;
  };

  const handleAddInvestment = async (inv: Investment) => {
    const candidate = [inv, ...investments];
    const validationError = validateInvestmentSequence(candidate, inv.childId);
    if (validationError) {
      throw new Error(validationError);
    }

    const normalizedSymbol = inv.symbol.toUpperCase();
    const priceLookupKey = getInvestmentLookupKey(inv.market || 'TW', normalizedSymbol);
    const shouldCreatePrice =
      inv.action === 'BUY' &&
      normalizedSymbol &&
      !prices.some((price) => getInvestmentLookupKey(price.market || 'TW', price.symbol) === priceLookupKey);

    setInvestments(candidate);
    localStorage.setItem('investments', JSON.stringify(candidate));

    if (shouldCreatePrice) {
      const newPrice: Price = {
        symbol: normalizedSymbol,
        companyName: inv.companyName || normalizedSymbol,
        market: inv.market,
        currency: inv.tradeCurrency,
        price: 0,
        fxRateToTwd: inv.market === 'US' ? inv.fxRateToTwd || 0 : 1,
        updatedAt: ''
      };
      const updatedPrices = [...prices, newPrice];
      setPrices(updatedPrices);
      localStorage.setItem('prices', JSON.stringify(updatedPrices));
      await ensurePriceInD1({
        symbol: normalizedSymbol,
        companyName: inv.companyName || normalizedSymbol,
        market: inv.market,
        currency: inv.tradeCurrency,
        fxRateToTwd: inv.market === 'US' ? inv.fxRateToTwd || 0 : 1
      });
    }

    try {
      await createInvestmentInD1(inv);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Create investment in D1 failed:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : '投資同步到 D1 失敗');
    }
  };

  const activeChild = visibleChildren.find(c => c.id === selectedChildId) || visibleChildren[0] || DEFAULT_CHILDREN[0];
  const childTransactions = transactions.filter(t => t.childId === selectedChildId);
  const childInvestments = investments.filter(i => i.childId === selectedChildId);
  const familyCashRecordsAscending = [...familyCashRecords].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  );
  const familyCashRecordsWithBalance = familyCashRecordsAscending.map((record, index) => {
    const runningBalance = familyCashRecordsAscending
      .slice(0, index + 1)
      .reduce(
        (sum, current) => sum + (current.type === 'DEPOSIT' ? current.amount : -current.amount),
        0
      );

    return {
      ...record,
      runningBalance
    };
  });
  const familyCashRecordsDescending = [...familyCashRecordsWithBalance].reverse();
  const familyCashBalance = familyCashRecordsAscending.reduce(
    (sum, record) => sum + (record.type === 'DEPOSIT' ? record.amount : -record.amount),
    0
  );
  const priceBySymbol = new Map<string, Price>(
    prices.map((item) => [getInvestmentLookupKey(item.market || 'TW', item.symbol), item])
  );

  const portfolioSummary = (() => {
    const openLotsBySymbol = new Map<string, DashboardLotState[]>();
    const sortedInvestments = [...childInvestments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    sortedInvestments.forEach((investment) => {
      const symbol = investment.symbol.toUpperCase();
      const lookupKey = getInvestmentLookupKey(investment.market || 'TW', symbol);
      const lots = openLotsBySymbol.get(lookupKey) || [];

      if (investment.action === 'BUY') {
        lots.push({
          lotId: investment.id,
          symbol,
          market: investment.market || 'TW',
          buyDate: investment.date,
          remainingQuantity: investment.quantity,
          remainingCost: investment.totalAmount,
          remainingCostTwd: Number(investment.netAmountTwd || 0),
          unitCost: investment.quantity > 0 ? investment.totalAmount / investment.quantity : 0,
          unitCostTwd: investment.quantity > 0 ? Number(investment.netAmountTwd || 0) / investment.quantity : 0
        });
        openLotsBySymbol.set(lookupKey, lots);
        return;
      }

      let remainingToSell = investment.quantity;
      const specifiedAllocations = parseSellAllocations(investment.sellAllocations);
      let candidateLots: DashboardLotState[] = [];

      if (investment.sellStrategy === 'SPECIFIC' && specifiedAllocations.length > 0) {
        candidateLots = specifiedAllocations
          .map((allocation) => lots.find((lot) => lot.lotId === allocation.lotId))
          .filter((lot): lot is DashboardLotState => Boolean(lot));
      } else if (investment.sellStrategy === 'LOWEST_COST') {
        candidateLots = [...lots].sort((a, b) => a.unitCost - b.unitCost || a.buyDate.localeCompare(b.buyDate) || a.lotId.localeCompare(b.lotId));
      } else {
        candidateLots = [...lots].sort((a, b) => a.buyDate.localeCompare(b.buyDate) || a.lotId.localeCompare(b.lotId));
      }

      const explicitAllocationMap = new Map(specifiedAllocations.map((allocation) => [allocation.lotId, allocation.quantity]));

      for (const lot of candidateLots) {
        if (remainingToSell <= 0) break;
        if (lot.remainingQuantity <= 0) continue;

        const allowedQuantity = explicitAllocationMap.size > 0
          ? Math.min(explicitAllocationMap.get(lot.lotId) || 0, lot.remainingQuantity, remainingToSell)
          : Math.min(lot.remainingQuantity, remainingToSell);

        if (allowedQuantity <= 0) continue;

        const costPortion = lot.unitCost * allowedQuantity;
        const costPortionTwd = lot.unitCostTwd * allowedQuantity;
        lot.remainingQuantity -= allowedQuantity;
        lot.remainingCost = Math.max(0, lot.remainingCost - costPortion);
        lot.remainingCostTwd = Math.max(0, lot.remainingCostTwd - costPortionTwd);
        if (lot.remainingQuantity <= 0) {
          lot.remainingQuantity = 0;
          lot.remainingCost = 0;
          lot.remainingCostTwd = 0;
        }
        remainingToSell -= allowedQuantity;
      }

      openLotsBySymbol.set(lookupKey, lots.filter((lot) => lot.remainingQuantity > 0));
    });

    let marketValue = 0;
    let costBasis = 0;
    let estimatedSellValue = 0;

    Array.from(openLotsBySymbol.entries()).forEach(([lookupKey, lots]) => {
      const activeLots = lots.filter((lot) => lot.remainingQuantity > 0);
      if (activeLots.length === 0) return;

      const market = activeLots[0]?.market || 'TW';
      const shares = activeLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
      const remainingCostTwd = activeLots.reduce((sum, lot) => sum + lot.remainingCostTwd, 0);
      const priceRow = priceBySymbol.get(lookupKey);
      const marketPrice = Number(priceRow?.price || 0);
      const currentFxRateToTwd = market === 'US' ? getPriceFxRateToTwd(priceRow, settings.usdTwdReferenceRate || 0) : 1;

      marketValue += market === 'US' ? shares * marketPrice * currentFxRateToTwd : shares * marketPrice;
      costBasis += remainingCostTwd;
      estimatedSellValue += marketPrice > 0
        ? calculateNetAmountTwd({
            market,
            totalAmount: calculateTradeTotal({
              market,
              quantity: shares,
              price: marketPrice,
              action: 'SELL',
              broker: market === 'US' ? DEFAULT_US_BROKER : '',
              orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
            }),
            fxRateToTwd: currentFxRateToTwd
          })
        : 0;
    });

    return {
      marketValue,
      costBasis,
      unrealizedPnl: estimatedSellValue - costBasis
    };
  })();

  const investedInMarket = Math.max(Math.round(portfolioSummary.marketValue), 0);

  const stats = {
    income: childTransactions.filter(t => t.type === TransactionType.INCOME).reduce((s, t) => s + t.amount, 0),
    expense: childTransactions.filter(t => t.type === TransactionType.EXPENSE).reduce((s, t) => s + t.amount, 0),
    investment: 
      childTransactions.filter(t => t.type === TransactionType.INVESTMENT).reduce((s, t) => s + t.amount, 0) +
      childInvestments.reduce((s, i) => i.action === 'BUY' ? s + (i.netAmountTwd || 0) : s - (i.netAmountTwd || 0), 0),
  };
  const balance = stats.income - stats.expense - stats.investment;
  const assetDistributionData = [
    { name: '可用餘額', value: Math.max(Math.round(balance), 0), color: '#10b981' },
    { name: '股市中資金', value: Math.max(Math.round(investedInMarket), 0), color: '#f59e0b' }
  ];
  const assetDistributionTotal = assetDistributionData.reduce((sum, item) => sum + item.value, 0);
  const calendarMonthGrid = buildCalendarMonthGrid(calendarMonthDate);
  const calendarEventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEventSummary[]>();

    calendarEvents.forEach((event) => {
      const startDate = event.startDate || '';
      const endDate = event.endDate || startDate;
      if (!startDate) return;

      const inclusiveEnd = event.allDay && endDate
        ? new Date(`${endDate}T00:00:00`)
        : new Date(`${endDate || startDate}T00:00:00`);
      const cursor = new Date(`${startDate}T00:00:00`);
      if (Number.isNaN(cursor.getTime())) return;

      if (event.allDay && !Number.isNaN(inclusiveEnd.getTime())) {
        inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
      }

      const finalDate = !Number.isNaN(inclusiveEnd.getTime()) ? inclusiveEnd : new Date(cursor);
      while (cursor <= finalDate) {
        const key = formatLocalDate(cursor);
        const items = grouped.get(key) || [];
        items.push(event);
        grouped.set(key, items);
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    return grouped;
  }, [calendarEvents]);
  const selectedCalendarDayEvents = calendarEventsByDate.get(selectedCalendarDate) || [];
  const editingCalendarReminderMinutes = editingCalendarEvent?.reminders[0]?.minutes ?? 30;
  const editingCalendarReminderMode = CALENDAR_REMINDER_PRESET_OPTIONS.includes(editingCalendarReminderMinutes)
    ? String(editingCalendarReminderMinutes)
    : 'custom';

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 p-4">
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl max-w-md w-full text-center border-8 border-white/20">
          <div className="w-24 h-24 bg-blue-100 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-bounce">
            <Wallet className="w-12 h-12 text-blue-600" />
          </div>
          <h1 className="text-4xl font-black mb-2 text-gray-800 tracking-tight">小財主養成計畫</h1>
          <p className="text-gray-500 mb-10 text-lg font-medium">智慧記帳，從小培養理財觀</p>
          <button onClick={handleLogin} className="w-full flex items-center justify-center gap-3 bg-gray-900 text-white py-4 rounded-2xl hover:bg-black transition-all shadow-xl font-bold text-lg">
            使用 Google 登入
          </button>
          {authError && <p className="mt-4 text-sm text-rose-600 font-bold">{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[#f8fafc] overflow-x-hidden">
      <aside className="w-64 h-screen sticky top-0 bg-white border-r border-slate-200 flex-col hidden lg:flex shadow-sm">
        <div className="p-8 flex items-center gap-4">
          <div className="bg-blue-600 p-2.5 rounded-2xl shadow-lg shadow-blue-200">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <span className="font-black text-2xl tracking-tighter text-slate-800">KidsLedger</span>
        </div>
        
        <nav className="flex-1 p-6 space-y-3">
          <button onClick={() => setActiveTab('DASHBOARD')} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'DASHBOARD' ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <BarChart3 className="w-6 h-6" /> 帳務總覽
          </button>
          <button onClick={() => setActiveTab('INVESTMENTS')} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'INVESTMENTS' ? 'bg-orange-50 text-orange-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <PiggyBank className="w-6 h-6" /> 股票投資
          </button>
          <button onClick={() => setActiveTab('FAMILY_CASH')} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'FAMILY_CASH' ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Wallet className="w-6 h-6" /> 家庭現金
          </button>
          <button onClick={() => setActiveTab('CALENDAR')} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'CALENDAR' ? 'bg-violet-50 text-violet-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <CalendarDays className="w-6 h-6" /> 家庭行事曆
          </button>
        </nav>

        <div className="p-6 mt-auto space-y-4 pb-8">
          <button onClick={exportToExcel} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-emerald-600 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition w-full">
            <Download className="w-4 h-4" /> 匯出帳本 Excel
          </button>
          <button onClick={() => setShowSettings(true)} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition w-full">
            <Settings className="w-4 h-4" /> 系統與小朋友設定
          </button>

          <div className="bg-slate-50 p-5 rounded-[2rem] border border-slate-100">
            <div className="flex items-center gap-3 mb-3">
              <img src={user.picture} className="w-12 h-12 rounded-2xl border-2 border-white shadow-md" alt="User" />
              <div className="overflow-hidden">
                <p className="text-sm font-black truncate text-slate-800">{user.name}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">管理者</p>
              </div>
            </div>
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-xs text-rose-500 font-black hover:bg-rose-50 py-2.5 rounded-xl transition">
              <LogOut className="w-4 h-4" /> 登出
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 h-screen overflow-y-auto overflow-x-hidden">
        <header className="sticky top-0 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 p-4 z-20">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between gap-3">
              {activeTab === 'FAMILY_CASH' ? (
                <div className="flex-1 flex items-center bg-emerald-50 px-5 py-4 rounded-[1.5rem] border border-emerald-100 text-emerald-700">
                  <Wallet className="w-5 h-5 mr-3" />
                  <div>
                    <p className="text-sm font-black">家庭現金</p>
                    <p className="text-xs font-bold text-emerald-500">管理全家持有的現金總額</p>
                  </div>
                </div>
              ) : activeTab === 'CALENDAR' ? (
                <div className="flex-1 flex items-center bg-violet-50 px-5 py-4 rounded-[1.5rem] border border-violet-100 text-violet-700">
                  <CalendarDays className="w-5 h-5 mr-3" />
                  <div>
                    <p className="text-sm font-black">家庭行事曆</p>
                    <p className="text-xs font-bold text-violet-500">
                      {calendarConnection.connected
                        ? `已連接 ${calendarConnection.calendarName || '家庭 calendar'}`
                        : calendarConnection.authorized
                          ? '已授權，請選擇家庭 calendar'
                          : 'Google Calendar 連線與家庭成員同步設定'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex bg-slate-100 p-1.5 rounded-[1.5rem] shadow-inner overflow-x-auto no-scrollbar">
                  {visibleChildren.map(child => (
                    <button
                      key={child.id}
                      onClick={() => setSelectedChildId(child.id)}
                      className={`flex items-center gap-2.5 px-5 py-2.5 rounded-[1.25rem] text-sm font-black transition-all whitespace-nowrap ${selectedChildId === child.id ? 'bg-white text-blue-600 shadow-md scale-105' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <img src={child.avatar} className="w-6 h-6 rounded-lg bg-slate-200" alt={child.name} />
                      {child.name}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-3 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                aria-label="開啟選單"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div
                className={`hidden lg:flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${syncStatus === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : syncStatus === 'error' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}
                title={syncError || ''}
              >
                <Database className={`w-3 h-3 ${syncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
                {syncStatus === 'success' ? '雲端同步正常' : syncStatus === 'error' ? '同步失敗' : syncStatus === 'syncing' ? '同步中...' : '未連線'}
              </div>
            </div>

            <div className="flex justify-end mt-4 lg:hidden">
              <div
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${syncStatus === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : syncStatus === 'error' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}
                title={syncError || ''}
              >
                <Database className={`w-3 h-3 ${syncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
                {syncStatus === 'success' ? '雲端同步正常' : syncStatus === 'error' ? '同步失敗' : syncStatus === 'syncing' ? '同步中...' : '未連線'}
              </div>
            </div>
          </div>
        </header>

        {syncError && (
          <div className="mx-6 md:mx-10 mt-4 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-rose-700 text-sm font-bold">
            雲端同步失敗：{syncError}
          </div>
        )}

        <div className="w-full px-4 sm:px-6 md:px-10 py-6 sm:py-10 pb-32 overflow-x-hidden">
          {activeTab === 'DASHBOARD' ? (
            <div className="space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-[2.5rem] text-white shadow-xl">
                  <p className="text-blue-100 text-sm font-bold mb-2 uppercase tracking-widest">可用餘額</p>
                  <h4 className="text-4xl font-black">${Math.round(balance).toLocaleString()}</h4>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">累積收入</p>
                  <h4 className="text-3xl font-black text-slate-800">${Math.round(stats.income).toLocaleString()}</h4>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">累積支出</p>
                  <h4 className="text-3xl font-black text-slate-800">${Math.round(stats.expense).toLocaleString()}</h4>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">股票總市值</p>
                  <h4 className="text-3xl font-black text-slate-800">${Math.round(investedInMarket).toLocaleString()}</h4>
                </div>
              </div>

              {settings.aiMentorEnabled && (
                <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-slate-100 flex items-center gap-8 flex-wrap lg:flex-nowrap">
                  <div className="bg-blue-50 p-4 rounded-3xl">
                    <Sparkles className="w-8 h-8 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-[300px]">
                    <h3 className="text-xl font-black text-slate-800 mb-1">AI 導師建議</h3>
                    <p className="text-slate-500 font-medium leading-relaxed">{aiAdvice || "讓 AI 幫你看看這個月的表現！點擊右側按鈕開始分析。"}</p>
                  </div>
                  <button 
                    onClick={async () => {
                      setLoadingAdvice(true);
                      setAiAdvice(await getFinancialAdvice(activeChild.name, childTransactions));
                      setLoadingAdvice(false);
                    }}
                    className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black hover:bg-blue-700 transition shadow-lg shadow-blue-100 active:scale-95 disabled:opacity-50"
                    disabled={loadingAdvice}
                  >
                    {loadingAdvice ? '分析中...' : '獲取建議'}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-9 space-y-10">
                  <TransactionForm childId={selectedChildId} onAdd={handleAddTransaction} />
                  
                  <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100">
                    <h3 className="text-xl font-black text-slate-800 mb-8">帳目流水歷史</h3>
                    <div className="space-y-4">
                      {childTransactions.length === 0 ? (
                        <div className="py-20 text-center text-slate-300 font-bold italic">尚無記帳紀錄</div>
                      ) : (
                        childTransactions.map((t) => (
                          <div key={t.id} className="flex items-start gap-3 p-4 sm:p-6 hover:bg-slate-50 rounded-3xl transition group">
                            <div className={`p-3 sm:p-4 rounded-2xl -ml-3 sm:ml-0 shrink-0 ${t.type === TransactionType.INCOME ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                              {t.type === TransactionType.INCOME ? <ArrowUpCircle /> : <ArrowDownCircle />}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="sm:hidden space-y-2.5">
                                <p className="font-black text-slate-800 text-lg leading-snug break-words">
                                  {t.description}
                                </p>
                                <p className="text-xs text-slate-400 font-bold uppercase leading-relaxed break-words">
                                  {t.date} • {t.category}
                                </p>
                                <div className="flex items-center justify-between gap-3 pt-1">
                                  <span className={`font-mono font-black text-2xl whitespace-nowrap ${t.type === TransactionType.INCOME ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {t.type === TransactionType.EXPENSE ? '-' : '+'}${t.amount.toLocaleString()}
                                  </span>
                                  <div className="flex gap-2 shrink-0">
                                    <button onClick={() => setEditingTransaction(t)} className="p-2 text-slate-400 hover:text-blue-600 bg-white rounded-xl shadow-sm border border-slate-100">
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (!window.confirm(`確定要刪除「${t.description}」這筆帳目嗎？此動作無法撤回。`)) {
                                          return;
                                        }
                                        handleDeleteTransaction(t.id);
                                      }}
                                      className="p-2 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div className="hidden sm:flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-black text-slate-800 text-lg leading-tight break-words">{t.description}</p>
                                  <p className="text-xs text-slate-400 font-bold uppercase break-words">{t.date} • {t.category}</p>
                                </div>
                                <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
                                  <span className={`font-mono font-black text-xl sm:text-2xl whitespace-nowrap ${t.type === TransactionType.INCOME ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {t.type === TransactionType.EXPENSE ? '-' : '+'}${t.amount.toLocaleString()}
                                  </span>
                                  <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                                    <button onClick={() => setEditingTransaction(t)} className="p-2 text-slate-400 hover:text-blue-600 bg-white rounded-xl shadow-sm border border-slate-100">
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (!window.confirm(`確定要刪除「${t.description}」這筆帳目嗎？此動作無法撤回。`)) {
                                          return;
                                        }
                                        handleDeleteTransaction(t.id);
                                      }}
                                      className="p-2 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 h-fit">
                    <div className="text-center">
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-widest">資產分布（現值）</h3>
                      <p className="mt-2 text-sm font-semibold text-slate-400">看現在這些資產值多少</p>
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={assetDistributionData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                            {assetDistributionData.map((item) => (
                              <Cell key={item.name} fill={item.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => `${Math.round(Number(value) || 0).toLocaleString()}`} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-6 space-y-3">
                      {assetDistributionData.map((item) => {
                        const percent = assetDistributionTotal > 0 ? ((item.value / assetDistributionTotal) * 100).toFixed(1) : '0.0';
                        return (
                          <div key={item.name} className="flex items-center justify-between text-sm font-bold text-slate-600 gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                              <span className="truncate">{item.name}</span>
                            </div>
                            <span className="whitespace-nowrap">{percent}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'CALENDAR' ? (
            <div className="space-y-8">
              {calendarStatusError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
                  {calendarStatusError}
                </div>
              )}

              {calendarConnectionNotice && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                  {calendarConnectionNotice}
                </div>
              )}

              {!calendarConnection.connected ? (
                <div className="bg-white rounded-[3rem] p-8 shadow-sm border border-slate-100 space-y-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-violet-500 text-sm font-black uppercase tracking-widest">Google Calendar</p>
                      <h2 className="text-3xl font-black text-slate-800 mt-2">先完成家庭行事曆連線</h2>
                      <p className="text-slate-500 font-medium mt-3 max-w-2xl">
                        第一次使用只要完成 Google Calendar 授權並指定一個家庭共用 calendar，之後就會直接進入月曆畫面。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartCalendarConnect}
                      disabled={isCalendarConnecting}
                      className="rounded-2xl bg-violet-600 px-6 py-4 text-sm font-black text-white shadow-lg shadow-violet-100 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
                    >
                      {isCalendarConnecting ? '連線中...' : calendarConnection.authorized ? '重新授權 Google Calendar' : '連接 Google Calendar'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-[2rem] border border-violet-100 bg-violet-50 p-6">
                      <div className="flex items-center gap-3">
                        <Link2 className="w-5 h-5 text-violet-600" />
                        <p className="text-sm font-black text-violet-700">連線狀態</p>
                      </div>
                      <p className="mt-4 text-2xl font-black text-slate-800">
                        {calendarConnection.authorized ? '已授權待選擇' : '尚未連接'}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-500">
                        {calendarConnection.authorized
                          ? `已授權帳號 ${calendarConnection.googleEmail || '未提供帳號'}，請選擇家庭 calendar。`
                          : '先完成 OAuth 後，這裡會顯示你綁定的 Google 帳號。'}
                      </p>
                    </div>

                    <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-6">
                      <div className="flex items-center gap-3">
                        <Clock3 className="w-5 h-5 text-slate-600" />
                        <p className="text-sm font-black text-slate-700">午夜自動順延</p>
                      </div>
                      <p className="mt-4 text-2xl font-black text-slate-800">
                        {calendarEvents.filter((event) => event.autoRolloverEnabled).length}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-500">
                        顯示本月已啟用自動順延的事件數量，適合追蹤待辦型活動。
                      </p>
                    </div>
                  </div>

                  {calendarConnection.authorized && (
                    <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-6">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <p className="text-sm font-black text-slate-700">選擇家庭 calendar</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">
                            第一次只要指定一個家庭共用 calendar，之後會直接顯示月曆。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleSaveSelectedCalendar}
                          disabled={isSavingSelectedCalendar || !selectedCalendarId}
                          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-400"
                        >
                          {isSavingSelectedCalendar ? '儲存中...' : '儲存家庭 calendar'}
                        </button>
                      </div>

                      <div className="mt-5">
                        <select
                          value={selectedCalendarId}
                          onChange={(e) => setSelectedCalendarId(e.target.value)}
                          className="w-full rounded-2xl border-2 border-slate-100 bg-white px-4 py-4 text-sm font-bold text-slate-700 focus:border-violet-500 focus:outline-none"
                        >
                          <option value="">{isLoadingCalendarOptions ? '載入 calendar 清單中...' : '請選擇一個 calendar'}</option>
                          {calendarOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.summary || item.id}{item.primary ? '（主要）' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-[2.5rem] p-5 shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center text-violet-600">
                        <CalendarDays className="w-6 h-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">
                          已連接 {calendarConnection.calendarName || 'Family Calendar'}
                        </p>
                        <p className="text-xs font-semibold text-slate-400 truncate">
                          使用者：{user?.email || '未提供帳號'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setShowCalendarPicker((prev) => !prev)}
                        className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200"
                      >
                        {showCalendarPicker ? '收合行事曆選擇' : '更換行事曆'}
                      </button>
                      <button
                        type="button"
                        onClick={handleStartCalendarConnect}
                        disabled={isCalendarConnecting}
                        className="rounded-2xl bg-violet-50 px-4 py-3 text-sm font-black text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isCalendarConnecting ? '連線中...' : '重新連接'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {calendarConnection.authorized && calendarConnection.connected && showCalendarPicker && (
                <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-sm font-black text-slate-700">重新選擇家庭 calendar</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        如果目前綁定錯了，這裡可以改成另一個你有權限的 Google Calendar。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveSelectedCalendar}
                      disabled={isSavingSelectedCalendar || !selectedCalendarId}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {isSavingSelectedCalendar ? '儲存中...' : '儲存新的家庭 calendar'}
                    </button>
                  </div>

                  <div className="mt-5">
                    <select
                      value={selectedCalendarId}
                      onChange={(e) => setSelectedCalendarId(e.target.value)}
                      className="w-full rounded-2xl border-2 border-slate-100 bg-white px-4 py-4 text-sm font-bold text-slate-700 focus:border-violet-500 focus:outline-none"
                    >
                      <option value="">{isLoadingCalendarOptions ? '載入 calendar 清單中...' : '請選擇一個 calendar'}</option>
                      {calendarOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.summary || item.id}{item.primary ? '（主要）' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 sm:gap-6">
                <div className="xl:col-span-8 min-w-0 bg-white rounded-[2rem] sm:rounded-[3rem] p-4 sm:p-6 xl:p-8 shadow-sm border border-slate-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-sm font-black text-slate-400 uppercase tracking-widest">月曆預覽</p>
                      <h3 className="text-xl sm:text-2xl font-black text-slate-800 mt-2">{formatCalendarMonthLabel(calendarMonthDate)}</h3>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar">
                      <button
                        type="button"
                        onClick={() => moveCalendarMonth(-1)}
                        className="rounded-2xl bg-slate-100 px-3 sm:px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200 whitespace-nowrap"
                      >
                        上月
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const today = new Date();
                          setCalendarMonthDate(new Date(today.getFullYear(), today.getMonth(), 1));
                          setSelectedCalendarDate(formatLocalDate(today));
                        }}
                        className="rounded-2xl bg-violet-50 px-3 sm:px-4 py-3 text-sm font-black text-violet-700 transition hover:bg-violet-100 whitespace-nowrap"
                      >
                        今天
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCalendarMonth(1)}
                        className="rounded-2xl bg-slate-100 px-3 sm:px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200 whitespace-nowrap"
                      >
                        下月
                      </button>
                    </div>
                  </div>

                  {calendarEventsError && (
                    <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
                      {calendarEventsError}
                    </div>
                  )}

                  {!calendarConnection.connected ? (
                    <div className="mt-8 rounded-[2rem] border border-dashed border-slate-200 px-6 py-12 text-center text-sm font-bold text-slate-400">
                      先完成家庭 calendar 綁定，這裡就會顯示 Google Calendar 的月曆事件。
                    </div>
                  ) : (
                    <div className="mt-6 sm:mt-8 min-w-0">
                      <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 sm:mb-3">
                        {CALENDAR_WEEKDAY_LABELS.map((label) => (
                          <div key={label} className="px-1 py-2 text-center text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400">
                            {label}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1 sm:gap-2 min-w-0">
                        {calendarMonthGrid.map((cellDate) => {
                          const cellKey = formatLocalDate(cellDate);
                          const items = calendarEventsByDate.get(cellKey) || [];
                          const isCurrentMonth = cellDate.getMonth() === calendarMonthDate.getMonth();
                          const isSelected = cellKey === selectedCalendarDate;
                          const isToday = cellKey === formatLocalDate(new Date());

                          return (
                            <button
                              key={cellKey}
                              type="button"
                              onClick={() => handleSelectCalendarDate(cellKey)}
                              className={`relative min-h-[72px] sm:min-h-[96px] xl:min-h-[122px] min-w-0 overflow-hidden rounded-[1.15rem] sm:rounded-[1.75rem] border px-1.5 py-2 sm:p-3 text-left transition ${
                                isSelected
                                  ? 'border-violet-300 bg-violet-50 shadow-sm'
                                  : isCurrentMonth
                                    ? 'border-slate-100 bg-slate-50 hover:border-violet-200 hover:bg-violet-50/60'
                                    : 'border-slate-100 bg-white text-slate-300'
                              }`}
                            >
                              <div className="absolute left-1.5 top-2 right-1.5 sm:left-3 sm:top-3 sm:right-3 flex items-start justify-between gap-1">
                                <span className={`text-xs sm:text-sm font-black ${isCurrentMonth ? 'text-slate-700' : 'text-slate-300'}`}>
                                  {cellDate.getDate()}
                                </span>
                                {isToday && (
                                  <span className="rounded-full bg-violet-600 px-1.5 sm:px-2 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-white">
                                    <span className="sm:hidden">今</span>
                                    <span className="hidden sm:inline">TODAY</span>
                                  </span>
                                )}
                              </div>
                              <div className="mt-6 sm:mt-7 space-y-1 sm:space-y-2">
                                <div className="space-y-1 sm:hidden">
                                  {items.slice(0, 1).map((event) => (
                                    <div key={`${cellKey}-${event.id}`} className="truncate rounded-lg bg-white/90 px-1.5 py-1 text-[10px] font-black text-slate-600 border border-white shadow-sm">
                                      {formatCalendarEventChipLabel(event)}
                                    </div>
                                  ))}
                                </div>
                                <div className="hidden sm:block space-y-2">
                                  {items.slice(0, 3).map((event) => (
                                    <div key={`${cellKey}-${event.id}`} className="truncate rounded-xl bg-white/90 px-2.5 py-2 text-[11px] font-black text-slate-600 border border-white shadow-sm">
                                      {formatCalendarEventChipLabel(event)}
                                    </div>
                                  ))}
                                </div>
                                {items.length > 1 && (
                                  <div className="sm:hidden text-[10px] font-black text-violet-600">+{items.length - 1}</div>
                                )}
                                {items.length > 3 && (
                                  <div className="hidden sm:block text-[11px] font-black text-violet-600">+{items.length - 3} 更多</div>
                                )}
                                {!items.length && (
                                  <div className="text-[10px] sm:text-[11px] font-bold text-slate-300">
                                    {isLoadingCalendarEvents && isCurrentMonth ? '載入中...' : ' '}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

              <div className="hidden xl:block xl:col-span-4 bg-white rounded-[2rem] sm:rounded-[3rem] p-5 sm:p-8 shadow-sm border border-slate-100">
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest">當日事件</p>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-800 mt-2 break-words">{selectedCalendarDate}</h3>
                  <p className="mt-2 text-sm font-semibold text-slate-400">
                    點月曆日期可查看當天事件，點事件可直接編輯或刪除。
                  </p>

                  <div className="mt-6 sm:mt-8 space-y-4">
                    {selectedCalendarDayEvents.length > 1 && (
                      <div className="rounded-[2rem] border border-slate-100 bg-slate-50 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-slate-600">
                            已選取 {selectedCalendarConfirmIds.length} / {selectedCalendarDayEvents.filter((event) => !event.isConfirmed).length} 筆未完成事件
                          </p>
                          <button
                            type="button"
                            onClick={handleBulkConfirmCalendarEvents}
                            disabled={selectedCalendarConfirmIds.length === 0}
                            className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                          >
                            批次完成
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedCalendarDayEvents.length === 0 ? (
                      <div className="rounded-[2rem] border border-dashed border-slate-200 px-5 py-10 text-center text-sm font-bold text-slate-400">
                        這一天目前沒有事件
                      </div>
                    ) : (
                      selectedCalendarDayEvents.map((event) => (
                        <div key={event.id} className="rounded-[2rem] border border-slate-100 bg-slate-50 px-4 sm:px-5 py-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {!event.isConfirmed && (
                                <label className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black text-slate-500 border border-slate-200">
                                  <input
                                    type="checkbox"
                                    checked={selectedCalendarConfirmIds.includes(event.id)}
                                    onChange={(e) => toggleCalendarConfirmSelection(event.id, e.target.checked)}
                                  />
                                  <span>加入批次完成</span>
                                </label>
                              )}
                              <p className="text-base sm:text-lg font-black text-slate-800 break-words">{event.title}</p>
                              <p className="mt-2 text-sm font-bold text-violet-600">{formatCalendarEventTime(event)}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest border ${
                              event.isConfirmed
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}>
                              {event.isConfirmed ? '已完成' : '待完成'}
                            </span>
                          </div>
                          {event.location && (
                            <p className="mt-3 text-sm font-semibold text-slate-500 break-words">地點：{event.location}</p>
                          )}
                          {event.description && (
                            <p className="mt-2 text-sm font-semibold text-slate-500 whitespace-pre-wrap break-words">
                              {event.description}
                            </p>
                          )}
                          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black text-slate-400">
                            {event.autoRolloverEnabled && (
                              <span className="rounded-full bg-amber-50 px-3 py-1 border border-amber-200 text-amber-700">
                                未完成會順延
                              </span>
                            )}
                            {event.isConfirmed && (
                              <span className="rounded-full bg-emerald-50 px-3 py-1 border border-emerald-200 text-emerald-700">
                                已完成
                              </span>
                            )}
                          </div>
                          {event.isConfirmed && event.confirmedByName && (
                            <p className="mt-3 text-xs font-bold text-emerald-700">
                              已由 {event.confirmedByName} 完成
                            </p>
                          )}
                          <div className="mt-4 flex gap-3">
                            {!event.isConfirmed ? (
                              <button
                                type="button"
                                onClick={() => handleConfirmCalendarEvent(event.id)}
                                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
                              >
                                完成
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleUnconfirmCalendarEvent(event.id)}
                                className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-black text-amber-800 transition hover:bg-amber-200"
                              >
                                取消完成
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditCalendarEventModal(event.id)}
                              className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-violet-700 border border-violet-100 transition hover:bg-violet-50"
                            >
                              編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCalendarEvent(event.id)}
                              className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-rose-600 border border-rose-100 transition hover:bg-rose-50"
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[2rem] sm:rounded-[3rem] p-5 sm:p-8 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="bg-violet-50 p-3 rounded-2xl">
                      <Sparkles className="w-6 h-6 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-400 uppercase tracking-widest">AI 助手</p>
                      <h3 className="text-xl sm:text-2xl font-black text-slate-800 mt-1">用中文描述行事曆操作</h3>
                    </div>
                  </div>
                  {calendarAiMessages.length > 0 && (
                    <button
                      type="button"
                      onClick={resetCalendarAiSession}
                      className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-500 transition hover:bg-slate-200"
                    >
                      開始新對話
                    </button>
                  )}
                </div>

                {calendarAiMessages.length > 0 && (
                  <div className="mt-6 rounded-[2rem] border border-slate-100 bg-slate-50 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black uppercase tracking-widest text-slate-400">對話紀錄</p>
                      <p className="text-xs font-bold text-slate-400">補充資訊時會保留前文，不需要重打</p>
                    </div>
                    <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1">
                      {calendarAiMessages.map((message) => (
                        <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[92%] rounded-[1.5rem] px-4 py-3 text-sm font-bold whitespace-pre-wrap break-words ${
                              message.role === 'user'
                                ? 'bg-violet-600 text-white'
                                : message.tone === 'clarification'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : message.tone === 'success'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-white text-slate-700 border border-slate-200'
                            }`}
                          >
                            {message.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-4">
                  <textarea
                    value={calendarAiInput}
                    onChange={(e) => setCalendarAiInput(e.target.value)}
                    rows={3}
                    placeholder={
                      calendarAiPendingRequest
                        ? '請直接回答剛剛的追問，例如：標題是測試行事曆，持續 30 分鐘'
                        : '例如：幫我下週三晚上七點安排小明鋼琴課一小時，提醒媽媽和爸爸，提前三十分鐘提醒'
                    }
                    className="w-full rounded-[2rem] border-2 border-slate-100 bg-slate-50 p-5 text-sm font-bold text-slate-700 focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleToggleCalendarAiRecording}
                    disabled={!calendarConnection.connected}
                    className={`rounded-[2rem] px-6 py-4 text-sm font-black transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${
                      isRecordingCalendarAi
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {isRecordingCalendarAi ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      {isRecordingCalendarAi ? '停止錄音' : '語音輸入'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRunCalendarAi}
                    disabled={isRunningCalendarAi || !calendarConnection.connected}
                    className="rounded-[2rem] bg-violet-600 px-8 py-4 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
                  >
                    {isRunningCalendarAi ? 'AI 解析中...' : calendarAiPendingRequest ? '送出補充資訊' : '讓 AI 幫我整理'}
                  </button>
                </div>

                {calendarAiPendingRequest && (
                  <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-700">
                    AI 正在等你補充上一題。請直接在上方輸入框回答，不需要刪掉前面的內容。
                  </div>
                )}

                {calendarAiVoiceError && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                    {calendarAiVoiceError}
                  </div>
                )}

                {calendarAiResult && (
                  <div className="mt-8 rounded-[2rem] border border-violet-100 bg-violet-50/60 p-6">
                    <p className="text-sm font-black text-violet-700 uppercase tracking-widest">AI 確認卡</p>
                    <p className="mt-3 text-lg font-black text-slate-800">{calendarAiResult.userFacingSummary}</p>

                    {calendarAiResult.needsClarification ? (
                      <div className="mt-5 rounded-2xl bg-white px-4 py-4 text-sm font-bold text-slate-600 border border-violet-100">
                        {calendarAiResult.clarificationQuestion || 'AI 還需要更多資訊才能繼續。'}
                      </div>
                    ) : (
                      <>
                        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm font-bold text-slate-600">
                          <div className="rounded-2xl bg-white px-4 py-4 border border-violet-100">
                            <p className="text-xs uppercase tracking-widest text-slate-400">動作</p>
                            <p className="mt-2 text-slate-800">{calendarAiResult.intent}</p>
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-4 border border-violet-100">
                            <p className="text-xs uppercase tracking-widest text-slate-400">標題</p>
                            <input
                              type="text"
                              value={calendarAiResult.eventDraft?.title || ''}
                              onChange={(e) => updateCalendarAiDraft({ title: e.target.value })}
                              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-4 border border-violet-100">
                            <p className="text-xs uppercase tracking-widest text-slate-400">開始日期</p>
                            <input
                              type="date"
                              value={calendarAiResult.eventDraft?.startDate || ''}
                              onChange={(e) => updateCalendarAiDraft({ startDate: e.target.value, endDate: calendarAiResult.eventDraft?.endDate || e.target.value })}
                              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                            />
                            {!calendarAiResult.eventDraft?.allDay && (
                              <input
                                type="time"
                                value={calendarAiResult.eventDraft?.startTime || ''}
                                onChange={(e) => updateCalendarAiDraft({ startTime: e.target.value })}
                                className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                              />
                            )}
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-4 border border-violet-100">
                            <p className="text-xs uppercase tracking-widest text-slate-400">結束時間與提醒</p>
                            {!calendarAiResult.eventDraft?.allDay && (
                              <input
                                type="time"
                                value={calendarAiResult.eventDraft?.endTime || ''}
                                onChange={(e) => updateCalendarAiDraft({ endTime: e.target.value })}
                                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                              />
                            )}
                            <select
                              value={
                                CALENDAR_REMINDER_PRESET_OPTIONS.includes(Number(calendarAiResult.eventDraft?.reminderMinutes ?? 30))
                                  ? String(Number(calendarAiResult.eventDraft?.reminderMinutes ?? 30))
                                  : 'custom'
                              }
                              onChange={(e) =>
                                updateCalendarAiDraft({
                                  reminderMinutes:
                                    e.target.value === 'custom'
                                      ? CALENDAR_REMINDER_PRESET_OPTIONS.includes(Number(calendarAiResult.eventDraft?.reminderMinutes ?? 30))
                                        ? 5
                                        : Number(calendarAiResult.eventDraft?.reminderMinutes ?? 5)
                                      : Number(e.target.value)
                                })
                              }
                              className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                            >
                              <option value={0}>開始時提醒</option>
                              <option value={10}>10 分鐘前</option>
                              <option value={30}>30 分鐘前</option>
                              <option value={60}>1 小時前</option>
                              <option value={1440}>1 天前</option>
                              <option value="custom">自訂</option>
                            </select>
                            {!CALENDAR_REMINDER_PRESET_OPTIONS.includes(Number(calendarAiResult.eventDraft?.reminderMinutes ?? 30)) && (
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={Number(calendarAiResult.eventDraft?.reminderMinutes ?? 5)}
                                onChange={(e) => updateCalendarAiDraft({ reminderMinutes: Math.max(0, Number(e.target.value) || 0) })}
                                className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                              />
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm font-bold text-slate-600">
                          <div className="rounded-2xl bg-white px-4 py-4 border border-violet-100">
                            <p className="text-xs uppercase tracking-widest text-slate-400">地點</p>
                            <input
                              type="text"
                              value={calendarAiResult.eventDraft?.location || ''}
                              onChange={(e) => updateCalendarAiDraft({ location: e.target.value })}
                              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-4 border border-violet-100">
                            <p className="text-xs uppercase tracking-widest text-slate-400">未完成時自動順延</p>
                            <label className="mt-3 inline-flex items-center gap-3 text-slate-800">
                              <input
                                type="checkbox"
                                checked={calendarAiResult.eventDraft?.autoRolloverEnabled === true}
                                onChange={(e) => updateCalendarAiDraft({ autoRolloverEnabled: e.target.checked })}
                              />
                              <span>今天沒完成，明天同時間再提醒我</span>
                            </label>
                          </div>
                        </div>

                        <div className="mt-4 rounded-2xl bg-white px-4 py-4 border border-violet-100">
                          <p className="text-xs uppercase tracking-widest text-slate-400">描述</p>
                          <textarea
                            value={calendarAiResult.eventDraft?.description || ''}
                            onChange={(e) => updateCalendarAiDraft({ description: e.target.value })}
                            rows={3}
                            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:border-violet-500 focus:outline-none"
                          />
                        </div>

                        {(calendarAiResult.intent === 'update' || calendarAiResult.intent === 'delete' || calendarAiResult.intent === 'query') && (
                          <div className="mt-5 space-y-3">
                            <p className="text-sm font-black text-slate-700">候選事件</p>
                            {calendarAiCandidates.length === 0 ? (
                              <div className="rounded-2xl bg-white px-4 py-4 text-sm font-bold text-slate-400 border border-violet-100">
                                尚未找到候選事件，請再描述得更具體一些。
                              </div>
                            ) : (
                              calendarAiCandidates.map((candidate) => (
                                <label key={candidate.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-4 border border-violet-100">
                                  <input
                                    type="radio"
                                    name="calendar-ai-candidate"
                                    checked={calendarAiSelectedEventId === candidate.id}
                                    onChange={() => setCalendarAiSelectedEventId(candidate.id)}
                                  />
                                  <div>
                                    <p className="text-sm font-black text-slate-800">{candidate.title || '未命名事件'}</p>
                                    <p className="text-xs font-semibold text-slate-400 mt-1">
                                      {candidate.startDate} {candidate.allDay ? '全天' : `${candidate.startTime || ''} - ${candidate.endTime || ''}`}
                                    </p>
                                  </div>
                                </label>
                              ))
                            )}
                          </div>
                        )}

                        <div className="mt-6 flex gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setCalendarAiInput('');
                              setCalendarAiResult(null);
                              setCalendarAiCandidates([]);
                              setCalendarAiSelectedEventId('');
                              setCalendarAiPendingRequest(null);
                            }}
                            className="flex-1 rounded-2xl bg-slate-100 py-4 text-sm font-black text-slate-500 transition hover:bg-slate-200"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmCalendarAi}
                            disabled={isRunningCalendarAi}
                            className="flex-1 rounded-2xl bg-violet-600 py-4 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
                          >
                            {isRunningCalendarAi ? '執行中...' : '確認交給 AI 執行'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {showMobileCalendarDayView && (
                <div className="fixed inset-0 z-[45] bg-[#f8fafc] xl:hidden overflow-y-auto">
                  <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowMobileCalendarDayView(false)}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"
                        aria-label="返回月曆"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-400">當日事件</p>
                        <h3 className="mt-1 text-xl font-black text-slate-800 break-words">
                          {formatCalendarDayLabel(selectedCalendarDate)}
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 px-4 py-5 pb-28">
                    <div className="rounded-[2rem] border border-slate-100 bg-white px-4 py-4 text-sm font-semibold text-slate-400 shadow-sm">
                      點事件可直接編輯或刪除，回上一頁會回到月曆。
                    </div>

                    {selectedCalendarDayEvents.length > 1 && (
                      <div className="rounded-[2rem] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-slate-600">
                            已選 {selectedCalendarConfirmIds.length} 筆
                          </p>
                          <button
                            type="button"
                            onClick={handleBulkConfirmCalendarEvents}
                            disabled={selectedCalendarConfirmIds.length === 0}
                            className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                          >
                            批次完成
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedCalendarDayEvents.length === 0 ? (
                      <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white px-5 py-12 text-center text-sm font-bold text-slate-400">
                        這一天目前沒有事件
                      </div>
                    ) : (
                      selectedCalendarDayEvents.map((event) => (
                        <div key={`mobile-page-${event.id}`} className="rounded-[2rem] border border-slate-100 bg-white px-4 py-5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {!event.isConfirmed && (
                                <label className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 border border-slate-200">
                                  <input
                                    type="checkbox"
                                    checked={selectedCalendarConfirmIds.includes(event.id)}
                                    onChange={(e) => toggleCalendarConfirmSelection(event.id, e.target.checked)}
                                  />
                                  <span>加入批次完成</span>
                                </label>
                              )}
                              <p className="text-lg font-black text-slate-800 break-words">{event.title}</p>
                              <p className="mt-2 text-sm font-bold text-violet-600">{formatCalendarEventTime(event)}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest border ${
                              event.isConfirmed
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}>
                              {event.isConfirmed ? '已完成' : '待完成'}
                            </span>
                          </div>
                          {event.location && (
                            <p className="mt-3 text-sm font-semibold text-slate-500 break-words">地點：{event.location}</p>
                          )}
                          {event.description && (
                            <p className="mt-2 text-sm font-semibold text-slate-500 whitespace-pre-wrap break-words">
                              {event.description}
                            </p>
                          )}
                          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black text-slate-400">
                            {event.autoRolloverEnabled && (
                              <span className="rounded-full bg-amber-50 px-3 py-1 border border-amber-200 text-amber-700">
                                未完成會順延
                              </span>
                            )}
                            {event.isConfirmed && (
                              <span className="rounded-full bg-emerald-50 px-3 py-1 border border-emerald-200 text-emerald-700">
                                已完成
                              </span>
                            )}
                          </div>
                          {event.isConfirmed && event.confirmedByName && (
                            <p className="mt-3 text-xs font-bold text-emerald-700">
                              已由 {event.confirmedByName} 完成
                            </p>
                          )}
                          <div className="mt-4 flex gap-3">
                            {!event.isConfirmed ? (
                              <button
                                type="button"
                                onClick={() => handleConfirmCalendarEvent(event.id)}
                                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
                              >
                                完成
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleUnconfirmCalendarEvent(event.id)}
                                className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-black text-amber-800 transition hover:bg-amber-200"
                              >
                                取消完成
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditCalendarEventModal(event.id)}
                              className="rounded-2xl bg-violet-50 px-4 py-3 text-sm font-black text-violet-700 border border-violet-100 transition hover:bg-violet-100"
                            >
                              編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCalendarEvent(event.id)}
                              className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-600 border border-rose-100 transition hover:bg-rose-100"
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {calendarConnection.connected && !editingCalendarEvent && !showMobileCalendarDayView && (
                <button
                  type="button"
                  onClick={() => openNewCalendarEventModal()}
                  className="fixed bottom-6 right-5 sm:bottom-8 sm:right-8 z-30 h-16 w-16 rounded-full bg-violet-600 text-white shadow-2xl shadow-violet-200 transition hover:bg-violet-700 active:scale-95"
                  aria-label="新增事件"
                >
                  <Plus className="mx-auto h-7 w-7" />
                </button>
              )}
            </div>
          ) : activeTab === 'FAMILY_CASH' ? (
            <div className="space-y-10">
              <div className="grid grid-cols-1 gap-6">
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-8 rounded-[2.5rem] text-white shadow-xl">
                  <p className="text-emerald-100 text-sm font-bold mb-2 uppercase tracking-widest">目前家庭現金</p>
                  <h4 className="text-4xl font-black">${Math.round(familyCashBalance).toLocaleString()}</h4>
                </div>
              </div>

              <form onSubmit={handleAddFamilyCashRecord} className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <h3 className="text-lg font-black mb-6 flex items-center gap-2 text-slate-800">
                  <PlusCircle className="text-emerald-500 w-6 h-6" />
                  新增家庭現金紀錄
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-5">
                  <div className="flex flex-col gap-2 lg:col-span-2">
                    <label className="text-xs font-black text-slate-400 uppercase ml-1">日期</label>
                    <input
                      type="date"
                      value={newFamilyCashDate}
                      onChange={(e) => setNewFamilyCashDate(e.target.value)}
                      className="w-full h-14 border-2 border-slate-100 rounded-2xl px-4 bg-slate-50 focus:border-emerald-500 focus:outline-none font-bold text-slate-700"
                    />
                  </div>
                  <div className="flex flex-col gap-2 lg:col-span-2">
                    <label className="text-xs font-black text-slate-400 uppercase ml-1">類型</label>
                    <select
                      value={newFamilyCashType}
                      onChange={(e) => setNewFamilyCashType(e.target.value as FamilyCashType)}
                      className="w-full h-14 border-2 border-slate-100 rounded-2xl px-4 bg-slate-50 focus:border-emerald-500 focus:outline-none font-bold text-slate-700"
                    >
                      <option value="DEPOSIT">存入</option>
                      <option value="WITHDRAW">取出</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2 lg:col-span-2">
                    <label className="text-xs font-black text-slate-400 uppercase ml-1">金額</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      value={newFamilyCashAmount}
                      onChange={(e) => setNewFamilyCashAmount(e.target.value)}
                      className="w-full h-14 border-2 border-slate-100 rounded-2xl px-4 bg-slate-50 focus:border-emerald-500 focus:outline-none font-bold text-slate-700"
                    />
                  </div>
                  <div className="lg:col-span-1 flex items-end">
                    <button
                      type="submit"
                      className="w-full h-14 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-700 transition shadow-lg shadow-emerald-100 active:scale-95"
                    >
                      新增
                    </button>
                  </div>
                </div>
              </form>

              <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100">
                <h3 className="text-xl font-black text-slate-800 mb-8">家庭現金流水</h3>
                <div className="space-y-4">
                  {familyCashRecordsDescending.length === 0 ? (
                    <div className="py-20 text-center text-slate-300 font-bold italic">尚無家庭現金紀錄</div>
                  ) : (
                    familyCashRecordsDescending.map((record) => {
                      const isDeposit = record.type === 'DEPOSIT';
                      return (
                        <div key={record.id} className="flex items-start gap-3 p-4 sm:p-6 hover:bg-slate-50 rounded-3xl transition group">
                          <div className={`p-3 sm:p-4 rounded-2xl -ml-3 sm:ml-0 shrink-0 ${isDeposit ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                            {isDeposit ? <ArrowUpCircle /> : <ArrowDownCircle />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="sm:hidden space-y-2.5">
                              <p className="font-black text-slate-800 text-lg leading-snug break-words">
                                {(record.actorName || '未知使用者') + ' ' + (isDeposit ? '存入' : '取出')}
                              </p>
                              <p className="text-xs text-slate-400 font-bold uppercase leading-relaxed break-words">
                                {record.date} • {isDeposit ? '存入' : '取出'} • 累計餘額 ${record.runningBalance.toLocaleString()}
                              </p>
                              {record.actorEmail && <p className="text-xs text-slate-300 font-bold break-all">{record.actorEmail}</p>}
                              <div className="flex items-center justify-between gap-3 pt-1">
                                <span className={`font-mono font-black text-2xl whitespace-nowrap ${isDeposit ? 'text-emerald-600' : 'text-amber-600'}`}>
                                  {isDeposit ? '+' : '-'}${record.amount.toLocaleString()}
                                </span>
                                <div className="flex gap-2 shrink-0">
                                  <button onClick={() => setEditingFamilyCashRecord(record)} className="p-2 text-slate-400 hover:text-emerald-600 bg-white rounded-xl shadow-sm border border-slate-100">
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (!window.confirm('確定要刪除這筆家庭現金紀錄嗎？此動作無法撤回。')) {
                                        return;
                                      }
                                      handleDeleteFamilyCashRecord(record.id);
                                    }}
                                    className="p-2 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="hidden sm:flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-black text-slate-800 text-lg leading-tight break-words">{(record.actorName || '未知使用者') + ' ' + (isDeposit ? '存入' : '取出')}</p>
                                <p className="text-xs text-slate-400 font-bold uppercase break-words">{record.date} • {isDeposit ? '存入' : '取出'}</p>
                                {record.actorEmail && <p className="mt-1 text-xs font-bold text-slate-300 break-all">{record.actorEmail}</p>}
                                <p className="mt-2 text-sm font-bold text-slate-500">累計餘額 ${record.runningBalance.toLocaleString()}</p>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
                                <span className={`font-mono font-black text-xl sm:text-2xl whitespace-nowrap ${isDeposit ? 'text-emerald-600' : 'text-amber-600'}`}>
                                  {isDeposit ? '+' : '-'}${record.amount.toLocaleString()}
                                </span>
                                <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                                  <button onClick={() => setEditingFamilyCashRecord(record)} className="p-2 text-slate-400 hover:text-emerald-600 bg-white rounded-xl shadow-sm border border-slate-100">
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (!window.confirm('確定要刪除這筆家庭現金紀錄嗎？此動作無法撤回。')) {
                                        return;
                                      }
                                      handleDeleteFamilyCashRecord(record.id);
                                    }}
                                    className="p-2 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            <InvestmentRecord 
              investments={investments} 
              prices={prices}
              childId={selectedChildId} 
              childName={activeChild.name} 
              availableBalance={balance} 
              usdTwdReferenceRate={settings.usdTwdReferenceRate}
              usdTwdReferenceUpdatedAt={settings.usdTwdReferenceUpdatedAt}
              onAdd={handleAddInvestment}
              onEdit={(inv) => setEditingInvestment(inv)}
              onDelete={handleDeleteInvestment}
              onRefreshPrices={handleManualPriceSync}
              isRefreshingPrices={isUpdatingPrices}
            />
          )}
        </div>
      </main>

      <div className={`fixed inset-0 z-[80] lg:hidden transition ${mobileMenuOpen ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-slate-900/40 transition-opacity ${mobileMenuOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileMenuOpen(false)}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-[82%] max-w-sm bg-white shadow-2xl border-l border-slate-200 p-6 flex flex-col transition-transform duration-300 ${mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="font-black text-xl text-slate-800">功能選單</span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"
              aria-label="關閉選單"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => {
                setActiveTab('DASHBOARD');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'DASHBOARD' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 bg-slate-50'}`}
            >
              <BarChart3 className="w-5 h-5" /> 帳務總覽
            </button>
            <button
              onClick={() => {
                setActiveTab('INVESTMENTS');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'INVESTMENTS' ? 'bg-orange-50 text-orange-600' : 'text-slate-500 bg-slate-50'}`}
            >
              <PiggyBank className="w-5 h-5" /> 股票投資
            </button>
            <button
              onClick={() => {
                setActiveTab('FAMILY_CASH');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'FAMILY_CASH' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-500 bg-slate-50'}`}
            >
              <Wallet className="w-5 h-5" /> 家庭現金
            </button>
            <button
              onClick={() => {
                setActiveTab('CALENDAR');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'CALENDAR' ? 'bg-violet-50 text-violet-600' : 'text-slate-500 bg-slate-50'}`}
            >
              <CalendarDays className="w-5 h-5" /> 家庭行事曆
            </button>
          </div>

          <div className="mt-auto space-y-3">
            <button
              onClick={async () => {
                await exportToExcel();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-emerald-600 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition"
            >
              <Download className="w-4 h-4" /> 匯出帳本 Excel
            </button>
            <button
              onClick={() => {
                setShowSettings(true);
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
            >
              <Settings className="w-4 h-4" /> 系統與小朋友設定
            </button>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-3 mb-3">
                <img src={user.picture} className="w-10 h-10 rounded-xl border-2 border-white shadow-sm" alt="User" />
                <div className="overflow-hidden">
                  <p className="text-sm font-black truncate text-slate-800">{user.name}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">管理者</p>
                </div>
              </div>
              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 text-xs text-rose-500 font-black hover:bg-rose-50 py-2.5 rounded-xl transition"
              >
                <LogOut className="w-4 h-4" /> 登出
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* 自定義刪除確認視窗 */}
      {childToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl p-10 max-w-sm w-full text-center space-y-6 animate-in zoom-in-95 duration-200">
            <div className="w-20 h-20 bg-rose-50 rounded-[2rem] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-10 h-10 text-rose-500" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-slate-800 mb-2">確定要刪除嗎？</h3>
              <p className="text-slate-500 font-medium">即將刪除小朋友「{childToDelete.name}」，此動作無法撤回。</p>
            </div>
            <div className="flex flex-col gap-3 pt-4">
              <button 
                onClick={confirmRemoveChild}
                className="w-full bg-rose-500 text-white font-black py-4 rounded-2xl hover:bg-rose-600 transition shadow-lg shadow-rose-100"
              >
                確定刪除
              </button>
              <button 
                onClick={() => setChildToDelete(null)}
                className="w-full bg-slate-100 text-slate-500 font-black py-4 rounded-2xl hover:bg-slate-200 transition"
              >
                先不要
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl p-10 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                <Settings className="text-blue-600" /> 系統與小朋友設定
              </h2>
              <button onClick={closeSettingsModal} className="p-2 hover:bg-slate-100 rounded-full transition">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            
            <div className="space-y-10">
              <section>
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-3">
                    <h3
                      className="text-sm font-black text-slate-400 uppercase tracking-widest select-none"
                      onClick={handleSecretTitleTap}
                    >
                      小朋友管理
                    </h3>
                    {adultManagerUnlocked && (
                      <button
                        type="button"
                        onClick={() => setAdultManagerEnabledWithStorage(!adultManagerEnabled)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${adultManagerEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                        aria-pressed={adultManagerEnabled}
                        aria-label="切換大人管理"
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${adultManagerEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    )}
                    {adultManagerUnlocked && (
                      <span className="text-xs font-black text-slate-400 uppercase tracking-wider">大人管理</span>
                    )}
                  </div>
                  {!isAddingChild && (
                    <button onClick={() => setIsAddingChild(true)} className="flex items-center gap-2 text-blue-600 font-black text-sm bg-blue-50 px-5 py-2.5 rounded-2xl hover:bg-blue-100 transition shadow-sm">
                      <UserPlus className="w-4 h-4" /> {adultManagerEnabled ? '新增大人' : '新增小朋友'}
                    </button>
                  )}
                </div>

                {isAddingChild && (
                  <div className="bg-blue-50/50 p-6 rounded-[2rem] border-2 border-dashed border-blue-200 mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center gap-5 mb-5">
                      <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center border-4 border-white">
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${newChildName || 'New'}`} className="w-16 h-16" alt="Preview" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-black text-blue-400 uppercase mb-2 ml-1">姓名</label>
                        <input autoFocus type="text" value={newChildName} onChange={(e) => setNewChildName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddChild()} placeholder={adultManagerEnabled ? '例如：爸爸' : '例如：小美'} className="w-full bg-white border-2 border-blue-100 rounded-2xl px-5 py-3 focus:border-blue-500 focus:outline-none font-bold text-slate-700" />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={handleAddChild} className="flex-1 bg-blue-600 text-white font-black py-4 rounded-2xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-100"><Plus className="w-5 h-5" /> {adultManagerEnabled ? '確定新增大人' : '確定新增小朋友'}</button>
                      <button onClick={() => { setIsAddingChild(false); setNewChildName(''); }} className="px-6 py-4 font-black text-slate-400 hover:text-slate-600 bg-white rounded-2xl">取消</button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {visibleChildren.map(child => (
                    <div key={child.id} className="flex items-center justify-between p-5 bg-slate-50 rounded-[1.5rem] border border-slate-100 group hover:border-blue-200 transition-all">
                      <div className="flex items-center gap-4">
                        <img src={child.avatar} className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100" alt={child.name} />
                        <div>
                          {editingChildId === child.id ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={editingChildName}
                                onChange={(e) => setEditingChildName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    saveChildName(child);
                                  }
                                  if (e.key === 'Escape') {
                                    cancelEditingChild();
                                  }
                                }}
                                className="w-full min-w-[140px] bg-white border-2 border-blue-100 rounded-xl px-3 py-2 text-sm font-black text-slate-700 focus:border-blue-500 focus:outline-none"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveChildName(child)}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-black hover:bg-blue-700 transition"
                                >
                                  儲存
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditingChild}
                                  className="px-3 py-1.5 rounded-lg bg-white text-slate-500 text-xs font-black border border-slate-200 hover:bg-slate-50 transition"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="font-black text-slate-700 text-lg">{child.name}</span>
                          )}
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                            {child.role === 'ADULT' ? '大人' : '小朋友'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEditingChild(child)}
                          className="p-3 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all relative z-10"
                          title="修改姓名"
                        >
                          <Pencil className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRefreshAvatar(child.id)}
                          className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all relative z-10"
                          title="更換頭像"
                        >
                          <RefreshCcw className="w-5 h-5" />
                        </button>
                        <button 
                          type="button"
                          onClick={() => setChildToDelete(child)} 
                          className="p-3 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all relative z-10"
                          title="刪除"
                        >
                          <UserMinus className="w-6 h-6" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">AI導師建議</h3>
                    <p className="text-xs text-slate-400 font-semibold mt-1">可控制首頁 AI 建議模組顯示與設定 API 連結</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings((prev) => ({ ...prev, aiMentorEnabled: !prev.aiMentorEnabled }))}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${settings.aiMentorEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                    aria-pressed={settings.aiMentorEnabled}
                    aria-label="切換 AI導師建議"
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${settings.aiMentorEnabled ? 'translate-x-7' : 'translate-x-1'}`}
                    />
                  </button>
                </div>

                {settings.aiMentorEnabled && (
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">AI API 連結</label>
                    <input
                      type="url"
                      value={settings.aiApiLink}
                      onChange={(e) => setSettings((prev) => ({ ...prev, aiApiLink: e.target.value }))}
                      placeholder="https://your-llm-endpoint.example.com/v1/chat/completions"
                      className="w-full bg-white border-2 border-slate-100 rounded-2xl p-4 text-sm focus:border-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                )}
              </section>

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 space-y-5">
                <div>
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Telegram 家庭提醒</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-400">
                    可將家庭活動建立通知與活動開始提醒發送到同一個 Telegram 群組。
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      Bot Token
                    </label>
                    <input
                      type="password"
                      value={telegramBotTokenInput}
                      onChange={(e) => setTelegramBotTokenInput(e.target.value)}
                      placeholder={settings.telegramBotTokenConfigured ? '已設定，如需更換請輸入新的 Bot Token' : '123456:ABC-DEF...'}
                      className="w-full rounded-2xl border-2 border-slate-100 bg-white p-4 text-sm font-bold focus:border-blue-500 focus:outline-none"
                    />
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      {settings.telegramBotTokenConfigured
                        ? '目前已儲存 Telegram Bot Token；留空可保留原本設定。'
                        : '第一次設定時，請貼上從 BotFather 取得的 Bot Token。'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      家庭群組 Chat ID
                    </label>
                    <input
                      type="text"
                      value={settings.telegramChatId}
                      onChange={(e) => setSettings((prev) => ({ ...prev, telegramChatId: e.target.value }))}
                      placeholder="-1001234567890"
                      className="w-full rounded-2xl border-2 border-slate-100 bg-white p-4 text-sm font-bold focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setSettings((prev) => ({ ...prev, telegramNotifyOnCreate: !prev.telegramNotifyOnCreate }))}
                    className={`rounded-[1.75rem] border px-5 py-4 text-left transition ${settings.telegramNotifyOnCreate ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}
                  >
                    <p className="text-sm font-black text-slate-800">活動異動時通知</p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      建立、修改、刪除家庭活動後，立即發一則 Telegram 訊息。
                    </p>
                    <p className={`mt-3 text-xs font-black uppercase tracking-widest ${settings.telegramNotifyOnCreate ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {settings.telegramNotifyOnCreate ? '已啟用' : '未啟用'}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSettings((prev) => ({ ...prev, telegramNotifyOnStart: !prev.telegramNotifyOnStart }))}
                    className={`rounded-[1.75rem] border px-5 py-4 text-left transition ${settings.telegramNotifyOnStart ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}
                  >
                    <p className="text-sm font-black text-slate-800">活動開始時提醒</p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      到活動開始時間後，會再發一則 Telegram 提醒。
                    </p>
                    <p className={`mt-3 text-xs font-black uppercase tracking-widest ${settings.telegramNotifyOnStart ? 'text-violet-600' : 'text-slate-300'}`}>
                      {settings.telegramNotifyOnStart ? '已啟用' : '未啟用'}
                    </p>
                  </button>
                </div>
              </section>

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">美股參考匯率</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      自動抓取 USD/TWD 作為美股台幣估值參考，新增美股時也會先帶入這個值，之後你仍可改成實際成交匯率。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshUsdTwdReferenceRate(true)}
                    disabled={isRefreshingFxReference}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCcw className={`h-4 w-4 ${isRefreshingFxReference ? 'animate-spin' : ''}`} />
                    立即更新
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-300">目前參考匯率</p>
                    <p className="mt-3 text-2xl font-black text-slate-800">
                      {settings.usdTwdReferenceRate > 0 ? settings.usdTwdReferenceRate.toFixed(3) : '-'}
                    </p>
                  </div>
                  <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-300">最後更新</p>
                    <p className="mt-3 text-sm font-black text-slate-700">
                      {settings.usdTwdReferenceUpdatedAt ? settings.usdTwdReferenceUpdatedAt.replace('T', ' ').slice(0, 16) : '尚未取得'}
                    </p>
                  </div>
                  <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-300">來源</p>
                    <p className="mt-3 text-sm font-black text-slate-700">
                      {settings.usdTwdReferenceSource || 'Frankfurter'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">閒置自動鎖定</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-400">
                    超過設定分鐘數未操作後，整個網站會自動鎖定並要求輸入解鎖密碼。
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800">目前這台裝置需要解鎖</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        只影響目前這個瀏覽器。關閉後，這台裝置未來登入 KidsLedger 將不再需要解鎖。
                      </p>
                      <p className={`mt-3 text-xs font-black uppercase tracking-widest ${currentDeviceRequiresAppUnlock ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {currentDeviceRequiresAppUnlock ? '維持解鎖保護' : '已記住此裝置'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCurrentDeviceAppLock(!currentDeviceRequiresAppUnlock)}
                      className={`flex h-9 w-16 shrink-0 items-center rounded-full px-1 transition ${currentDeviceRequiresAppUnlock ? 'justify-start bg-amber-500' : 'justify-end bg-emerald-500'}`}
                      aria-pressed={currentDeviceRequiresAppUnlock}
                      aria-label="切換目前裝置是否需要解鎖"
                    >
                      <span className="inline-block h-7 w-7 rounded-full bg-white shadow" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                    閒置分鐘數
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    step={1}
                    value={idleLockMinutesInput}
                    onChange={(e) => setIdleLockMinutesInput(e.target.value)}
                    onBlur={() => setIdleLockMinutesInput(String(normalizeIdleLockMinutes(idleLockMinutesInput)))}
                    className="w-full bg-white border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:border-blue-500 focus:outline-none transition-all"
                  />
                </div>
              </section>

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 space-y-5">
                <div>
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Passkey 解鎖</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-400">
                    可在支援的 iPhone 或瀏覽器上使用 Face ID、Touch ID 或裝置 Passkey 解鎖。
                  </p>
                </div>

                {!browserSupportsPasskeys && (
                  <p className="text-sm font-bold text-amber-600">
                    目前瀏覽器不支援 Passkey，請改用密碼解鎖。
                  </p>
                )}

                {passkeysError && (
                  <p className="text-sm font-bold text-rose-600">{passkeysError}</p>
                )}

                {appUnlockMethod === 'password' && browserSupportsPasskeys && (
                  <div className="rounded-[1.5rem] border border-blue-100 bg-white p-5 space-y-4">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                        新 Passkey 名稱
                      </label>
                      <input
                        type="text"
                        value={newPasskeyDeviceName}
                        onChange={(e) => setNewPasskeyDeviceName(e.target.value)}
                        placeholder="例如：Milo 的 iPhone"
                        className="w-full rounded-2xl border-2 border-slate-100 p-4 text-sm font-bold focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={registerPasskey}
                      disabled={isRegisteringPasskey}
                      className="w-full rounded-2xl bg-blue-600 py-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {isRegisteringPasskey ? '註冊中...' : '新增 Passkey'}
                    </button>
                    <p className="text-xs font-semibold text-slate-400">
                      只有已先用密碼解鎖的人，才可以新增 Passkey。
                    </p>
                  </div>
                )}

                {appUnlockMethod !== 'password' && (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white px-4 py-4 text-sm font-bold text-slate-500 space-y-3">
                    <p>若要新增 Passkey，請先使用密碼解鎖目前這個裝置。</p>
                    <button
                      type="button"
                      onClick={lockApp}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-black transition"
                    >
                      重新鎖定後改用密碼解鎖
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">已註冊裝置</p>
                    <span className="text-xs font-bold text-slate-400">
                      {isLoadingPasskeys ? '讀取中...' : `${passkeys.length} 個`}
                    </span>
                  </div>
                  {passkeys.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm font-bold text-slate-400">
                      尚未註冊任何 Passkey。
                    </div>
                  ) : (
                    passkeys.map((passkey) => (
                      <div key={passkey.id} className="rounded-2xl border border-slate-100 bg-white px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-black text-slate-700">{passkey.deviceName || '未命名裝置'}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-400">
                              {passkey.lastUsedAt ? `最近使用：${new Date(passkey.lastUsedAt).toLocaleString()}` : '尚未用於解鎖'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => deletePasskey(passkey)}
                            disabled={deletingPasskeyId === passkey.id}
                            className="shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingPasskeyId === passkey.id ? '移除中...' : '移除'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <button onClick={saveSettings} className="w-full bg-gray-900 text-white py-6 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-black transition-all">儲存所有設定</button>
            </div>
          </div>
        </div>
      )}

      {showHiddenKeyPrompt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl p-8 w-full max-w-md">
            <h3 className="text-xl font-black text-slate-800 mb-2">解鎖大人管理</h3>
            <p className="text-sm text-slate-500 font-bold mb-5">請輸入管理密碼以顯示大人管理開關</p>
            <input
              type="password"
              value={hiddenKeyInput}
              onChange={(e) => setHiddenKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyHiddenKey()}
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:border-blue-500 focus:outline-none"
              placeholder="請輸入密碼"
              autoFocus
            />
            {hiddenKeyError && <p className="mt-3 text-sm font-bold text-rose-600">{hiddenKeyError}</p>}
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowHiddenKeyPrompt(false);
                  setHiddenKeyInput('');
                  setHiddenKeyError(null);
                }}
                className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-500 font-black hover:bg-slate-200 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={verifyHiddenKey}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-black hover:bg-blue-700 transition"
              >
                驗證
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCalendarEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleSaveCalendarEvent} className="bg-white rounded-[3rem] shadow-2xl p-8 max-w-2xl w-full space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                <CalendarDays className="text-violet-600" /> {editingCalendarEventId ? '編輯行事曆事件' : '新增行事曆事件'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setEditingCalendarEvent(null);
                  setEditingCalendarEventId(null);
                }}
                className="p-2 rounded-full hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {calendarEventsError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
                {calendarEventsError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">標題</label>
                <input
                  type="text"
                  value={editingCalendarEvent.title}
                  onChange={(e) => setEditingCalendarEvent({ ...editingCalendarEvent, title: e.target.value })}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">開始日期</label>
                <input
                  type="date"
                  value={editingCalendarEvent.startDate}
                  onChange={(e) =>
                    setEditingCalendarEvent(
                      ensureCalendarDraftEndAfterStart(
                        editingCalendarEvent,
                        e.target.value,
                        editingCalendarEvent.startTime
                      )
                    )
                  }
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">結束日期</label>
                <input
                  type="date"
                  value={editingCalendarEvent.endDate}
                  onChange={(e) => setEditingCalendarEvent({ ...editingCalendarEvent, endDate: e.target.value })}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setEditingCalendarEvent({
                      ...editingCalendarEvent,
                      allDay: !editingCalendarEvent.allDay,
                      endDate:
                        !editingCalendarEvent.endDate || editingCalendarEvent.endDate < editingCalendarEvent.startDate
                          ? editingCalendarEvent.startDate
                          : editingCalendarEvent.endDate
                    })
                  }
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${editingCalendarEvent.allDay ? 'bg-violet-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${editingCalendarEvent.allDay ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm font-black text-slate-600">全天事件</span>
              </div>
              {!editingCalendarEvent.allDay && (
                <>
                  <div>
                    <label className="text-xs font-black text-slate-400 uppercase mb-2 block">開始時間</label>
                    <input
                      type="time"
                      value={editingCalendarEvent.startTime}
                      onChange={(e) =>
                        setEditingCalendarEvent(
                          ensureCalendarDraftEndAfterStart(
                            editingCalendarEvent,
                            editingCalendarEvent.startDate,
                            e.target.value
                          )
                        )
                      }
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-black text-slate-400 uppercase mb-2 block">結束時間</label>
                    <input
                      type="time"
                      value={editingCalendarEvent.endTime}
                      onChange={(e) => setEditingCalendarEvent({ ...editingCalendarEvent, endTime: e.target.value })}
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">地點</label>
                <input
                  type="text"
                  value={editingCalendarEvent.location}
                  onChange={(e) => setEditingCalendarEvent({ ...editingCalendarEvent, location: e.target.value })}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">提醒</label>
                <div className="space-y-3">
                  <select
                    value={editingCalendarReminderMode}
                    onChange={(e) =>
                      setEditingCalendarEvent({
                        ...editingCalendarEvent,
                        reminders: [
                          {
                            method: 'popup',
                            minutes:
                              e.target.value === 'custom'
                                ? editingCalendarReminderMode === 'custom'
                                  ? editingCalendarReminderMinutes
                                  : 5
                                : Number(e.target.value)
                          }
                        ]
                      })
                    }
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                  >
                    <option value={0}>開始時提醒</option>
                    <option value={10}>10 分鐘前</option>
                    <option value={30}>30 分鐘前</option>
                    <option value={60}>1 小時前</option>
                    <option value={1440}>1 天前</option>
                    <option value="custom">自訂</option>
                  </select>
                  {editingCalendarReminderMode === 'custom' && (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={editingCalendarReminderMinutes}
                      onChange={(e) =>
                        setEditingCalendarEvent({
                          ...editingCalendarEvent,
                          reminders: [{ method: 'popup', minutes: Math.max(0, Number(e.target.value) || 0) }]
                        })
                      }
                      placeholder="自訂分鐘數"
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none focus:border-violet-500"
                    />
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">描述</label>
                <textarea
                  value={editingCalendarEvent.description}
                  onChange={(e) => setEditingCalendarEvent({ ...editingCalendarEvent, description: e.target.value })}
                  rows={4}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-900 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="md:col-span-2 rounded-[2rem] border border-amber-100 bg-amber-50 px-5 py-4">
                <label className="inline-flex items-center gap-3 text-sm font-black text-slate-700">
                  <input
                    type="checkbox"
                    checked={editingCalendarEvent.autoRolloverEnabled === true}
                    onChange={(e) =>
                      setEditingCalendarEvent({
                        ...editingCalendarEvent,
                        autoRolloverEnabled: e.target.checked
                      })
                    }
                  />
                  <span>如果今天沒有按完成，午夜後自動順延到明天同一時間</span>
                </label>
                <p className="mt-2 text-xs font-bold text-amber-700">
                  建議只用在待辦型事件，例如買菜、繳費、採買，不建議用在預約型活動。
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => {
                  setEditingCalendarEvent(null);
                  setEditingCalendarEventId(null);
                }}
                className="flex-1 py-5 font-black text-slate-400"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSavingCalendarEvent}
                className="flex-1 bg-violet-600 text-white py-5 rounded-2xl font-black disabled:cursor-not-allowed disabled:bg-violet-300"
              >
                {isSavingCalendarEvent ? '儲存中...' : editingCalendarEventId ? '儲存變更' : '建立事件'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingFamilyCashRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleUpdateFamilyCashRecord} className="bg-white rounded-[3rem] shadow-2xl p-10 max-w-lg w-full space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Pencil className="text-emerald-600" /> 編輯家庭現金</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">類型</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditingFamilyCashRecord({ ...editingFamilyCashRecord, type: 'DEPOSIT' })} className={`flex-1 py-3 rounded-xl font-black ${editingFamilyCashRecord.type === 'DEPOSIT' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>存入</button>
                  <button type="button" onClick={() => setEditingFamilyCashRecord({ ...editingFamilyCashRecord, type: 'WITHDRAW' })} className={`flex-1 py-3 rounded-xl font-black ${editingFamilyCashRecord.type === 'WITHDRAW' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}`}>取出</button>
                </div>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">金額</label>
                <input type="number" min={0} step="0.01" value={editingFamilyCashRecord.amount || ''} onChange={e => setEditingFamilyCashRecord({ ...editingFamilyCashRecord, amount: e.target.value === '' ? 0 : Number(e.target.value) })} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">日期</label>
                <input type="date" value={editingFamilyCashRecord.date} onChange={e => setEditingFamilyCashRecord({ ...editingFamilyCashRecord, date: e.target.value })} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-4">
              <button type="button" onClick={() => setEditingFamilyCashRecord(null)} className="flex-1 py-5 font-black text-slate-400">取消</button>
              <button type="submit" className="flex-1 bg-gray-900 text-white py-5 rounded-2xl font-black">儲存修改</button>
            </div>
          </form>
        </div>
      )}

      {editingTransaction && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleUpdateTransaction} className="bg-white rounded-[3rem] shadow-2xl p-10 max-w-lg w-full space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Pencil className="text-blue-600" /> 編輯帳目</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">收支類型</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditingTransaction({...editingTransaction, type: TransactionType.INCOME})} className={`flex-1 py-3 rounded-xl font-black ${editingTransaction.type === TransactionType.INCOME ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>💰 收入</button>
                  <button type="button" onClick={() => setEditingTransaction({...editingTransaction, type: TransactionType.EXPENSE})} className={`flex-1 py-3 rounded-xl font-black ${editingTransaction.type === TransactionType.EXPENSE ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'}`}>💸 支出</button>
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">項目名稱</label>
                <input type="text" value={editingTransaction.description} onChange={e => setEditingTransaction({...editingTransaction, description: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">金額</label>
                <input type="number" value={editingTransaction.amount || ''} onChange={e => setEditingTransaction({...editingTransaction, amount: e.target.value === '' ? 0 : Number(e.target.value)})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">日期</label>
                <input type="date" value={editingTransaction.date} onChange={e => setEditingTransaction({...editingTransaction, date: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-4">
              <button type="button" onClick={() => setEditingTransaction(null)} className="flex-1 py-5 font-black text-slate-400">取消</button>
              <button type="submit" className="flex-1 bg-gray-900 text-white py-5 rounded-2xl font-black">儲存修改</button>
            </div>
          </form>
        </div>
      )}

      {editingInvestment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleUpdateInvestment} className="bg-white rounded-[3rem] shadow-2xl p-10 max-w-2xl w-full space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Pencil className="text-orange-600" /> 編輯成交紀錄</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">市場</label>
                <select value={editingInvestment.market} onChange={e => {
                  const market = e.target.value as 'TW' | 'US';
                  const tradeCurrency = market === 'US' ? 'USD' : 'TWD';
                  const fxRateToTwd = market === 'US'
                    ? Number(editingInvestment.fxRateToTwd || 0)
                    : 1;
                  const totalAmount = calculateTradeTotal({
                    market,
                    quantity: editingInvestment.quantity,
                    price: editingInvestment.price,
                    action: editingInvestment.action,
                    feeAmount: Number(editingInvestment.feeAmount || 0),
                    broker: market === 'US' ? DEFAULT_US_BROKER : '',
                    orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
                  });
                  setEditingInvestment({
                    ...editingInvestment,
                    market,
                    broker: market === 'US' ? DEFAULT_US_BROKER : '',
                    orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC',
                    tradeCurrency,
                    settlementCurrency: 'TWD',
                    feeCurrency: tradeCurrency,
                    fxRateToTwd,
                    totalAmount,
                    netAmountTwd: calculateNetAmountTwd({ market, totalAmount, fxRateToTwd })
                  });
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none">
                  <option value="TW">台股</option>
                  <option value="US">美股</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">代碼</label>
                <input type="text" value={editingInvestment.symbol} onChange={e => setEditingInvestment({...editingInvestment, symbol: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">動作</label>
                <select value={editingInvestment.action} onChange={e => {
                  const action = e.target.value as 'BUY' | 'SELL';
                  const totalAmount = calculateTradeTotal({
                    market: editingInvestment.market,
                    quantity: editingInvestment.quantity,
                    price: editingInvestment.price,
                    action,
                    feeAmount: Number(editingInvestment.feeAmount || 0),
                    broker: editingInvestment.market === 'US' ? DEFAULT_US_BROKER : '',
                    orderChannel: editingInvestment.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
                  });
                  setEditingInvestment({
                    ...editingInvestment,
                    action,
                    totalAmount,
                    netAmountTwd: calculateNetAmountTwd({
                      market: editingInvestment.market,
                      totalAmount,
                      fxRateToTwd: editingInvestment.market === 'US' ? editingInvestment.fxRateToTwd : 1
                    })
                  });
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none">
                  <option value="BUY">買入</option>
                  <option value="SELL">賣出</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">股數</label>
                <input type="number" value={editingInvestment.quantity} onChange={e => {
                  const q = Number(e.target.value);
                  const totalAmount = calculateTradeTotal({
                    market: editingInvestment.market,
                    quantity: q,
                    price: editingInvestment.price,
                    action: editingInvestment.action,
                    feeAmount: Number(editingInvestment.feeAmount || 0),
                    broker: editingInvestment.market === 'US' ? DEFAULT_US_BROKER : '',
                    orderChannel: editingInvestment.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
                  });
                  setEditingInvestment({
                    ...editingInvestment,
                    quantity: q,
                    totalAmount,
                    netAmountTwd: calculateNetAmountTwd({
                      market: editingInvestment.market,
                      totalAmount,
                      fxRateToTwd: editingInvestment.market === 'US' ? editingInvestment.fxRateToTwd : 1
                    })
                  });
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">單價</label>
                <input type="number" value={editingInvestment.price} onChange={e => {
                  const p = Number(e.target.value);
                  const totalAmount = calculateTradeTotal({
                    market: editingInvestment.market,
                    quantity: editingInvestment.quantity,
                    price: p,
                    action: editingInvestment.action,
                    feeAmount: Number(editingInvestment.feeAmount || 0),
                    broker: editingInvestment.market === 'US' ? DEFAULT_US_BROKER : '',
                    orderChannel: editingInvestment.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
                  });
                  setEditingInvestment({
                    ...editingInvestment,
                    price: p,
                    totalAmount,
                    netAmountTwd: calculateNetAmountTwd({
                      market: editingInvestment.market,
                      totalAmount,
                      fxRateToTwd: editingInvestment.market === 'US' ? editingInvestment.fxRateToTwd : 1
                    })
                  });
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">手續費</label>
                <input type="number" value={editingInvestment.feeAmount || 0} onChange={e => {
                  const feeAmount = Number(e.target.value);
                  const totalAmount = calculateTradeTotal({
                    market: editingInvestment.market,
                    quantity: editingInvestment.quantity,
                    price: editingInvestment.price,
                    action: editingInvestment.action,
                    feeAmount,
                    broker: editingInvestment.market === 'US' ? DEFAULT_US_BROKER : '',
                    orderChannel: editingInvestment.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
                  });
                  setEditingInvestment({
                    ...editingInvestment,
                    feeAmount,
                    totalAmount,
                    netAmountTwd: calculateNetAmountTwd({
                      market: editingInvestment.market,
                      totalAmount,
                      fxRateToTwd: editingInvestment.market === 'US' ? editingInvestment.fxRateToTwd : 1
                    })
                  });
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              {editingInvestment.market === 'US' && (
                <div>
                  <label className="text-xs font-black text-slate-400 uppercase mb-2 block">匯率</label>
                  <input type="number" step="0.001" value={editingInvestment.fxRateToTwd || 0} onChange={e => {
                    const fxRateToTwd = Number(e.target.value);
                    setEditingInvestment({
                      ...editingInvestment,
                      fxRateToTwd,
                      netAmountTwd: calculateNetAmountTwd({
                        market: editingInvestment.market,
                        totalAmount: editingInvestment.totalAmount,
                        fxRateToTwd
                      })
                    });
                  }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
                </div>
              )}
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">成交總額 (含手續費)</label>
                <input type="number" value={editingInvestment.totalAmount} onChange={e => {
                  const totalAmount = Number(e.target.value);
                  setEditingInvestment({
                    ...editingInvestment,
                    totalAmount,
                    netAmountTwd: calculateNetAmountTwd({
                      market: editingInvestment.market,
                      totalAmount,
                      fxRateToTwd: editingInvestment.market === 'US' ? editingInvestment.fxRateToTwd : 1
                    })
                  });
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">台幣成本 / 入帳</label>
                <input type="number" value={editingInvestment.netAmountTwd || 0} onChange={e => setEditingInvestment({...editingInvestment, netAmountTwd: Number(e.target.value)})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">日期</label>
                <input type="date" value={editingInvestment.date} onChange={e => setEditingInvestment({...editingInvestment, date: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-4">
              <button type="button" onClick={() => setEditingInvestment(null)} className="flex-1 py-5 font-black text-slate-400">取消</button>
              <button type="submit" className="flex-1 bg-gray-900 text-white py-5 rounded-2xl font-black">儲存修改</button>
            </div>
          </form>
        </div>
      )}

      {isAppLocked && user && (
        <AppLockOverlay
          password={appLockPassword}
          error={appLockError}
          idleLockMinutes={normalizeIdleLockMinutes(settings.idleLockMinutes)}
          isPasswordSubmitting={isUnlockingApp}
          isPasskeySubmitting={isUnlockingWithPasskey}
          canUsePasskey={browserSupportsPasskeys}
          hasRegisteredPasskey={passkeys.length > 0}
          onPasswordChange={setAppLockPassword}
          onPasswordSubmit={verifyAppLockPassword}
          onPasskeySubmit={unlockWithPasskey}
        />
      )}
    </div>
  );
};

export default App;
