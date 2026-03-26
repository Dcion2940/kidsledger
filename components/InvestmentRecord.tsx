import React, { useMemo, useState, useEffect } from 'react';
import { Investment, Price } from '../types';
import { Plus, Wallet, Pencil, Trash2, PieChart, X } from 'lucide-react';

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

interface LotState {
  lotId: string;
  symbol: string;
  companyName: string;
  buyDate: string;
  originalQuantity: number;
  remainingQuantity: number;
  price: number;
  remainingCost: number;
  unitCost: number;
}

interface LotDetail extends LotState {
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedReturnPct: number;
}

interface SellAllocationEntry {
  lotId: string;
  quantity: number;
}

const BUY_FEE_RATE = 0.001425;
const SELL_FEE_RATE = 0.004425;

const calculateTradeTotal = (quantity: number, price: number, action: 'BUY' | 'SELL') => {
  if (quantity <= 0 || price <= 0) return 0;
  const grossAmount = quantity * price;
  const fee = grossAmount * (action === 'BUY' ? BUY_FEE_RATE : SELL_FEE_RATE);
  const total = action === 'BUY' ? grossAmount + fee : grossAmount - fee;
  return Number(total.toFixed(2));
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

const InvestmentRecord: React.FC<Props> = ({ investments, prices, childId, childName, availableBalance, onAdd, onEdit, onDelete }) => {
  const [viewMode, setViewMode] = useState<'HOLDINGS' | 'HISTORY'>('HOLDINGS');
  const [formError, setFormError] = useState<string | null>(null);
  const [sellError, setSellError] = useState<string | null>(null);
  const [sellingHolding, setSellingHolding] = useState<HoldingSummary | null>(null);
  const [selectedSellLot, setSelectedSellLot] = useState<LotDetail | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [sellTotalManuallyEdited, setSellTotalManuallyEdited] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    symbol: '',
    companyName: '',
    quantity: '',
    price: '',
    totalAmount: '',
    action: 'BUY' as const
  });
  const [sellFormData, setSellFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    quantity: '',
    price: '',
    totalAmount: ''
  });

  useEffect(() => {
    const q = Number(formData.quantity);
    const p = Number(formData.price);
    if (q && p) {
      setFormData(prev => ({ ...prev, totalAmount: calculateTradeTotal(q, p, prev.action).toString() }));
    }
  }, [formData.quantity, formData.price, formData.action]);

  const childInvestments = useMemo(
    () => investments.filter(i => i.childId === childId),
    [investments, childId]
  );
  const sortedHistory = useMemo(
    () => [...childInvestments].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [childInvestments]
  );

  const priceBySymbol = useMemo(() => {
    const map = new Map<string, Price>();
    prices.forEach((item) => {
      if (!item.symbol) return;
      map.set(item.symbol.toUpperCase(), item);
    });
    return map;
  }, [prices]);

  const stockReference = useMemo(() => {
    const map = new Map<string, { symbol: string; companyName: string }>();

    prices.forEach((item) => {
      const symbol = item.symbol?.trim().toUpperCase();
      const companyName = item.companyName?.trim();
      if (!symbol || !companyName) return;
      map.set(`${symbol}|${companyName.toLowerCase()}`, { symbol, companyName });
    });

    investments.forEach((item) => {
      const symbol = item.symbol?.trim().toUpperCase();
      const companyName = item.companyName?.trim();
      if (!symbol || !companyName) return;
      if (companyName.toUpperCase() === symbol) return;
      map.set(`${symbol}|${companyName.toLowerCase()}`, { symbol, companyName });
    });

    return Array.from(map.values());
  }, [prices, investments]);

  const autofillCompanyName = (symbolRaw: string) => {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) return;

    const matchedNames = Array.from(
      new Set(
        stockReference
          .filter((row) => row.symbol === symbol)
          .map((row) => row.companyName)
      )
    );

    if (matchedNames.length !== 1) return;

    setFormData((prev) => {
      if (prev.companyName.trim()) return prev;
      return { ...prev, symbol, companyName: matchedNames[0] };
    });
  };

  const autofillSymbol = (nameRaw: string) => {
    const name = nameRaw.trim().toLowerCase();
    if (!name) return;

    const matchedSymbols = Array.from(
      new Set(
        stockReference
          .filter((row) => row.companyName.trim().toLowerCase() === name)
          .map((row) => row.symbol)
      )
    );

    if (matchedSymbols.length !== 1) return;

    setFormData((prev) => {
      if (prev.symbol.trim()) return prev;
      return { ...prev, symbol: matchedSymbols[0] };
    });
  };

  useEffect(() => {
    if (!formData.symbol.trim()) return;
    const timer = window.setTimeout(() => autofillCompanyName(formData.symbol), 500);
    return () => window.clearTimeout(timer);
  }, [formData.symbol, stockReference]);

  useEffect(() => {
    if (!formData.companyName.trim()) return;
    const timer = window.setTimeout(() => autofillSymbol(formData.companyName), 500);
    return () => window.clearTimeout(timer);
  }, [formData.companyName, stockReference]);

  useEffect(() => {
    if (!sellingHolding || sellTotalManuallyEdited) return;

    const quantity = Number(sellFormData.quantity);
    const price = Number(sellFormData.price);

    setSellFormData((prev) => ({
      ...prev,
      totalAmount: quantity > 0 && price > 0 ? calculateTradeTotal(quantity, price, 'SELL').toString() : ''
    }));
  }, [sellFormData.quantity, sellFormData.price, sellTotalManuallyEdited, sellingHolding]);

  const { holdings, totalRealizedPnl, lotDetailsBySymbol } = useMemo(() => {
    const openLotsBySymbol = new Map<string, LotState[]>();
    const realizedBySymbol = new Map<string, number>();
    const sorted = [...childInvestments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    sorted.forEach((inv) => {
      const symbol = inv.symbol.toUpperCase();
      const companyName = inv.companyName?.trim() || symbol;
      const lots = openLotsBySymbol.get(symbol) || [];

      if (inv.action === 'BUY') {
        lots.push({
          lotId: inv.id,
          symbol,
          companyName,
          buyDate: inv.date,
          originalQuantity: inv.quantity,
          remainingQuantity: inv.quantity,
          price: inv.price,
          remainingCost: inv.totalAmount,
          unitCost: inv.quantity > 0 ? inv.totalAmount / inv.quantity : 0
        });
        openLotsBySymbol.set(symbol, lots);
        return;
      }

      let remainingToSell = inv.quantity;
      let soldCost = 0;
      const specifiedAllocations = parseSellAllocations(inv.sellAllocations);
      let candidateLots: LotState[] = [];

      if (inv.sellStrategy === 'SPECIFIC' && specifiedAllocations.length > 0) {
        candidateLots = specifiedAllocations
          .map((allocation) => lots.find((lot) => lot.lotId === allocation.lotId))
          .filter((lot): lot is LotState => Boolean(lot));
      } else if (inv.sellStrategy === 'LOWEST_COST') {
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
        lot.remainingQuantity -= allowedQuantity;
        lot.remainingCost = Math.max(0, lot.remainingCost - costPortion);
        if (lot.remainingQuantity <= 0) {
          lot.remainingQuantity = 0;
          lot.remainingCost = 0;
        }
        remainingToSell -= allowedQuantity;
        soldCost += costPortion;
      }

      realizedBySymbol.set(symbol, (realizedBySymbol.get(symbol) || 0) + (inv.totalAmount - soldCost));
      openLotsBySymbol.set(symbol, lots.filter((lot) => lot.remainingQuantity > 0));
    });

    const lotDetailsMap = new Map<string, LotDetail[]>();
    const holdingRows: HoldingSummary[] = [];

    Array.from(new Set([...openLotsBySymbol.keys(), ...realizedBySymbol.keys()])).forEach((symbol) => {
      const lots = (openLotsBySymbol.get(symbol) || []).filter((lot) => lot.remainingQuantity > 0);
      const price = priceBySymbol.get(symbol);
      const marketPrice = Number(price?.price || 0);

      const detailedLots = lots
        .map((lot) => {
          const marketValue = lot.remainingQuantity * marketPrice;
          const estimatedSellValue = marketPrice > 0 ? calculateTradeTotal(lot.remainingQuantity, marketPrice, 'SELL') : 0;
          const unrealizedPnl = estimatedSellValue - lot.remainingCost;
          const unrealizedReturnPct = lot.remainingCost > 0 ? (unrealizedPnl / lot.remainingCost) * 100 : 0;
          return {
            ...lot,
            companyName: price?.companyName || lot.companyName || symbol,
            marketPrice,
            marketValue,
            unrealizedPnl,
            unrealizedReturnPct
          };
        })
        .sort((a, b) => a.buyDate.localeCompare(b.buyDate) || a.lotId.localeCompare(b.lotId));

      if (detailedLots.length > 0) {
        lotDetailsMap.set(symbol, detailedLots);
      }

      const shares = detailedLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
      const costBasis = detailedLots.reduce((sum, lot) => sum + lot.remainingCost, 0);
      const marketValue = detailedLots.reduce((sum, lot) => sum + lot.marketValue, 0);
      const estimatedSellValue = marketPrice > 0 ? calculateTradeTotal(shares, marketPrice, 'SELL') : 0;
      const unrealizedPnl = estimatedSellValue - costBasis;
      const unrealizedReturnPct = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

      if (shares > 0) {
        holdingRows.push({
          symbol,
          companyName: price?.companyName || detailedLots[0]?.companyName || symbol,
          shares,
          avgCost: shares > 0 ? costBasis / shares : 0,
          costBasis,
          marketPrice,
          marketValue,
          unrealizedPnl,
          unrealizedReturnPct,
          realizedPnl: realizedBySymbol.get(symbol) || 0
        });
      }
    });

    return {
      holdings: holdingRows.sort((a, b) => b.marketValue - a.marketValue),
      totalRealizedPnl: Array.from(realizedBySymbol.values()).reduce((sum, value) => sum + value, 0),
      lotDetailsBySymbol: lotDetailsMap
    };
  }, [childInvestments, priceBySymbol]);
  const currentDetailLots = detailSymbol ? (lotDetailsBySymbol.get(detailSymbol) || []) : [];

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
        companyName: formData.companyName.trim() || formData.symbol.toUpperCase(),
        quantity: Number(formData.quantity),
        price: Number(formData.price),
        totalAmount: total,
        action: formData.action,
        sellStrategy: formData.action === 'SELL' ? 'LOWEST_COST' : undefined
      });
      setFormError(null);
      setFormData({ date: new Date().toISOString().split('T')[0], symbol: '', companyName: '', quantity: '', price: '', totalAmount: '', action: 'BUY' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '新增成交失敗');
    }
  };

  const openSellModal = (holding: HoldingSummary) => {
    setSellingHolding(holding);
    setSelectedSellLot(null);
    setSellError(null);
    setSellTotalManuallyEdited(false);
    setSellFormData({
      date: new Date().toISOString().split('T')[0],
      quantity: holding.shares.toString(),
      price: holding.marketPrice > 0 ? holding.marketPrice.toString() : '',
      totalAmount: holding.marketPrice > 0 ? calculateTradeTotal(holding.shares, holding.marketPrice, 'SELL').toString() : ''
    });
  };

  const openSpecificLotSellModal = (lot: LotDetail) => {
    const holding = holdings.find((item) => item.symbol === lot.symbol);
    if (!holding) return;
    setSellingHolding(holding);
    setSelectedSellLot(lot);
    setSellError(null);
    setSellTotalManuallyEdited(false);
    setSellFormData({
      date: new Date().toISOString().split('T')[0],
      quantity: lot.remainingQuantity.toString(),
      price: lot.marketPrice > 0 ? lot.marketPrice.toString() : '',
      totalAmount: lot.marketPrice > 0 ? calculateTradeTotal(lot.remainingQuantity, lot.marketPrice, 'SELL').toString() : ''
    });
  };

  const closeSellModal = () => {
    setSellingHolding(null);
    setSelectedSellLot(null);
    setSellError(null);
    setSellTotalManuallyEdited(false);
    setSellFormData({
      date: new Date().toISOString().split('T')[0],
      quantity: '',
      price: '',
      totalAmount: ''
    });
  };

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellingHolding) return;

    const quantity = Number(sellFormData.quantity);
    const price = Number(sellFormData.price);
    const totalAmount = Number(sellFormData.totalAmount);

    if (!sellFormData.date || quantity <= 0 || price <= 0 || !Number.isFinite(totalAmount)) {
      setSellError('請完整填寫賣出日期、股數、成交單價與成交總額');
      return;
    }

    if (selectedSellLot && quantity > selectedSellLot.remainingQuantity) {
      setSellError(`指定 lot 最多只能賣出 ${selectedSellLot.remainingQuantity.toLocaleString()} 股`);
      return;
    }

    try {
      await onAdd({
        id: Date.now().toString(),
        childId,
        date: sellFormData.date,
        symbol: sellingHolding.symbol,
        companyName: sellingHolding.companyName || sellingHolding.symbol,
        quantity,
        price,
        totalAmount,
        action: 'SELL',
        sellStrategy: selectedSellLot ? 'SPECIFIC' : 'LOWEST_COST',
        sellAllocations: selectedSellLot ? JSON.stringify([{ lotId: selectedSellLot.lotId, quantity }]) : undefined
      });
      closeSellModal();
    } catch (error) {
      setSellError(error instanceof Error ? error.message : '賣出成交失敗');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 sm:p-8 rounded-[3rem] shadow-sm border border-orange-100 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
          <div className="bg-orange-100 p-4 rounded-3xl">
            <Wallet className="w-8 h-8 text-orange-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-slate-800 break-words">{childName} 的股票投資</h2>
            <p className="text-slate-400 font-bold text-sm break-words">追蹤投資歷程與資產配置</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 lg:gap-10 text-left sm:text-right">
          <div className="min-w-0">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">目前可用資金</p>
            <p className={`text-3xl font-black break-all ${availableBalance < 0 ? 'text-rose-500' : 'text-blue-600'}`}>
              ${Math.round(availableBalance).toLocaleString()}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">已實現損益</p>
            <p className={`text-3xl font-black break-all ${totalRealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {totalRealizedPnl >= 0 ? '+' : '-'}${Math.abs(Math.round(totalRealizedPnl)).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
          <Plus className="w-6 h-6 text-orange-500" />
          新增成交紀錄
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">日期</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700 w-full"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股票代碼</label>
            <input
              placeholder="例如 2330"
              value={formData.symbol}
              onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              onBlur={(e) => autofillCompanyName(e.target.value)}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股票名稱</label>
            <input
              placeholder="例如 台積電"
              value={formData.companyName}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              onBlur={(e) => autofillSymbol(e.target.value)}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-1">
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
          <div className="flex flex-col gap-2 lg:col-span-1">
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
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">成交總額 (含手續費)</label>
            <input
              type="number"
              placeholder="自動計算"
              value={formData.totalAmount}
              onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-1">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">動作</label>
            <select
              value={formData.action}
              onChange={(e) => setFormData({ ...formData, action: e.target.value as 'BUY' | 'SELL' })}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700 whitespace-nowrap"
            >
              <option value="BUY">買入</option>
              <option value="SELL">賣出</option>
            </select>
          </div>
          <div className="flex items-end lg:col-span-1">
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
                  <th className="px-8 py-5 text-right">預期報酬率</th>
                  <th className="px-8 py-5 text-center">操作</th>
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
                        <div>
                          <p className="font-black text-slate-800 text-lg">{holding.symbol}</p>
                          <p className="text-xs font-bold text-slate-400">{holding.companyName}</p>
                        </div>
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
                      <td className="px-8 py-6">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailSymbol(holding.symbol)}
                            className="px-4 py-2 rounded-xl text-xs font-black text-slate-600 bg-slate-100 hover:bg-slate-200 transition whitespace-nowrap"
                          >
                            查看明細
                          </button>
                          <button
                            type="button"
                            onClick={() => openSellModal(holding)}
                            className="px-4 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 transition whitespace-nowrap"
                          >
                            快速賣出
                          </button>
                        </div>
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
                {sortedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-8 py-20 text-center text-slate-300 italic font-bold">尚無投資紀錄</td>
                  </tr>
                ) : (
                  sortedHistory.map((inv) => (
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
                          <button
                            onClick={() => {
                              if (!window.confirm(`確定要刪除 ${inv.symbol} 這筆${inv.action === 'BUY' ? '買入' : '賣出'}紀錄嗎？此動作無法撤回。`)) {
                                return;
                              }
                              onDelete(inv.id);
                            }}
                            className="p-2.5 text-slate-400 hover:text-rose-600 bg-white rounded-xl shadow-sm border border-slate-100 hover:border-rose-200 transition"
                          >
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

      {sellingHolding && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <h3 className="text-2xl font-black text-slate-800">賣出 {sellingHolding.symbol}</h3>
                <p className="text-sm font-bold text-slate-400">{sellingHolding.companyName}</p>
              </div>
              <button
                type="button"
                onClick={closeSellModal}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSellSubmit} className="p-8 space-y-6">
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                <p className="text-sm font-bold text-slate-600">
                  {selectedSellLot
                    ? `你正在指定賣出 ${selectedSellLot.buyDate} 買入的 lot。預設股數為該 lot 目前持有的 ${selectedSellLot.remainingQuantity.toLocaleString()} 股，你可以直接修改。`
                    : `是否賣出此標的？預設股數為目前持有的 ${sellingHolding.shares.toLocaleString()} 股，你可以直接修改。`}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">賣出日期</label>
                  <input
                    type="date"
                    value={sellFormData.date}
                    onChange={(e) => setSellFormData((prev) => ({ ...prev, date: e.target.value }))}
                    className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">股數</label>
                  <input
                    type="number"
                    min="1"
                    max={selectedSellLot ? selectedSellLot.remainingQuantity : sellingHolding.shares}
                    value={sellFormData.quantity}
                    onChange={(e) => setSellFormData((prev) => ({ ...prev, quantity: e.target.value }))}
                    className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">成交單價</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={sellFormData.price}
                    onChange={(e) => setSellFormData((prev) => ({ ...prev, price: e.target.value }))}
                    className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">成交總額（含手續費）</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={sellFormData.totalAmount}
                    onChange={(e) => {
                      setSellTotalManuallyEdited(true);
                      setSellFormData((prev) => ({ ...prev, totalAmount: e.target.value }));
                    }}
                    className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
                  />
                </div>
              </div>

              {sellError && (
                <p className="text-sm font-bold text-rose-600">{sellError}</p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeSellModal}
                  className="px-5 py-3 rounded-2xl font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-3 rounded-2xl font-black text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-lg shadow-emerald-100"
                >
                  確認賣出
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailSymbol && (
        <div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <h3 className="text-2xl font-black text-slate-800">{detailSymbol} 持倉明細</h3>
                <p className="text-sm font-bold text-slate-400">顯示目前仍持有的 lot 組成，可從這裡指定批次賣出。</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailSymbol(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4">標的</th>
                    <th className="px-6 py-4 text-right">持有股數</th>
                    <th className="px-6 py-4 text-right">買入股價</th>
                    <th className="px-6 py-4 text-right">投入成本</th>
                    <th className="px-6 py-4 text-right">現價</th>
                    <th className="px-6 py-4 text-right">市值</th>
                    <th className="px-6 py-4 text-right">未實現損益</th>
                    <th className="px-6 py-4 text-right">預期報酬率</th>
                    <th className="px-6 py-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {currentDetailLots.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-8 py-20 text-center text-slate-300 italic font-bold">目前沒有可顯示的持倉 lot</td>
                    </tr>
                  ) : (
                    currentDetailLots.map((lot) => (
                      <tr key={lot.lotId} className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-5">
                          <p className="font-black text-slate-800 text-base">{lot.symbol}</p>
                          <p className="text-xs font-bold text-slate-400">{lot.companyName}</p>
                        </td>
                        <td className="px-6 py-5 text-right font-black text-slate-700">{lot.remainingQuantity.toLocaleString()} 股</td>
                        <td className="px-6 py-5 text-right font-mono font-black text-slate-700">${Math.round(lot.price).toLocaleString()}</td>
                        <td className="px-6 py-5 text-right font-mono font-black text-slate-700">${Math.round(lot.remainingCost).toLocaleString()}</td>
                        <td className="px-6 py-5 text-right font-mono font-black text-slate-700">
                          {lot.marketPrice > 0 ? `$${lot.marketPrice.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-6 py-5 text-right font-mono font-black text-slate-700">
                          {lot.marketPrice > 0 ? `$${Math.round(lot.marketValue).toLocaleString()}` : '-'}
                        </td>
                        <td className={`px-6 py-5 text-right font-mono font-black ${lot.unrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {lot.marketPrice > 0 ? `${lot.unrealizedPnl >= 0 ? '+' : '-'}$${Math.abs(Math.round(lot.unrealizedPnl)).toLocaleString()}` : '-'}
                        </td>
                        <td className={`px-6 py-5 text-right font-mono font-black ${lot.unrealizedReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {lot.marketPrice > 0 ? `${lot.unrealizedReturnPct >= 0 ? '+' : ''}${lot.unrealizedReturnPct.toFixed(2)}%` : '-'}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                setDetailSymbol(null);
                                openSpecificLotSellModal(lot);
                              }}
                              className="px-4 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 transition whitespace-nowrap"
                            >
                              指定賣出
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvestmentRecord;
