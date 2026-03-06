import React, { useMemo, useState, useEffect } from 'react';
import { Investment, Price } from '../types';
import { Plus, Wallet, Pencil, Trash2, PieChart } from 'lucide-react';

interface Props {
  investments: Investment[];
  prices: Price[];
  childId: string;
  childName: string;
  availableBalance: number;
  onAdd: (inv: Investment) => Promise<void> | void;
  onEdit: (inv: Investment) => void;
  onDelete: (id: string) => void;
}

interface HoldingSummary {
  symbol: string;
  companyName: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedReturnPct: number;
  realizedPnl: number;
}

const InvestmentRecord: React.FC<Props> = ({ investments, prices, childId, childName, availableBalance, onAdd, onEdit, onDelete }) => {
  const [viewMode, setViewMode] = useState<'HOLDINGS' | 'HISTORY'>('HOLDINGS');
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    symbol: '',
    quantity: '',
    price: '',
    totalAmount: '',
    action: 'BUY' as const
  });

  useEffect(() => {
    const q = Number(formData.quantity);
    const p = Number(formData.price);
    if (q && p) {
      setFormData(prev => ({ ...prev, totalAmount: (q * p).toString() }));
    }
  }, [formData.quantity, formData.price]);

  const childInvestments = useMemo(
    () => investments.filter(i => i.childId === childId),
    [investments, childId]
  );

  const priceBySymbol = useMemo(() => {
    const map = new Map<string, Price>();
    prices.forEach((item) => {
      if (!item.symbol) return;
      map.set(item.symbol.toUpperCase(), item);
    });
    return map;
  }, [prices]);

  const holdings = useMemo(() => {
    const grouped = new Map<string, HoldingSummary>();
    const sorted = [...childInvestments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    sorted.forEach((inv) => {
      const symbol = inv.symbol.toUpperCase();
      const existing = grouped.get(symbol) || {
        symbol,
        companyName: inv.companyName || symbol,
        shares: 0,
        avgCost: 0,
        costBasis: 0,
        marketPrice: 0,
        marketValue: 0,
        unrealizedPnl: 0,
        unrealizedReturnPct: 0,
        realizedPnl: 0
      };

      if (inv.companyName && inv.companyName.trim()) {
        existing.companyName = inv.companyName;
      }

      if (inv.action === 'BUY') {
        existing.shares += inv.quantity;
        existing.costBasis += inv.totalAmount;
      } else if (existing.shares > 0 && inv.quantity > 0) {
        const avgBeforeSell = existing.costBasis / existing.shares;
        const soldCost = avgBeforeSell * inv.quantity;
        existing.shares -= inv.quantity;
        existing.costBasis -= soldCost;
        existing.realizedPnl += inv.totalAmount - soldCost;
        if (existing.shares <= 0) {
          existing.shares = 0;
          existing.costBasis = 0;
        }
      }

      existing.avgCost = existing.shares > 0 ? existing.costBasis / existing.shares : 0;
      grouped.set(symbol, existing);
    });

    return Array.from(grouped.values())
      .filter((item) => item.shares > 0)
      .map((item) => {
        const price = priceBySymbol.get(item.symbol);
        const marketPrice = Number(price?.price || 0);
        const marketValue = item.shares * marketPrice;
        const unrealizedPnl = marketValue - item.costBasis;
        const unrealizedReturnPct = item.costBasis > 0 ? (unrealizedPnl / item.costBasis) * 100 : 0;

        return {
          ...item,
          companyName: price?.companyName || item.companyName || item.symbol,
          marketPrice,
          marketValue,
          unrealizedPnl,
          unrealizedReturnPct
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);
  }, [childInvestments, priceBySymbol]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(formData.totalAmount);
    if (!formData.symbol || !formData.quantity || !formData.price || isNaN(total)) return;

    try {
      await onAdd({
        id: Date.now().toString(),
        childId,
        date: formData.date,
        symbol: formData.symbol.toUpperCase(),
        companyName: formData.symbol.toUpperCase(),
        quantity: Number(formData.quantity),
        price: Number(formData.price),
        totalAmount: total,
        action: formData.action
      });
      setFormError(null);
      setFormData({ date: new Date().toISOString().split('T')[0], symbol: '', quantity: '', price: '', totalAmount: '', action: 'BUY' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '新增成交失敗');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-orange-100 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="bg-orange-100 p-4 rounded-3xl">
            <Wallet className="w-8 h-8 text-orange-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800">{childName} 的股票投資</h2>
            <p className="text-slate-400 font-bold text-sm">追蹤投資歷程與資產配置</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">目前可用資金</p>
          <p className={`text-3xl font-black ${availableBalance < 0 ? 'text-rose-500' : 'text-blue-600'}`}>
            ${availableBalance.toLocaleString()}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
          <Plus className="w-6 h-6 text-orange-500" />
          新增成交紀錄
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">日期</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700 w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股票代碼</label>
            <input
              placeholder="例如 2330"
              value={formData.symbol}
              onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股數</label>
            <input
              type="number"
              placeholder="0"
              value={formData.quantity}
              onChange={(e) => {
                const val = e.target.value;
                setFormData({ ...formData, quantity: val === '' ? '' : Number(val).toString() });
              }}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">成交單價</label>
            <input
              type="number"
              placeholder="0"
              value={formData.price}
              onChange={(e) => {
                const val = e.target.value;
                setFormData({ ...formData, price: val === '' ? '' : Number(val).toString() });
              }}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">成交總額 (含手續費)</label>
            <input
              type="number"
              placeholder="自動計算"
              value={formData.totalAmount}
              onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">動作</label>
            <select
              value={formData.action}
              onChange={(e) => setFormData({ ...formData, action: e.target.value as 'BUY' | 'SELL' })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            >
              <option value="BUY">買入 (扣款)</option>
              <option value="SELL">賣出 (回款)</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black hover:bg-orange-600 transition shadow-lg shadow-orange-100 active:scale-95">
              新增
            </button>
          </div>
        </div>
        {formError && (
          <p className="mt-4 text-sm font-bold text-rose-600">{formError}</p>
        )}
      </form>

      <div className="bg-white rounded-[3rem] shadow-sm overflow-hidden border border-slate-100">
        <div className="p-8 border-b border-slate-50 bg-slate-50/30 flex flex-wrap gap-3 justify-between items-center">
          <h3 className="font-black text-slate-800 text-xl">{viewMode === 'HOLDINGS' ? '持倉總覽' : '歷史成交清單'}</h3>
          <div className="bg-slate-100 p-1 rounded-xl flex">
            <button
              type="button"
              onClick={() => setViewMode('HOLDINGS')}
              className={`px-4 py-2 text-xs font-black rounded-lg transition ${viewMode === 'HOLDINGS' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}
            >
              <span className="inline-flex items-center gap-1">
                <PieChart className="w-3 h-3" /> 持倉總覽
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('HISTORY')}
              className={`px-4 py-2 text-xs font-black rounded-lg transition ${viewMode === 'HISTORY' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}
            >
              歷史成交
            </button>
          </div>
        </div>

        {viewMode === 'HOLDINGS' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <tr>
                  <th className="px-8 py-5">標的</th>
                  <th className="px-8 py-5 text-right">持有股數</th>
                  <th className="px-8 py-5 text-right">平均成本</th>
                  <th className="px-8 py-5 text-right">投入成本</th>
                  <th className="px-8 py-5 text-right">現價 (Prices)</th>
                  <th className="px-8 py-5 text-right">市值</th>
                  <th className="px-8 py-5 text-right">未實現損益</th>
                  <th className="px-8 py-5 text-right">報酬率</th>
                  <th className="px-8 py-5 text-right">已實現損益</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {holdings.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-8 py-20 text-center text-slate-300 italic font-bold">尚無持倉（或尚未有買入紀錄）</td>
                  </tr>
                ) : (
                  holdings.map((holding) => (
                    <tr key={holding.symbol} className="hover:bg-slate-50/50 transition">
                      <td className="px-8 py-6">
                        <p className="font-black text-slate-800 text-lg">{holding.symbol}</p>
                        <p className="text-xs font-bold text-slate-400">{holding.companyName}</p>
                      </td>
                      <td className="px-8 py-6 text-right font-black text-slate-700">{holding.shares.toLocaleString()} 股</td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">${Math.round(holding.avgCost).toLocaleString()}</td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">${Math.round(holding.costBasis).toLocaleString()}</td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">
                        {holding.marketPrice > 0 ? `$${holding.marketPrice.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">
                        {holding.marketPrice > 0 ? `$${Math.round(holding.marketValue).toLocaleString()}` : '-'}
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black ${holding.unrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {holding.marketPrice > 0 ? `${holding.unrealizedPnl >= 0 ? '+' : '-'}$${Math.abs(Math.round(holding.unrealizedPnl)).toLocaleString()}` : '-'}
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black ${holding.unrealizedReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {holding.marketPrice > 0 ? `${holding.unrealizedReturnPct >= 0 ? '+' : ''}${holding.unrealizedReturnPct.toFixed(2)}%` : '-'}
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black ${holding.realizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {holding.realizedPnl >= 0 ? '+' : '-'}${Math.abs(Math.round(holding.realizedPnl)).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <tr>
                  <th className="px-8 py-5">日期</th>
                  <th className="px-8 py-5">標的</th>
                  <th className="px-8 py-5">動作</th>
                  <th className="px-8 py-5">數量/單價</th>
                  <th className="px-8 py-5 text-right">成交總額</th>
                  <th className="px-8 py-5 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {childInvestments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-8 py-20 text-center text-slate-300 italic font-bold">尚無投資紀錄</td>
                  </tr>
                ) : (
                  childInvestments.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50 transition group">
                      <td className="px-8 py-6 text-sm font-bold text-slate-500">{inv.date}</td>
                      <td className="px-8 py-6">
                        <p className="font-black text-slate-800 text-lg">{inv.symbol}</p>
                        <p className="text-xs font-bold text-slate-400">{inv.companyName}</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase ${inv.action === 'BUY' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                          {inv.action === 'BUY' ? '買入' : '賣出'}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-slate-700">{inv.quantity.toLocaleString()} 股</p>
                        <p className="text-xs text-slate-400 font-bold">${inv.price.toLocaleString()}</p>
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black text-xl ${inv.action === 'BUY' ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {inv.action === 'BUY' ? '-' : '+'}${inv.totalAmount.toLocaleString()}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => onEdit(inv)} className="p-2.5 text-slate-400 hover:text-blue-600 bg-white rounded-xl shadow-sm border border-slate-100 hover:border-blue-200 transition">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => onDelete(inv.id)} className="p-2.5 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100 hover:border-rose-200 transition">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestmentRecord;
