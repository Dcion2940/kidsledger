import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Transaction, Investment, Child, UserProfile, TransactionType, AppSettings } from './types';
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
  AlertTriangle
} from 'lucide-react';
import { 
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

const DEFAULT_CHILDREN: Child[] = [
  { id: '1', name: '小明', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ming' }
];

const USER_STORAGE_KEY = 'kidsledger_user';

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
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(storageManager.getSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
  const [childToDelete, setChildToDelete] = useState<Child | null>(null);
  
  const [newChildName, setNewChildName] = useState('');
  const [isAddingChild, setIsAddingChild] = useState(false);
  const tokenClientRef = useRef<any>(null);
  const isSilentAuthRef = useRef(false);

  const sheetsService = useMemo(() => {
    if (user && settings.googleSheetId) {
      return new GoogleSheetsService(user.accessToken, settings.googleSheetId);
    }
    return null;
  }, [user, settings.googleSheetId]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [user]);

  const runSheetSync = async (operation: () => Promise<void>) => {
    if (!sheetsService) return;

    setSyncStatus('syncing');
    try {
      await operation();
      setSyncStatus('success');
      setSyncError(null);
    } catch (error) {
      console.error('Google Sheets sync error:', error);
      setSyncStatus('error');
      setSyncError(error instanceof Error ? error.message : 'Google Sheets 同步失敗');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (sheetsService) {
        setSyncStatus('syncing');
        try {
          const [loadedChildren, ts, invs] = await Promise.all([
            sheetsService.getChildren(),
            sheetsService.getTransactions(),
            sheetsService.getInvestments()
          ]);
          
          const finalChildren = loadedChildren.length > 0 ? loadedChildren : DEFAULT_CHILDREN;
          setChildren(finalChildren);
          setSelectedChildId(prevId => {
            if (finalChildren.some(c => c.id === prevId)) return prevId;
            return finalChildren[0]?.id || '';
          });
          setTransactions(ts.filter(t => t.id)); 
          setInvestments(invs.filter(i => i.id));
          setSyncStatus('success');
          setSyncError(null);
        } catch (e) {
          console.error("Fetch Error:", e);
          setSyncStatus('error');
          setSyncError(e instanceof Error ? e.message : '無法讀取 Google Sheet');
          const localChildren = JSON.parse(localStorage.getItem('children_list') || '[]');
          const final = localChildren.length > 0 ? localChildren : DEFAULT_CHILDREN;
          setChildren(final);
          setSelectedChildId(final[0]?.id || '');
          setTransactions(JSON.parse(localStorage.getItem('transactions') || '[]'));
          setInvestments(JSON.parse(localStorage.getItem('investments') || '[]'));
        }
      } else {
        const localChildren = JSON.parse(localStorage.getItem('children_list') || '[]');
        const finalChildren = localChildren.length > 0 ? localChildren : DEFAULT_CHILDREN;
        setChildren(finalChildren);
        setSelectedChildId(finalChildren[0]?.id || '');
        setTransactions(JSON.parse(localStorage.getItem('transactions') || '[]'));
        setInvestments(JSON.parse(localStorage.getItem('investments') || '[]'));
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
          isSilentAuthRef.current = false;

          if (tokenResponse?.error) {
            if (isSilentAuth) return;
            setAuthError(`Google 登入失敗：${tokenResponse.error}`);
            return;
          }

          try {
            await fetchUserProfile(tokenResponse.access_token, tokenResponse.expires_in);
          } catch (error) {
            console.error('Google profile error:', error);
            if (!isSilentAuth) {
              setAuthError('Google 登入成功，但取得個人資料失敗');
            }
          }
        }
      });

      const isExpired = !user?.expiresAt || user.expiresAt < Date.now() + 60_000;
      if (isExpired) {
        isSilentAuthRef.current = true;
        tokenClientRef.current.requestAccessToken({ prompt: '' });
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

    isSilentAuthRef.current = false;
    tokenClientRef.current.requestAccessToken({ prompt: 'consent' });
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

  const saveSettings = (newId: string) => {
    const newSettings = { ...settings, googleSheetId: newId.trim() };
    setSettings(newSettings);
    storageManager.saveSettings(newSettings);
    setShowSettings(false);
  };

  const handleAddChild = async () => {
    if (!newChildName.trim()) return;
    
    const newChild: Child = {
      id: Date.now().toString(),
      name: newChildName.trim(),
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newChildName.trim()}`
    };
    
    const updated = [...children, newChild];
    setChildren(updated);
    setNewChildName('');
    setIsAddingChild(false);
    localStorage.setItem('children_list', JSON.stringify(updated));
    
    await runSheetSync(() => sheetsService!.syncChildren(updated));
    
    if (!selectedChildId) setSelectedChildId(newChild.id);
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
      await runSheetSync(() => sheetsService.syncChildren(updated));
    }
    setChildToDelete(null);
  };

  const exportToExcel = () => {
    let csvContent = "\uFEFF"; 
    csvContent += "類別,姓名,日期,類型/標的,項目/動作,金額/數量,單價,總額\n";
    transactions.forEach(t => {
      const child = children.find(c => c.id === t.childId)?.name || '未知';
      csvContent += `一般帳目,${child},${t.date},${t.type},${t.description},${t.amount},-,${t.amount}\n`;
    });
    investments.forEach(i => {
      const child = children.find(c => c.id === i.childId)?.name || '未知';
      csvContent += `股票投資,${child},${i.date},${i.symbol},${i.action},${i.quantity},${i.price},${i.totalAmount}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `KidsLedger_Report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleAddTransaction = async (t: Transaction) => {
    const newList = [t, ...transactions];
    setTransactions(newList);
    localStorage.setItem('transactions', JSON.stringify(newList));
    if (sheetsService) await runSheetSync(() => sheetsService.addTransaction(t));
  };

  const handleDeleteTransaction = async (id: string) => {
    const updated = transactions.filter(t => t.id !== id);
    setTransactions(updated);
    localStorage.setItem('transactions', JSON.stringify(updated));
    if (sheetsService) await runSheetSync(() => sheetsService.deleteTransaction(id));
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;
    const updated = transactions.map(t => t.id === editingTransaction.id ? editingTransaction : t);
    setTransactions(updated);
    localStorage.setItem('transactions', JSON.stringify(updated));
    if (sheetsService) await runSheetSync(() => sheetsService.updateTransaction(editingTransaction));
    setEditingTransaction(null);
  };

  const handleUpdateInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvestment) return;
    const updated = investments.map(i => i.id === editingInvestment.id ? editingInvestment : i);
    setInvestments(updated);
    localStorage.setItem('investments', JSON.stringify(updated));
    if (sheetsService) await runSheetSync(() => sheetsService.updateInvestment(editingInvestment));
    setEditingInvestment(null);
  };

  const handleDeleteInvestment = async (id: string) => {
    const updated = investments.filter(i => i.id !== id);
    setInvestments(updated);
    localStorage.setItem('investments', JSON.stringify(updated));
    if (sheetsService) await runSheetSync(() => sheetsService.deleteInvestment(id));
  };

  const activeChild = children.find(c => c.id === selectedChildId) || children[0] || DEFAULT_CHILDREN[0];
  const childTransactions = transactions.filter(t => t.childId === selectedChildId);
  const childInvestments = investments.filter(i => i.childId === selectedChildId);

  const stats = {
    income: childTransactions.filter(t => t.type === TransactionType.INCOME).reduce((s, t) => s + t.amount, 0),
    expense: childTransactions.filter(t => t.type === TransactionType.EXPENSE).reduce((s, t) => s + t.amount, 0),
    investment: 
      childTransactions.filter(t => t.type === TransactionType.INVESTMENT).reduce((s, t) => s + t.amount, 0) +
      childInvestments.reduce((s, i) => i.action === 'BUY' ? s + i.totalAmount : s - i.totalAmount, 0),
  };
  const balance = stats.income - stats.expense - stats.investment;

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
    <div className="min-h-screen flex bg-[#f8fafc]">
      <aside className="w-72 bg-white border-r border-slate-200 flex-col hidden lg:flex shadow-sm">
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

        <div className="p-6 mt-auto space-y-4">
          <button onClick={exportToExcel} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-emerald-600 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition w-full">
            <Download className="w-4 h-4" /> 導出報表 (Excel)
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

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 p-4 z-20">
          <div className="w-full flex items-center justify-between px-6">
            <div className="flex bg-slate-100 p-1.5 rounded-[1.5rem] shadow-inner overflow-x-auto no-scrollbar">
              {children.map(child => (
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
            <div
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${syncStatus === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : syncStatus === 'error' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}
              title={syncError || ''}
            >
              <Database className={`w-3 h-3 ${syncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
              {syncStatus === 'success' ? '雲端同步正常' : syncStatus === 'error' ? '同步失敗' : syncStatus === 'syncing' ? '同步中...' : '未連線'}
            </div>
          </div>
        </header>

        {syncError && (
          <div className="mx-6 md:mx-10 mt-4 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-rose-700 text-sm font-bold">
            Google Sheet 同步失敗：{syncError}
          </div>
        )}

        <div className="w-full px-6 md:px-10 py-10 pb-32">
          {activeTab === 'DASHBOARD' ? (
            <div className="space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-[2.5rem] text-white shadow-xl">
                  <p className="text-blue-100 text-sm font-bold mb-2 uppercase tracking-widest">可用餘額</p>
                  <h4 className="text-4xl font-black">${balance.toLocaleString()}</h4>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">累積收入</p>
                  <h4 className="text-3xl font-black text-slate-800">${stats.income.toLocaleString()}</h4>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">累積支出</p>
                  <h4 className="text-3xl font-black text-slate-800">${stats.expense.toLocaleString()}</h4>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">投資額</p>
                  <h4 className="text-3xl font-black text-slate-800">${stats.investment.toLocaleString()}</h4>
                </div>
              </div>

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

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                <div className="lg:col-span-2 space-y-10">
                  <TransactionForm childId={selectedChildId} onAdd={handleAddTransaction} />
                  
                  <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100">
                    <h3 className="text-xl font-black text-slate-800 mb-8">帳目流水歷史</h3>
                    <div className="space-y-4">
                      {childTransactions.length === 0 ? (
                        <div className="py-20 text-center text-slate-300 font-bold italic">尚無記帳紀錄</div>
                      ) : (
                        childTransactions.map((t) => (
                          <div key={t.id} className="flex items-center justify-between p-6 hover:bg-slate-50 rounded-3xl transition group">
                            <div className="flex items-center gap-5">
                              <div className={`p-4 rounded-2xl ${t.type === TransactionType.INCOME ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                {t.type === TransactionType.INCOME ? <ArrowUpCircle /> : <ArrowDownCircle />}
                              </div>
                              <div>
                                <p className="font-black text-slate-800 text-lg">{t.description}</p>
                                <p className="text-xs text-slate-400 font-bold uppercase">{t.date} • {t.category}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-6">
                              <span className={`font-mono font-black text-2xl ${t.type === TransactionType.INCOME ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {t.type === TransactionType.EXPENSE ? '-' : '+'}${t.amount.toLocaleString()}
                              </span>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                                <button onClick={() => setEditingTransaction(t)} className="p-2 text-slate-400 hover:text-blue-600 bg-white rounded-xl shadow-sm border border-slate-100">
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDeleteTransaction(t.id)} className="p-2 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 h-fit">
                  <h3 className="text-xl font-black text-slate-800 mb-8 uppercase tracking-widest text-center">資產分佈</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={[{ name: '收入', value: stats.income }, { name: '支出', value: stats.expense }, { name: '投資', value: stats.investment }]} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          <Cell fill="#10b981" />
                          <Cell fill="#f43f5e" />
                          <Cell fill="#f59e0b" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <InvestmentRecord 
              investments={investments} 
              childId={selectedChildId} 
              childName={activeChild.name} 
              availableBalance={balance} 
              onAdd={async (inv) => {
                const newList = [inv, ...investments];
                setInvestments(newList);
                localStorage.setItem('investments', JSON.stringify(newList));
                if (sheetsService) await runSheetSync(() => sheetsService.addInvestment(inv));
              }}
              onEdit={(inv) => setEditingInvestment(inv)}
              onDelete={handleDeleteInvestment}
            />
          )}
        </div>
      </main>

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
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 rounded-full transition">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            
            <div className="space-y-10">
              <section>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">小朋友管理</h3>
                  {!isAddingChild && (
                    <button onClick={() => setIsAddingChild(true)} className="flex items-center gap-2 text-blue-600 font-black text-sm bg-blue-50 px-5 py-2.5 rounded-2xl hover:bg-blue-100 transition shadow-sm">
                      <UserPlus className="w-4 h-4" /> 新增小朋友
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
                        <input autoFocus type="text" value={newChildName} onChange={(e) => setNewChildName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddChild()} placeholder="例如：小美" className="w-full bg-white border-2 border-blue-100 rounded-2xl px-5 py-3 focus:border-blue-500 focus:outline-none font-bold text-slate-700" />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={handleAddChild} className="flex-1 bg-blue-600 text-white font-black py-4 rounded-2xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-100"><Plus className="w-5 h-5" /> 確定新增</button>
                      <button onClick={() => { setIsAddingChild(false); setNewChildName(''); }} className="px-6 py-4 font-black text-slate-400 hover:text-slate-600 bg-white rounded-2xl">取消</button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {children.map(child => (
                    <div key={child.id} className="flex items-center justify-between p-5 bg-slate-50 rounded-[1.5rem] border border-slate-100 group hover:border-blue-200 transition-all">
                      <div className="flex items-center gap-4">
                        <img src={child.avatar} className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100" alt={child.name} />
                        <span className="font-black text-slate-700 text-lg">{child.name}</span>
                      </div>
                      <button 
                        type="button"
                        onClick={() => setChildToDelete(child)} 
                        className="p-3 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all relative z-10"
                        title="刪除"
                      >
                        <UserMinus className="w-6 h-6" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-5">雲端設定</h3>
                <input type="text" defaultValue={settings.googleSheetId} id="sheetIdInput" placeholder="貼上您的試算表 ID" className="w-full bg-white border-2 border-slate-100 rounded-2xl p-4 font-mono text-sm focus:border-blue-500 focus:outline-none transition-all" />
              </section>

              <button onClick={() => { const input = document.getElementById('sheetIdInput') as HTMLInputElement; saveSettings(input.value); }} className="w-full bg-gray-900 text-white py-6 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-black transition-all">儲存所有設定</button>
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
                <select value={editingInvestment.action} onChange={e => setEditingInvestment({...editingInvestment, action: e.target.value as 'BUY' | 'SELL'})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none">
                  <option value="BUY">買入</option>
                  <option value="SELL">賣出</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">股數</label>
                <input type="number" value={editingInvestment.quantity} onChange={e => {
                  const q = Number(e.target.value);
                  setEditingInvestment({...editingInvestment, quantity: q, totalAmount: q * editingInvestment.price});
                }} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-black text-slate-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">單價</label>
                <input type="number" value={editingInvestment.price} onChange={e => {
                  const p = Number(e.target.value);
                  setEditingInvestment({...editingInvestment, price: p, totalAmount: p * editingInvestment.quantity});
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
