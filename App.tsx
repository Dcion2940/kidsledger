import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Transaction, Investment, Child, UserProfile, TransactionType, AppSettings, Price } from './types';
import TransactionForm from './components/TransactionForm';
import InvestmentRecord from './components/InvestmentRecord';
import { getFinancialAdvice } from './services/geminiService';
import { GoogleSheetsService } from './services/googleSheetsService';
import { storageManager } from './utils/storage';
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
  AlertTriangle,
  Menu,
  RefreshCcw
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
const BUY_FEE_RATE = 0.001425;
const SELL_FEE_RATE = 0.004425;

const calculateInvestmentTotal = (quantity: number, price: number, action: 'BUY' | 'SELL') => {
  if (quantity <= 0 || price <= 0) return 0;
  const grossAmount = quantity * price;
  const fee = grossAmount * (action === 'BUY' ? BUY_FEE_RATE : SELL_FEE_RATE);
  const total = action === 'BUY' ? grossAmount + fee : grossAmount - fee;
  return Number(total.toFixed(2));
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
    return JSON.parse(localStorage.getItem('prices') || '[]');
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
    return JSON.parse(localStorage.getItem('investments') || '[]');
  } catch {
    return [];
  }
};

declare global {
  interface Window {
    google?: any;
  }
}

const App: React.FC = () => {
  const envGoogleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const [localGoogleClientId, setLocalGoogleClientId] = useState<string>(() => localStorage.getItem('google_client_id') || '');
  const [clientIdInput, setClientIdInput] = useState<string>(() => localStorage.getItem('google_client_id') || '');
  const googleClientId = envGoogleClientId || localGoogleClientId;
  const [user, setUser] = useState<UserProfile | null>(() => getSavedUser());
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('DASHBOARD');
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(storageManager.getSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
  const [childToDelete, setChildToDelete] = useState<Child | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const [newChildName, setNewChildName] = useState('');
  const [isAddingChild, setIsAddingChild] = useState(false);
  const [adultManagerUnlocked, setAdultManagerUnlocked] = useState(false);
  const [adultManagerEnabled, setAdultManagerEnabled] = useState<boolean>(() => storageManager.getAdultManagerEnabled());
  const [showHiddenKeyPrompt, setShowHiddenKeyPrompt] = useState(false);
  const [hiddenKeyInput, setHiddenKeyInput] = useState('');
  const [hiddenKeyError, setHiddenKeyError] = useState<string | null>(null);
  const [hiddenTapCount, setHiddenTapCount] = useState(0);
  const [hiddenTapAt, setHiddenTapAt] = useState(0);
  const [avatarChangeArmed, setAvatarChangeArmed] = useState(false);
  const tokenClientRef = useRef<any>(null);
  const isSilentAuthRef = useRef(false);
  const pendingTokenRequestRef = useRef<{ resolve: (accessToken: string) => void; reject: (error: Error) => void } | null>(null);
  const refreshTokenPromiseRef = useRef<Promise<string> | null>(null);

  const sheetsService = useMemo(() => {
    if (user && settings.googleSheetId) {
      return new GoogleSheetsService(user.accessToken, settings.googleSheetId);
    }
    return null;
  }, [user, settings.googleSheetId]);

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
        .map((item: any) => ({
          symbol: String(item?.symbol || '').toUpperCase(),
          companyName: String(item?.companyName || ''),
          price: Number(item?.price || 0),
          updatedAt: String(item?.updatedAt || '')
        }))
        .filter((item: Price) => item.symbol);

      localStorage.setItem('prices', JSON.stringify(normalized));
      return normalized;
    } catch (error) {
      console.warn('Unable to load D1 prices, fallback to local cache.', error);
      return getSavedPrices();
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
      localStorage.setItem('transactions', JSON.stringify(d1Transactions));

      if (!sheetsService) {
        return d1Transactions;
      }

      try {
        const sheetTransactions = (await sheetsService.getTransactions()).filter((item) => item.id);
        const merged = new Map<string, Transaction>();
        d1Transactions.forEach((item) => merged.set(item.id, item));
        sheetTransactions.forEach((item) => {
          if (!merged.has(item.id)) {
            merged.set(item.id, item);
          }
        });
        const mergedList = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        localStorage.setItem('transactions', JSON.stringify(mergedList));
        return mergedList;
      } catch (sheetError) {
        console.warn('Unable to merge Google Sheet transactions, use D1 only.', sheetError);
        return d1Transactions;
      }
    } catch (error) {
      console.warn('Unable to load D1 transactions, fallback to local cache.', error);
      return getSavedTransactions();
    }
  };

  const loadInvestmentsFromApi = async (): Promise<Investment[]> => {
    const normalize = (items: any[]) =>
      items
        .map((item: any) => ({
          id: String(item?.id || ''),
          childId: String(item?.childId || ''),
          date: String(item?.date || ''),
          symbol: String(item?.symbol || '').toUpperCase(),
          companyName: String(item?.companyName || ''),
          quantity: Number(item?.quantity || 0),
          price: Number(item?.price || 0),
          totalAmount: Number(item?.totalAmount || 0),
          action: String(item?.action || '') as 'BUY' | 'SELL',
          sellStrategy: String(item?.sellStrategy || '') || undefined,
          sellAllocations: String(item?.sellAllocations || '') || undefined
        }))
        .filter((item: Investment) => item.id);

    try {
      const response = await fetch('/api/investments');
      if (!response.ok) {
        throw new Error(`Investments API ${response.status}`);
      }

      const data = await response.json();
      const d1Investments = normalize(Array.isArray(data?.investments) ? data.investments : []);
      localStorage.setItem('investments', JSON.stringify(d1Investments));

      if (!sheetsService) {
        return d1Investments;
      }

      try {
        const sheetInvestments = (await sheetsService.getInvestments()).filter((item) => item.id);
        const merged = new Map<string, Investment>();
        d1Investments.forEach((item) => merged.set(item.id, item));
        sheetInvestments.forEach((item) => {
          if (!merged.has(item.id)) {
            merged.set(item.id, item);
          }
        });
        const mergedList = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        localStorage.setItem('investments', JSON.stringify(mergedList));
        return mergedList;
      } catch (sheetError) {
        console.warn('Unable to merge Google Sheet investments, use D1 only.', sheetError);
        return d1Investments;
      }
    } catch (error) {
      console.warn('Unable to load D1 investments, fallback to local cache.', error);
      return getSavedInvestments();
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

  const deleteTransactionInD1 = async (id: string) => {
    const response = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Transactions API ${response.status}`);
    }
  };

  const ensurePriceInD1 = async (price: Pick<Price, 'symbol' | 'companyName'>) => {
    try {
      const response = await fetch('/api/prices/ensure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: price.symbol,
          companyName: price.companyName || ''
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

  const isGoogleAuthError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return /401|invalid credentials|invalid authentication credentials|unauthenticated|login required/i.test(message);
  };

  const runSheetSync = async (operation: (service: GoogleSheetsService) => Promise<void>) => {
    if (!sheetsService) return;

    setSyncStatus('syncing');
    try {
      let activeService = sheetsService;
      const shouldRefreshBeforeSync = !user?.expiresAt || user.expiresAt < Date.now() + 60_000;
      if (shouldRefreshBeforeSync) {
        const refreshedAccessToken = await refreshGoogleAccessToken('');
        activeService = new GoogleSheetsService(refreshedAccessToken, settings.googleSheetId);
      }

      await operation(activeService);
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      if (isGoogleAuthError(error)) {
        try {
          const refreshedAccessToken = await refreshGoogleAccessToken('');
          const refreshedService = new GoogleSheetsService(refreshedAccessToken, settings.googleSheetId);
          await operation(refreshedService);
          setSyncStatus('success');
          setSyncError(null);
          return;
        } catch (retryError) {
          console.error('Google Sheets auth retry error:', retryError);
          setSyncStatus('error');
          setSyncError(retryError instanceof Error ? retryError.message : 'Google Sheets 同步失敗，請重新登入 Google');
          return;
        }
      }

      console.error('Google Sheets sync error:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : 'Google Sheets 同步失敗');
    }
  };

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

  useEffect(() => {
    const fetchData = async () => {
      if (sheetsService) {
        setSyncStatus('syncing');
        try {
          const [loadedChildren, ts, invs, loadedPrices] = await Promise.all([
            sheetsService.getChildren(),
            loadTransactionsFromApi(),
            loadInvestmentsFromApi(),
            loadPricesFromApi()
          ]);
          
          const finalChildren = (loadedChildren.length > 0 ? loadedChildren : DEFAULT_CHILDREN).map(normalizeChild);
          setChildren(finalChildren);
          setSelectedChildId(prevId => {
            if (finalChildren.some(c => c.id === prevId)) return prevId;
            return finalChildren[0]?.id || '';
          });
          setTransactions(ts.filter(t => t.id)); 
          setInvestments(invs.filter(i => i.id));
          setPrices(loadedPrices.filter((p) => p.symbol));
          localStorage.setItem('prices', JSON.stringify(loadedPrices.filter((p) => p.symbol)));
          setSyncStatus('success');
          setSyncError(null);
        } catch (e) {
          console.error("Fetch Error:", e);
          setSyncStatus('error');
          setSyncError(e instanceof Error ? e.message : '無法讀取 Google Sheet');
          const localChildren = JSON.parse(localStorage.getItem('children_list') || '[]');
          const final = (localChildren.length > 0 ? localChildren : DEFAULT_CHILDREN).map((child: Child) => normalizeChild(child));
          setChildren(final);
          setSelectedChildId(final[0]?.id || '');
          setTransactions(getSavedTransactions());
          setInvestments(getSavedInvestments());
          setPrices(getSavedPrices());
        }
      } else {
        const localChildren = JSON.parse(localStorage.getItem('children_list') || '[]');
        const finalChildren = (localChildren.length > 0 ? localChildren : DEFAULT_CHILDREN).map((child: Child) => normalizeChild(child));
        setChildren(finalChildren);
        setSelectedChildId(finalChildren[0]?.id || '');
        setTransactions(await loadTransactionsFromApi());
        setInvestments(await loadInvestmentsFromApi());
        const loadedPrices = await loadPricesFromApi();
        setPrices(loadedPrices);
        setSyncStatus('idle');
        setSyncError(null);
      }
    };
    fetchData();
  }, [sheetsService]);

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
      setAuthError('尚未設定 Google Client ID（VITE_GOOGLE_CLIENT_ID）');
      return;
    }

    let cancelled = false;

    const initGoogleTokenClient = () => {
      if (cancelled) return true;
      if (!window.google?.accounts?.oauth2) return false;

      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
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
      setAuthError('尚未設定 Google Client ID（VITE_GOOGLE_CLIENT_ID）');
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

  const handleSaveLocalClientId = () => {
    const value = clientIdInput.trim();
    if (!value) {
      setAuthError('請先輸入 Google Client ID');
      return;
    }

    localStorage.setItem('google_client_id', value);
    setLocalGoogleClientId(value);
    setAuthError(null);
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
  };

  const saveSettings = () => {
    const newSettings = {
      ...settings,
      googleSheetId: settings.googleSheetId.trim(),
      aiApiLink: settings.aiApiLink.trim()
    };
    setSettings(newSettings);
    storageManager.saveSettings(newSettings);
    closeSettingsModal();
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
    
    await runSheetSync((service) => service.syncChildren(updated));
    
    if (!selectedChildId) setSelectedChildId(newChild.id);
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
    if (sheetsService) {
      await runSheetSync((service) => service.syncChildren(updated));
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
    
    if (sheetsService) {
      await runSheetSync((service) => service.syncChildren(updated));
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
    const shouldCreatePrice =
      inv.action === 'BUY' &&
      normalizedSymbol &&
      !prices.some((price) => price.symbol.toUpperCase() === normalizedSymbol);

    setInvestments(candidate);
    localStorage.setItem('investments', JSON.stringify(candidate));

    if (shouldCreatePrice) {
      const newPrice: Price = {
        symbol: normalizedSymbol,
        companyName: inv.companyName || normalizedSymbol,
        price: 0,
        updatedAt: ''
      };
      const updatedPrices = [...prices, newPrice];
      setPrices(updatedPrices);
      localStorage.setItem('prices', JSON.stringify(updatedPrices));
      await ensurePriceInD1({
        symbol: normalizedSymbol,
        companyName: inv.companyName || normalizedSymbol
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
  const investedInMarket = Array.from(
    childInvestments
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .reduce((grouped, investment) => {
        const symbol = investment.symbol.toUpperCase();
        const current = grouped.get(symbol) || { shares: 0, costBasis: 0 };

        if (investment.action === 'BUY') {
          current.shares += investment.quantity;
          current.costBasis += investment.totalAmount;
        } else if (current.shares > 0 && investment.quantity > 0) {
          const averageCost = current.costBasis / current.shares;
          const soldCost = averageCost * investment.quantity;
          current.shares = Math.max(0, current.shares - investment.quantity);
          current.costBasis = Math.max(0, current.costBasis - soldCost);
        }

        if (current.shares <= 0) {
          current.shares = 0;
          current.costBasis = 0;
        }

        grouped.set(symbol, current);
        return grouped;
      }, new Map<string, { shares: number; costBasis: number }>())
      .values()
  ).reduce((sum, holding) => sum + Math.round(holding.costBasis), 0);

  const stats = {
    income: childTransactions.filter(t => t.type === TransactionType.INCOME).reduce((s, t) => s + t.amount, 0),
    expense: childTransactions.filter(t => t.type === TransactionType.EXPENSE).reduce((s, t) => s + t.amount, 0),
    investment: 
      childTransactions.filter(t => t.type === TransactionType.INVESTMENT).reduce((s, t) => s + t.amount, 0) +
      childInvestments.reduce((s, i) => i.action === 'BUY' ? s + i.totalAmount : s - i.totalAmount, 0),
  };
  const balance = stats.income - stats.expense - stats.investment;
  const assetDistributionData = [
    { name: '可用餘額', value: Math.max(Math.round(balance), 0), color: '#10b981' },
    { name: '股市中資金', value: Math.max(Math.round(investedInMarket), 0), color: '#f59e0b' }
  ];
  const assetDistributionTotal = assetDistributionData.reduce((sum, item) => sum + item.value, 0);

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
          {!envGoogleClientId && (
            <div className="mt-6 text-left bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <p className="text-xs font-bold text-slate-500 mb-2">未設定網站預設 Client ID，可在此輸入你的 Google OAuth Web Client ID：</p>
              <input
                type="text"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleSaveLocalClientId}
                className="mt-3 w-full bg-blue-600 text-white py-2 rounded-xl font-bold hover:bg-blue-700 transition"
              >
                儲存 Client ID（僅此瀏覽器）
              </button>
            </div>
          )}
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
        </nav>

        <div className="p-6 mt-auto space-y-4 pb-8">
          <button onClick={exportToExcel} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-emerald-600 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition w-full">
            <Download className="w-4 h-4" /> 匯出 Google Sheet 樣板
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
            Google Sheet 同步失敗：{syncError}
          </div>
        )}

        <div className="w-full px-6 md:px-10 py-10 pb-32 overflow-x-hidden">
          {activeTab === 'DASHBOARD' ? (
            <div className="space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">股市中資金</p>
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

                <div className="lg:col-span-3 bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 h-fit">
                  <h3 className="text-xl font-black text-slate-800 mb-8 uppercase tracking-widest text-center">資產分佈</h3>
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
          ) : (
            <InvestmentRecord 
              investments={investments} 
              prices={prices}
              childId={selectedChildId} 
              childName={activeChild.name} 
              availableBalance={balance} 
              onAdd={handleAddInvestment}
              onEdit={(inv) => setEditingInvestment(inv)}
              onDelete={handleDeleteInvestment}
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
          </div>

          <div className="mt-auto space-y-3">
            <button
              onClick={async () => {
                await exportToExcel();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-emerald-600 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition"
            >
              <Download className="w-4 h-4" /> 匯出 Google Sheet 樣板
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
                          <span className="font-black text-slate-700 text-lg">{child.name}</span>
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                            {child.role === 'ADULT' ? '大人' : '小朋友'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
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

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-5">雲端設定</h3>
                <input
                  type="text"
                  value={settings.googleSheetId}
                  onChange={(e) => setSettings((prev) => ({ ...prev, googleSheetId: e.target.value }))}
                  placeholder="貼上您的試算表 ID"
                  className="w-full bg-white border-2 border-slate-100 rounded-2xl p-4 font-mono text-sm focus:border-blue-500 focus:outline-none transition-all"
                />
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
          <form onSubmit={handleUpdateInvestment} className="bg-white rounded-[3rem] shadow-2xl p-10 max-w-lg w-full space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Pencil className="text-orange-600" /> 編輯成交紀錄</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">代碼</label>
                <input type="text" value={editingInvestment.symbol} onChange={e => setEditingInvestment({...editingInvestment, symbol: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">動作</label>
                <select value={editingInvestment.action} onChange={e => {
                  const action = e.target.value as 'BUY' | 'SELL';
                  setEditingInvestment({
                    ...editingInvestment,
                    action,
                    totalAmount: calculateInvestmentTotal(editingInvestment.quantity, editingInvestment.price, action)
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
                  setEditingInvestment({...editingInvestment, quantity: q, totalAmount: calculateInvestmentTotal(q, editingInvestment.price, editingInvestment.action)});
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">單價</label>
                <input type="number" value={editingInvestment.price} onChange={e => {
                  const p = Number(e.target.value);
                  setEditingInvestment({...editingInvestment, price: p, totalAmount: calculateInvestmentTotal(editingInvestment.quantity, p, editingInvestment.action)});
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">成交總額 (含手續費)</label>
                <input type="number" value={editingInvestment.totalAmount} onChange={e => setEditingInvestment({...editingInvestment, totalAmount: Number(e.target.value)})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
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
    </div>
  );
};

export default App;
