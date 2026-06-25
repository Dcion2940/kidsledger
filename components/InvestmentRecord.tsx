import React, { useEffect, useMemo, useState } from 'react';
import { Investment, InvestmentMarket, Price, SupportedCurrency } from '../types';
import { Plus, Wallet, Pencil, PieChart, RefreshCcw, Trash2, X } from 'lucide-react';
import {
  DEFAULT_US_BROKER,
  DEFAULT_US_ORDER_CHANNEL,
  calculateEstimatedFee,
  calculateNetAmountTwd,
  calculateTradeTotal,
  formatCurrency,
  getMarketTradeCurrency,
  getPriceFxRateToTwd,
  normalizeSymbolForMarket
} from '../utils/investments';

interface Props {
  investments: Investment[];
  prices: Price[];
  childId: string;
  childName: string;
  availableBalance: number;
  usdTwdReferenceRate: number;
  usdTwdReferenceUpdatedAt?: string;
  onAdd: (inv: Investment) => Promise<void> | void;
  onEdit: (inv: Investment) => void;
  onDelete: (id: string) => void;
  onRefreshPrices: () => Promise<void> | void;
  isRefreshingPrices?: boolean;
}

interface HoldingSummary {
  key: string;
  market: InvestmentMarket;
  symbol: string;
  companyName: string;
  tradeCurrency: SupportedCurrency;
  shares: number;
  avgCostTrade: number;
  costBasisTrade: number;
  costBasisTwd: number;
  marketPriceTrade: number;
  marketValueTrade: number;
  marketValueTwd: number;
  unrealizedPnlTrade: number;
  unrealizedPnlTwd: number;
  unrealizedReturnPct: number;
  realizedPnlTrade: number;
  realizedPnlTwd: number;
  currentFxRateToTwd: number;
}

interface LotState {
  lotId: string;
  key: string;
  market: InvestmentMarket;
  symbol: string;
  companyName: string;
  tradeCurrency: SupportedCurrency;
  fxRateToTwd: number;
  buyDate: string;
  remainingQuantity: number;
  remainingCostTrade: number;
  remainingCostTwd: number;
  unitCostTrade: number;
  unitCostTwd: number;
}

interface LotDetail extends LotState {
  marketPriceTrade: number;
  marketValueTrade: number;
  marketValueTwd: number;
  unrealizedPnlTrade: number;
  unrealizedPnlTwd: number;
  unrealizedReturnPct: number;
  currentFxRateToTwd: number;
}

interface SellAllocationEntry {
  lotId: string;
  quantity: number;
}

interface TradeFormState {
  date: string;
  market: InvestmentMarket;
  symbol: string;
  companyName: string;
  quantity: string;
  price: string;
  feeAmount: string;
  fxRateToTwd: string;
  totalAmount: string;
  action: 'BUY' | 'SELL';
}

interface SellFormState {
  date: string;
  quantity: string;
  price: string;
  feeAmount: string;
  fxRateToTwd: string;
  totalAmount: string;
}

const createEmptyTradeForm = (): TradeFormState => ({
  date: new Date().toISOString().split('T')[0],
  market: 'TW',
  symbol: '',
  companyName: '',
  quantity: '',
  price: '',
  feeAmount: '',
  fxRateToTwd: '',
  totalAmount: '',
  action: 'BUY'
});

const createEmptySellForm = (): SellFormState => ({
  date: new Date().toISOString().split('T')[0],
  quantity: '',
  price: '',
  feeAmount: '',
  fxRateToTwd: '',
  totalAmount: ''
});

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

const stockGainTextClass = (value: number) => (value >= 0 ? 'text-rose-600' : 'text-emerald-600');
const stockActionBadgeClass = (action: 'BUY' | 'SELL') =>
  action === 'BUY' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600';
const stockTradeAmountClass = (action: 'BUY' | 'SELL') =>
  action === 'BUY' ? 'text-emerald-600' : 'text-rose-600';

const getHoldingKey = (market: InvestmentMarket, symbol: string) => `${market}:${symbol.trim().toUpperCase()}`;

const formatSignedCurrency = (value: number, currency: SupportedCurrency, digits = currency === 'USD' ? 2 : 0) => {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(value), currency, digits)}`;
};

const getTradePriceDigits = (currency: SupportedCurrency) => (currency === 'USD' ? 3 : 2);

const InvestmentRecord: React.FC<Props> = ({
  investments,
  prices,
  childId,
  childName,
  availableBalance,
  usdTwdReferenceRate,
  usdTwdReferenceUpdatedAt,
  onAdd,
  onEdit,
  onDelete,
  onRefreshPrices,
  isRefreshingPrices = false
}) => {
  const [viewMode, setViewMode] = useState<'HOLDINGS' | 'HISTORY'>('HOLDINGS');
  const [formError, setFormError] = useState<string | null>(null);
  const [sellError, setSellError] = useState<string | null>(null);
  const [sellingHolding, setSellingHolding] = useState<HoldingSummary | null>(null);
  const [selectedSellLot, setSelectedSellLot] = useState<LotDetail | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [formFeeManuallyEdited, setFormFeeManuallyEdited] = useState(false);
  const [sellFeeManuallyEdited, setSellFeeManuallyEdited] = useState(false);
  const [formData, setFormData] = useState<TradeFormState>(createEmptyTradeForm);
  const [sellFormData, setSellFormData] = useState<SellFormState>(createEmptySellForm);

  const childInvestments = useMemo(
    () => investments.filter((item) => item.childId === childId),
    [investments, childId]
  );

  const sortedHistory = useMemo(
    () => [...childInvestments].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [childInvestments]
  );

  const priceByKey = useMemo(() => {
    const map = new Map<string, Price>();
    prices.forEach((item) => {
      if (!item.symbol) return;
      const market = item.market || 'TW';
      map.set(getHoldingKey(market, item.symbol), item);
    });
    return map;
  }, [prices]);

  const stockReference = useMemo(() => {
    const map = new Map<string, { market: InvestmentMarket; symbol: string; companyName: string }>();

    prices.forEach((item) => {
      const symbol = item.symbol?.trim().toUpperCase();
      const companyName = item.companyName?.trim();
      const market = item.market || 'TW';
      if (!symbol || !companyName) return;
      map.set(`${market}|${symbol}|${companyName.toLowerCase()}`, { market, symbol, companyName });
    });

    investments.forEach((item) => {
      const symbol = item.symbol?.trim().toUpperCase();
      const companyName = item.companyName?.trim();
      const market = item.market || 'TW';
      if (!symbol || !companyName) return;
      if (companyName.toUpperCase() === symbol) return;
      map.set(`${market}|${symbol}|${companyName.toLowerCase()}`, { market, symbol, companyName });
    });

    return Array.from(map.values());
  }, [investments, prices]);

  const autofillCompanyName = (symbolRaw: string, market: InvestmentMarket) => {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) return;
    const normalizedSymbol = normalizeSymbolForMarket(symbol, market);
    const matchedNames = Array.from(
      new Set(
        stockReference
          .filter((row) => row.market === market && row.symbol === normalizedSymbol)
          .map((row) => row.companyName)
      )
    );
    if (matchedNames.length !== 1) return;
    setFormData((prev) => (prev.companyName.trim() ? prev : { ...prev, symbol: normalizedSymbol, companyName: matchedNames[0] }));
  };

  const autofillSymbol = (nameRaw: string, market: InvestmentMarket) => {
    const name = nameRaw.trim().toLowerCase();
    if (!name) return;
    const matchedSymbols = Array.from(
      new Set(
        stockReference
          .filter((row) => row.market === market && row.companyName.trim().toLowerCase() === name)
          .map((row) => row.symbol)
      )
    );
    if (matchedSymbols.length !== 1) return;
    setFormData((prev) => (prev.symbol.trim() ? prev : { ...prev, symbol: matchedSymbols[0] }));
  };

  useEffect(() => {
    if (!formData.symbol.trim()) return;
    const timer = window.setTimeout(() => autofillCompanyName(formData.symbol, formData.market), 300);
    return () => window.clearTimeout(timer);
  }, [formData.market, formData.symbol, stockReference]);

  useEffect(() => {
    if (!formData.companyName.trim()) return;
    const timer = window.setTimeout(() => autofillSymbol(formData.companyName, formData.market), 300);
    return () => window.clearTimeout(timer);
  }, [formData.companyName, formData.market, stockReference]);

  useEffect(() => {
    const quantity = Number(formData.quantity);
    const price = Number(formData.price);
    const market = formData.market;

    if (!(quantity > 0 && price > 0)) {
      setFormData((prev) => ({ ...prev, feeAmount: '', totalAmount: '' }));
      return;
    }

    const estimatedFee = calculateEstimatedFee({
      market,
      action: formData.action,
      quantity,
      price,
      broker: market === 'US' ? DEFAULT_US_BROKER : '',
      orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
    });
    const hasManualFee = formFeeManuallyEdited && formData.feeAmount.trim() !== '';
    const feeAmount = Number(formData.feeAmount);
    const effectiveFee = hasManualFee && Number.isFinite(feeAmount) && feeAmount >= 0 ? feeAmount : estimatedFee;
    const totalAmount = calculateTradeTotal({
      market,
      quantity,
      price,
      action: formData.action,
      feeAmount: effectiveFee,
      broker: market === 'US' ? DEFAULT_US_BROKER : '',
      orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
    });

    setFormData((prev) => ({
      ...prev,
      feeAmount: effectiveFee.toString(),
      totalAmount: totalAmount.toString(),
      fxRateToTwd: market === 'TW' ? '1' : (prev.fxRateToTwd || (usdTwdReferenceRate > 0 ? usdTwdReferenceRate.toString() : ''))
    }));
  }, [formData.action, formData.market, formData.price, formData.quantity, formData.feeAmount, formFeeManuallyEdited, usdTwdReferenceRate]);

  useEffect(() => {
    if (!sellingHolding) return;
    const quantity = Number(sellFormData.quantity);
    const price = Number(sellFormData.price);

    if (!(quantity > 0 && price > 0)) {
      setSellFormData((prev) => ({ ...prev, feeAmount: '', totalAmount: '' }));
      return;
    }

    const estimatedFee = calculateEstimatedFee({
      market: sellingHolding.market,
      action: 'SELL',
      quantity,
      price,
      broker: sellingHolding.market === 'US' ? DEFAULT_US_BROKER : '',
      orderChannel: sellingHolding.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
    });
    const hasManualFee = sellFeeManuallyEdited && sellFormData.feeAmount.trim() !== '';
    const feeAmount = Number(sellFormData.feeAmount);
    const effectiveFee = hasManualFee && Number.isFinite(feeAmount) && feeAmount >= 0 ? feeAmount : estimatedFee;
    const totalAmount = calculateTradeTotal({
      market: sellingHolding.market,
      quantity,
      price,
      action: 'SELL',
      feeAmount: effectiveFee,
      broker: sellingHolding.market === 'US' ? DEFAULT_US_BROKER : '',
      orderChannel: sellingHolding.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
    });

    setSellFormData((prev) => ({
      ...prev,
      feeAmount: effectiveFee.toString(),
      totalAmount: totalAmount.toString(),
      fxRateToTwd: sellingHolding.market === 'TW' ? '1' : (prev.fxRateToTwd || (sellingHolding.currentFxRateToTwd > 0 ? sellingHolding.currentFxRateToTwd.toString() : (usdTwdReferenceRate > 0 ? usdTwdReferenceRate.toString() : '')))
    }));
  }, [sellFormData.price, sellFormData.quantity, sellFormData.feeAmount, sellFeeManuallyEdited, sellingHolding, usdTwdReferenceRate]);

  const {
    holdings,
    totalRealizedPnlTwd,
    totalUnrealizedPnlTwd,
    totalRealizedPnlUsd,
    totalUnrealizedPnlUsd,
    lotDetailsByKey
  } = useMemo(() => {
    const openLotsByKey = new Map<string, LotState[]>();
    const realizedByKey = new Map<string, { trade: number; twd: number; currency: SupportedCurrency }>();
    const sorted = [...childInvestments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    sorted.forEach((inv) => {
      const market = inv.market || 'TW';
      const key = getHoldingKey(market, inv.symbol);
      const currency = inv.tradeCurrency || getMarketTradeCurrency(market);
      const lots = openLotsByKey.get(key) || [];

      if (inv.action === 'BUY') {
        lots.push({
          lotId: inv.id,
          key,
          market,
          symbol: inv.symbol.toUpperCase(),
          companyName: inv.companyName?.trim() || inv.symbol.toUpperCase(),
          tradeCurrency: currency,
          fxRateToTwd: Number(inv.fxRateToTwd || (market === 'US' ? 0 : 1)),
          buyDate: inv.date,
          remainingQuantity: inv.quantity,
          remainingCostTrade: inv.totalAmount,
          remainingCostTwd: Number(inv.netAmountTwd || 0),
          unitCostTrade: inv.quantity > 0 ? inv.totalAmount / inv.quantity : 0,
          unitCostTwd: inv.quantity > 0 ? Number(inv.netAmountTwd || 0) / inv.quantity : 0
        });
        openLotsByKey.set(key, lots);
        return;
      }

      let remainingToSell = inv.quantity;
      let soldCostTrade = 0;
      let soldCostTwd = 0;
      const specifiedAllocations = parseSellAllocations(inv.sellAllocations);
      let candidateLots: LotState[] = [];

      if (inv.sellStrategy === 'SPECIFIC' && specifiedAllocations.length > 0) {
        candidateLots = specifiedAllocations
          .map((allocation) => lots.find((lot) => lot.lotId === allocation.lotId))
          .filter((lot): lot is LotState => Boolean(lot));
      } else if (inv.sellStrategy === 'LOWEST_COST') {
        candidateLots = [...lots].sort((a, b) => a.unitCostTrade - b.unitCostTrade || a.buyDate.localeCompare(b.buyDate) || a.lotId.localeCompare(b.lotId));
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

        const costTradePortion = lot.unitCostTrade * allowedQuantity;
        const costTwdPortion = lot.unitCostTwd * allowedQuantity;
        lot.remainingQuantity -= allowedQuantity;
        lot.remainingCostTrade = Math.max(0, lot.remainingCostTrade - costTradePortion);
        lot.remainingCostTwd = Math.max(0, lot.remainingCostTwd - costTwdPortion);
        if (lot.remainingQuantity <= 0) {
          lot.remainingQuantity = 0;
          lot.remainingCostTrade = 0;
          lot.remainingCostTwd = 0;
        }
        remainingToSell -= allowedQuantity;
        soldCostTrade += costTradePortion;
        soldCostTwd += costTwdPortion;
      }

      const current = realizedByKey.get(key) || { trade: 0, twd: 0, currency };
      current.trade += inv.totalAmount - soldCostTrade;
      current.twd += Number(inv.netAmountTwd || 0) - soldCostTwd;
      realizedByKey.set(key, current);
      openLotsByKey.set(key, lots.filter((lot) => lot.remainingQuantity > 0));
    });

    const lotDetailsMap = new Map<string, LotDetail[]>();
    const holdingRows: HoldingSummary[] = [];

    Array.from(new Set([...openLotsByKey.keys(), ...realizedByKey.keys()])).forEach((key) => {
      const lots = (openLotsByKey.get(key) || []).filter((lot) => lot.remainingQuantity > 0);
      const priceRow = priceByKey.get(key);
      const market = lots[0]?.market || (priceRow?.market || 'TW');
      const currency = lots[0]?.tradeCurrency || (priceRow?.currency || getMarketTradeCurrency(market));
      const marketPriceTrade = Number(priceRow?.price || 0);
      const fallbackFxRate = lots.find((lot) => lot.fxRateToTwd > 0)?.fxRateToTwd || 0;
      const currentFxRateToTwd = market === 'US' ? getPriceFxRateToTwd(priceRow, usdTwdReferenceRate || fallbackFxRate) : 1;

      const detailedLots = lots
        .map((lot) => {
          const marketValueTrade = lot.remainingQuantity * marketPriceTrade;
          const estimatedSellTrade = marketPriceTrade > 0
            ? calculateTradeTotal({
                market,
                quantity: lot.remainingQuantity,
                price: marketPriceTrade,
                action: 'SELL',
                broker: market === 'US' ? DEFAULT_US_BROKER : '',
                orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
              })
            : lot.remainingCostTrade;
          const marketValueTwd = market === 'US' ? marketValueTrade * currentFxRateToTwd : marketValueTrade;
          const estimatedSellTwd = marketPriceTrade > 0
            ? calculateNetAmountTwd({
                market,
                totalAmount: estimatedSellTrade,
                fxRateToTwd: currentFxRateToTwd
              })
            : lot.remainingCostTwd;
          const unrealizedPnlTrade = marketPriceTrade > 0 ? estimatedSellTrade - lot.remainingCostTrade : 0;
          const unrealizedPnlTwd = marketPriceTrade > 0 ? estimatedSellTwd - lot.remainingCostTwd : 0;
          const unrealizedReturnPct = lot.remainingCostTwd > 0 ? (unrealizedPnlTwd / lot.remainingCostTwd) * 100 : 0;

          return {
            ...lot,
            marketPriceTrade,
            marketValueTrade,
            marketValueTwd,
            unrealizedPnlTrade,
            unrealizedPnlTwd,
            unrealizedReturnPct,
            currentFxRateToTwd
          };
        })
        .sort((a, b) => a.buyDate.localeCompare(b.buyDate) || a.lotId.localeCompare(b.lotId));

      if (detailedLots.length > 0) {
        lotDetailsMap.set(key, detailedLots);
      }

      const shares = detailedLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
      const costBasisTrade = detailedLots.reduce((sum, lot) => sum + lot.remainingCostTrade, 0);
      const costBasisTwd = detailedLots.reduce((sum, lot) => sum + lot.remainingCostTwd, 0);
      const marketValueTrade = detailedLots.reduce((sum, lot) => sum + lot.marketValueTrade, 0);
      const marketValueTwd = detailedLots.reduce((sum, lot) => sum + lot.marketValueTwd, 0);
      const estimatedSellTrade = marketPriceTrade > 0
        ? calculateTradeTotal({
            market,
            quantity: shares,
            price: marketPriceTrade,
            action: 'SELL',
            broker: market === 'US' ? DEFAULT_US_BROKER : '',
            orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC'
          })
        : costBasisTrade;
      const estimatedSellTwd = marketPriceTrade > 0
        ? calculateNetAmountTwd({
            market,
            totalAmount: estimatedSellTrade,
            fxRateToTwd: currentFxRateToTwd
          })
        : costBasisTwd;
      const unrealizedPnlTrade = marketPriceTrade > 0 ? estimatedSellTrade - costBasisTrade : 0;
      const unrealizedPnlTwd = marketPriceTrade > 0 ? estimatedSellTwd - costBasisTwd : 0;
      const unrealizedReturnPct = costBasisTwd > 0 ? (unrealizedPnlTwd / costBasisTwd) * 100 : 0;
      const realized = realizedByKey.get(key) || { trade: 0, twd: 0, currency };

      if (shares > 0) {
        holdingRows.push({
          key,
          market,
          symbol: detailedLots[0]?.symbol || key.split(':')[1],
          companyName: priceRow?.companyName || detailedLots[0]?.companyName || key.split(':')[1],
          tradeCurrency: currency,
          shares,
          avgCostTrade: shares > 0 ? costBasisTrade / shares : 0,
          costBasisTrade,
          costBasisTwd,
          marketPriceTrade,
          marketValueTrade,
          marketValueTwd,
          unrealizedPnlTrade,
          unrealizedPnlTwd,
          unrealizedReturnPct,
          realizedPnlTrade: realized.trade,
          realizedPnlTwd: realized.twd,
          currentFxRateToTwd
        });
      }
    });

    return {
      holdings: holdingRows.sort((a, b) => b.marketValueTwd - a.marketValueTwd),
      totalRealizedPnlTwd: Array.from(realizedByKey.values()).reduce((sum, item) => sum + item.twd, 0),
      totalUnrealizedPnlTwd: holdingRows.reduce((sum, holding) => sum + holding.unrealizedPnlTwd, 0),
      totalRealizedPnlUsd: Array.from(realizedByKey.values())
        .filter((item) => item.currency === 'USD')
        .reduce((sum, item) => sum + item.trade, 0),
      totalUnrealizedPnlUsd: holdingRows.filter((item) => item.market === 'US').reduce((sum, holding) => sum + holding.unrealizedPnlTrade, 0),
      lotDetailsByKey: lotDetailsMap
    };
  }, [childInvestments, priceByKey, usdTwdReferenceRate]);

  const currentDetailLots = detailKey ? (lotDetailsByKey.get(detailKey) || []) : [];

  const formPreview = useMemo(() => {
    const quantity = Number(formData.quantity);
    const price = Number(formData.price);
    const feeAmount = Number(formData.feeAmount || 0);
    const totalAmount = Number(formData.totalAmount || 0);
    const fxRateToTwd = Number(formData.fxRateToTwd || (formData.market === 'TW' ? 1 : 0));
    const grossAmount = quantity > 0 && price > 0 ? quantity * price : 0;
    const netAmountTwd = calculateNetAmountTwd({
      market: formData.market,
      totalAmount,
      fxRateToTwd
    });

    return { grossAmount, feeAmount, totalAmount, netAmountTwd, fxRateToTwd };
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const quantity = Number(formData.quantity);
    const price = Number(formData.price);
    const feeAmount = Number(formData.feeAmount);
    const totalAmount = Number(formData.totalAmount);
    const market = formData.market;
    const fxRateToTwd = Number(formData.fxRateToTwd || (market === 'TW' ? 1 : 0));

    if (!formData.symbol || !formData.companyName || !(quantity > 0) || !(price > 0) || !Number.isFinite(totalAmount)) {
      setFormError('請完整填寫市場、股票代碼、名稱、股數、成交單價與成交總額');
      return;
    }

    if (market === 'US' && !(fxRateToTwd > 0)) {
      setFormError('請填寫美股成交匯率');
      return;
    }

    try {
      await onAdd({
        id: Date.now().toString(),
        childId,
        date: formData.date,
        market,
        symbol: normalizeSymbolForMarket(formData.symbol, market),
        companyName: formData.companyName.trim() || normalizeSymbolForMarket(formData.symbol, market),
        quantity,
        price,
        totalAmount,
        action: formData.action,
        broker: market === 'US' ? DEFAULT_US_BROKER : '',
        orderChannel: market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC',
        tradeCurrency: getMarketTradeCurrency(market),
        settlementCurrency: 'TWD',
        fxRateToTwd: market === 'US' ? fxRateToTwd : 1,
        feeAmount: Number.isFinite(feeAmount) ? feeAmount : 0,
        feeCurrency: getMarketTradeCurrency(market),
        netAmountTwd: calculateNetAmountTwd({
          market,
          totalAmount,
          fxRateToTwd: market === 'US' ? fxRateToTwd : 1
        }),
        sellStrategy: formData.action === 'SELL' ? 'LOWEST_COST' : undefined
      });
      setFormError(null);
      setFormFeeManuallyEdited(false);
      setFormData(createEmptyTradeForm());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '新增成交失敗');
    }
  };

  const openSellModal = (holding: HoldingSummary) => {
    setSellingHolding(holding);
    setSelectedSellLot(null);
    setSellError(null);
    setSellFeeManuallyEdited(false);
    setSellFormData({
      date: new Date().toISOString().split('T')[0],
      quantity: holding.shares.toString(),
      price: holding.marketPriceTrade > 0 ? holding.marketPriceTrade.toString() : '',
      feeAmount: '',
      fxRateToTwd: holding.market === 'US' && holding.currentFxRateToTwd > 0 ? holding.currentFxRateToTwd.toString() : '1',
      totalAmount: ''
    });
  };

  const openSpecificLotSellModal = (lot: LotDetail) => {
    const holding = holdings.find((item) => item.key === lot.key);
    if (!holding) return;
    setSellingHolding(holding);
    setSelectedSellLot(lot);
    setSellError(null);
    setSellFeeManuallyEdited(false);
    setSellFormData({
      date: new Date().toISOString().split('T')[0],
      quantity: lot.remainingQuantity.toString(),
      price: lot.marketPriceTrade > 0 ? lot.marketPriceTrade.toString() : '',
      feeAmount: '',
      fxRateToTwd: lot.market === 'US' && lot.currentFxRateToTwd > 0 ? lot.currentFxRateToTwd.toString() : '1',
      totalAmount: ''
    });
  };

  const closeSellModal = () => {
    setSellingHolding(null);
    setSelectedSellLot(null);
    setSellError(null);
    setSellFeeManuallyEdited(false);
    setSellFormData(createEmptySellForm());
  };

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellingHolding) return;

    const quantity = Number(sellFormData.quantity);
    const price = Number(sellFormData.price);
    const feeAmount = Number(sellFormData.feeAmount);
    const totalAmount = Number(sellFormData.totalAmount);
    const fxRateToTwd = Number(sellFormData.fxRateToTwd || (sellingHolding.market === 'TW' ? 1 : 0));

    if (!sellFormData.date || quantity <= 0 || price <= 0 || !Number.isFinite(totalAmount)) {
      setSellError('請完整填寫賣出日期、股數、成交單價與成交總額');
      return;
    }

    if (sellingHolding.market === 'US' && !(fxRateToTwd > 0)) {
      setSellError('請填寫美股賣出匯率');
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
        market: sellingHolding.market,
        symbol: sellingHolding.symbol,
        companyName: sellingHolding.companyName || sellingHolding.symbol,
        quantity,
        price,
        totalAmount,
        action: 'SELL',
        broker: sellingHolding.market === 'US' ? DEFAULT_US_BROKER : '',
        orderChannel: sellingHolding.market === 'US' ? DEFAULT_US_ORDER_CHANNEL : 'ELECTRONIC',
        tradeCurrency: sellingHolding.tradeCurrency,
        settlementCurrency: 'TWD',
        fxRateToTwd: sellingHolding.market === 'US' ? fxRateToTwd : 1,
        feeAmount: Number.isFinite(feeAmount) ? feeAmount : 0,
        feeCurrency: sellingHolding.tradeCurrency,
        netAmountTwd: calculateNetAmountTwd({
          market: sellingHolding.market,
          totalAmount,
          fxRateToTwd: sellingHolding.market === 'US' ? fxRateToTwd : 1
        }),
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
            <p className="text-slate-400 font-bold text-sm break-words">支援台股與美股，主卡以台幣顯示整體損益</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 lg:gap-10 text-left sm:text-right">
          <div className="min-w-0">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">目前可用資金</p>
            <p className={`text-3xl font-black break-all ${availableBalance < 0 ? 'text-rose-500' : 'text-blue-600'}`}>
              {formatCurrency(availableBalance, 'TWD')}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">已實現損益（台幣）</p>
            <p className={`text-3xl font-black break-all ${stockGainTextClass(totalRealizedPnlTwd)}`}>
              {formatSignedCurrency(totalRealizedPnlTwd, 'TWD')}
            </p>
            <p className="text-xs font-bold text-slate-400 mt-2">美股原幣：{formatSignedCurrency(totalRealizedPnlUsd, 'USD', 2)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">未實現損益（台幣）</p>
            <p className={`text-3xl font-black break-all ${stockGainTextClass(totalUnrealizedPnlTwd)}`}>
              {formatSignedCurrency(totalUnrealizedPnlTwd, 'TWD')}
            </p>
            <p className="text-xs font-bold text-slate-400 mt-2">美股原幣：{formatSignedCurrency(totalUnrealizedPnlUsd, 'USD', 2)}</p>
            {usdTwdReferenceRate > 0 && (
              <p className="text-xs font-bold text-slate-400 mt-1">
                參考匯率：{usdTwdReferenceRate.toFixed(3)}
                {usdTwdReferenceUpdatedAt ? `｜更新於 ${usdTwdReferenceUpdatedAt.replace('T', ' ').slice(0, 16)}` : ''}
              </p>
            )}
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
              onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">市場</label>
            <select
              value={formData.market}
              onChange={(e) => setFormData((prev) => ({
                ...prev,
                market: e.target.value as InvestmentMarket,
                feeAmount: '',
                totalAmount: '',
                symbol: '',
                companyName: '',
                price: '',
                quantity: '',
                action: 'BUY',
                fxRateToTwd: e.target.value === 'US' ? prev.fxRateToTwd : '1'
              }))}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            >
              <option value="TW">台股</option>
              <option value="US">美股</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股票代碼</label>
            <input
              placeholder={formData.market === 'US' ? '例如 AAPL' : '例如 2330'}
              value={formData.symbol}
              onChange={(e) => setFormData((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
              onBlur={(e) => autofillCompanyName(e.target.value, formData.market)}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股票名稱</label>
            <input
              placeholder={formData.market === 'US' ? '例如 Apple' : '例如 台積電'}
              value={formData.companyName}
              onChange={(e) => setFormData((prev) => ({ ...prev, companyName: e.target.value }))}
              onBlur={(e) => autofillSymbol(e.target.value, formData.market)}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-1">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">股數</label>
            <input
              type="number"
              placeholder="0"
              value={formData.quantity}
              onChange={(e) => setFormData((prev) => ({ ...prev, quantity: e.target.value }))}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-1">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">
              成交單價（{formData.market === 'US' ? 'USD' : 'TWD'}）
            </label>
            <input
              type="number"
              step={formData.market === 'US' ? '0.001' : '0.01'}
              placeholder="0"
              value={formData.price}
              onChange={(e) => setFormData((prev) => ({ ...prev, price: e.target.value }))}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-1">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">
              手續費（{formData.market === 'US' ? 'USD' : 'TWD'}）
            </label>
            <input
              type="number"
              step="0.01"
              placeholder="自動估算"
              value={formData.feeAmount}
              onChange={(e) => {
                setFormFeeManuallyEdited(true);
                setFormData((prev) => ({ ...prev, feeAmount: e.target.value }));
              }}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          {formData.market === 'US' && (
            <div className="flex flex-col gap-2 lg:col-span-1">
              <label className="text-xs font-black text-slate-400 uppercase ml-1">匯率（TWD/USD）</label>
              <input
                type="number"
                step="0.001"
                placeholder="例如 32.450"
                value={formData.fxRateToTwd}
                onChange={(e) => setFormData((prev) => ({ ...prev, fxRateToTwd: e.target.value }))}
                className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
              />
            </div>
          )}
          <div className={`flex flex-col gap-2 ${formData.market === 'US' ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <label className="text-xs font-black text-slate-400 uppercase ml-1">成交總額（含手續費）</label>
            <input
              type="number"
              step="0.01"
              placeholder="自動計算"
              value={formData.totalAmount}
              onChange={(e) => setFormData((prev) => ({ ...prev, totalAmount: e.target.value }))}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-2 lg:col-span-1">
            <label className="text-xs font-black text-slate-400 uppercase ml-1">動作</label>
            <select
              value={formData.action}
              onChange={(e) => setFormData((prev) => ({ ...prev, action: e.target.value as 'BUY' | 'SELL' }))}
              className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700"
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
        {formData.market === 'US' && (
          <p className="mt-3 text-xs font-bold text-slate-400">預設券商：{DEFAULT_US_BROKER}｜預設下單方式：電子下單</p>
        )}
        {formError && <p className="mt-4 text-sm font-bold text-rose-600">{formError}</p>}
      </form>

      <div className="bg-white rounded-[3rem] shadow-sm overflow-hidden border border-slate-100">
        <div className="p-8 border-b border-slate-50 bg-slate-50/30 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center gap-3">
            <h3 className="font-black text-slate-800 text-xl">{viewMode === 'HOLDINGS' ? '持倉總覽' : '歷史成交清單'}</h3>
            {viewMode === 'HOLDINGS' && (
              <button
                type="button"
                onClick={() => void onRefreshPrices()}
                disabled={isRefreshingPrices}
                className="inline-flex items-center justify-center rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                title="重新整理股價"
                aria-label="重新整理股價"
              >
                <RefreshCcw className={`h-4 w-4 ${isRefreshingPrices ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
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
                  <th className="px-8 py-5 text-right">台幣成本</th>
                  <th className="px-8 py-5 text-right">現價</th>
                  <th className="px-8 py-5 text-right">台幣市值</th>
                  <th className="px-8 py-5 text-right">未實現損益（台幣）</th>
                  <th className="px-8 py-5 text-right">報酬率</th>
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
                    <tr key={holding.key} className="hover:bg-slate-50/50 transition">
                      <td className="px-8 py-6">
                        <div>
                          <p className="font-black text-slate-800 text-lg">{holding.symbol}</p>
                          <p className="text-xs font-bold text-slate-400">{holding.companyName}</p>
                          <p className="text-[11px] font-bold text-slate-400 mt-1">{holding.market === 'US' ? '美股' : '台股'}</p>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right font-black text-slate-700">{holding.shares.toLocaleString()} 股</td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">
                        {formatCurrency(holding.avgCostTrade, holding.tradeCurrency, getTradePriceDigits(holding.tradeCurrency))}
                      </td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">{formatCurrency(holding.costBasisTwd, 'TWD')}</td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">
                        {holding.marketPriceTrade > 0 ? formatCurrency(holding.marketPriceTrade, holding.tradeCurrency, getTradePriceDigits(holding.tradeCurrency)) : '-'}
                      </td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">
                        {holding.marketPriceTrade > 0 ? formatCurrency(holding.marketValueTwd, 'TWD') : '-'}
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black ${stockGainTextClass(holding.unrealizedPnlTwd)}`}>
                        {holding.marketPriceTrade > 0 ? formatSignedCurrency(holding.unrealizedPnlTwd, 'TWD') : '-'}
                        {holding.market === 'US' && holding.marketPriceTrade > 0 && (
                          <p className="text-xs font-bold text-slate-400 mt-1">{formatSignedCurrency(holding.unrealizedPnlTrade, 'USD', 2)}</p>
                        )}
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black ${stockGainTextClass(holding.unrealizedReturnPct)}`}>
                        {holding.marketPriceTrade > 0 ? `${holding.unrealizedReturnPct >= 0 ? '+' : ''}${holding.unrealizedReturnPct.toFixed(2)}%` : '-'}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailKey(holding.key)}
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
                  <th className="px-8 py-5">數量 / 單價</th>
                  <th className="px-8 py-5 text-right">成交總額</th>
                  <th className="px-8 py-5 text-right">台幣成本 / 入帳</th>
                  <th className="px-8 py-5 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-8 py-20 text-center text-slate-300 italic font-bold">尚無投資紀錄</td>
                  </tr>
                ) : (
                  sortedHistory.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50 transition group">
                      <td className="px-8 py-6 text-sm font-bold text-slate-500">{inv.date}</td>
                      <td className="px-8 py-6">
                        <p className="font-black text-slate-800 text-lg">{inv.symbol}</p>
                        <p className="text-xs font-bold text-slate-400">{inv.companyName}</p>
                        <p className="text-[11px] font-bold text-slate-400 mt-1">{inv.market === 'US' ? '美股' : '台股'}</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase ${stockActionBadgeClass(inv.action)}`}>
                          {inv.action === 'BUY' ? '買入' : '賣出'}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-slate-700">{inv.quantity.toLocaleString()} 股</p>
                        <p className="text-xs text-slate-400 font-bold">
                          {formatCurrency(
                            inv.price,
                            inv.tradeCurrency || getMarketTradeCurrency(inv.market || 'TW'),
                            getTradePriceDigits(inv.tradeCurrency || getMarketTradeCurrency(inv.market || 'TW'))
                          )}
                        </p>
                      </td>
                      <td className={`px-8 py-6 text-right font-mono font-black text-xl ${stockTradeAmountClass(inv.action)}`}>
                        {inv.action === 'BUY' ? '-' : '+'}
                        {formatCurrency(inv.totalAmount, inv.tradeCurrency || getMarketTradeCurrency(inv.market || 'TW'), (inv.tradeCurrency || getMarketTradeCurrency(inv.market || 'TW')) === 'USD' ? 2 : 0)}
                      </td>
                      <td className="px-8 py-6 text-right font-mono font-black text-slate-700">
                        {inv.action === 'BUY' ? '-' : '+'}
                        {formatCurrency(inv.netAmountTwd || 0, 'TWD')}
                        {inv.market === 'US' && (
                          <p className="text-xs font-bold text-slate-400 mt-1">匯率 {Number(inv.fxRateToTwd || 0).toFixed(3)}</p>
                        )}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => onEdit(inv)} className="p-2.5 text-slate-400 hover:text-blue-600 bg-white rounded-xl shadow-sm border border-slate-100 hover:border-blue-200 transition">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (!window.confirm(`確定要刪除 ${inv.symbol} 這筆${inv.action === 'BUY' ? '買入' : '賣出'}紀錄嗎？此動作無法撤回。`)) return;
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
              <button type="button" onClick={closeSellModal} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSellSubmit} className="p-8 space-y-6">
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                <p className="text-sm font-bold text-slate-600">
                  {selectedSellLot
                    ? `你正在指定賣出 ${selectedSellLot.buyDate} 買入的 lot。預設股數為該 lot 目前持有的 ${selectedSellLot.remainingQuantity.toLocaleString()} 股。`
                    : `是否賣出此標的？預設股數為目前持有的 ${sellingHolding.shares.toLocaleString()} 股。`}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">賣出日期</label>
                  <input type="date" value={sellFormData.date} onChange={(e) => setSellFormData((prev) => ({ ...prev, date: e.target.value }))} className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">股數</label>
                  <input type="number" min="1" max={selectedSellLot ? selectedSellLot.remainingQuantity : sellingHolding.shares} value={sellFormData.quantity} onChange={(e) => setSellFormData((prev) => ({ ...prev, quantity: e.target.value }))} className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">成交單價</label>
                  <input type="number" min="0" step={sellingHolding.market === 'US' ? '0.001' : '0.01'} value={sellFormData.price} onChange={(e) => setSellFormData((prev) => ({ ...prev, price: e.target.value }))} className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">手續費</label>
                  <input type="number" min="0" step="0.01" value={sellFormData.feeAmount} onChange={(e) => {
                    setSellFeeManuallyEdited(true);
                    setSellFormData((prev) => ({ ...prev, feeAmount: e.target.value }));
                  }} className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1">成交總額</label>
                  <input type="number" min="0" step="0.01" value={sellFormData.totalAmount} onChange={(e) => setSellFormData((prev) => ({ ...prev, totalAmount: e.target.value }))} className="border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700" />
                </div>
              </div>

              {sellingHolding.market === 'US' && (
                <div className="max-w-xs">
                  <label className="text-xs font-black text-slate-400 uppercase ml-1 block mb-2">賣出匯率（TWD/USD）</label>
                  <input type="number" min="0" step="0.001" value={sellFormData.fxRateToTwd} onChange={(e) => setSellFormData((prev) => ({ ...prev, fxRateToTwd: e.target.value }))} className="w-full border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-orange-500 focus:outline-none font-bold text-slate-700" />
                </div>
              )}

              {sellError && <p className="text-sm font-bold text-rose-600">{sellError}</p>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeSellModal} className="px-5 py-3 rounded-2xl font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition">取消</button>
                <button type="submit" className="px-6 py-3 rounded-2xl font-black text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-lg shadow-emerald-100">確認賣出</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailKey && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="flex min-h-full items-center justify-center py-2 sm:py-4">
            <div className="flex w-full max-w-6xl max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-2xl sm:max-h-[calc(100vh-4rem)]">
              <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{currentDetailLots[0]?.symbol || ''} 持倉明細</h3>
                  <p className="text-sm font-bold text-slate-400">顯示目前仍持有的 lot 組成，可從這裡指定批次賣出。</p>
                </div>
                <button type="button" onClick={() => setDetailKey(null)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                      <tr>
                        <th className="px-6 py-4">標的</th>
                        <th className="px-6 py-4 text-right">持有股數</th>
                        <th className="px-6 py-4 text-right">買入股價</th>
                        <th className="px-6 py-4 text-right">台幣成本</th>
                        <th className="px-6 py-4 text-right">現價</th>
                        <th className="px-6 py-4 text-right">台幣市值</th>
                        <th className="px-6 py-4 text-right">未實現損益（台幣）</th>
                        <th className="px-6 py-4 text-right">報酬率</th>
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
                            <td className="px-6 py-5 text-right font-mono font-black text-slate-700">
                              {formatCurrency(lot.unitCostTrade, lot.tradeCurrency, getTradePriceDigits(lot.tradeCurrency))}
                            </td>
                            <td className="px-6 py-5 text-right font-mono font-black text-slate-700">{formatCurrency(lot.remainingCostTwd, 'TWD')}</td>
                            <td className="px-6 py-5 text-right font-mono font-black text-slate-700">
                              {lot.marketPriceTrade > 0 ? formatCurrency(lot.marketPriceTrade, lot.tradeCurrency, getTradePriceDigits(lot.tradeCurrency)) : '-'}
                            </td>
                            <td className="px-6 py-5 text-right font-mono font-black text-slate-700">
                              {lot.marketPriceTrade > 0 ? formatCurrency(lot.marketValueTwd, 'TWD') : '-'}
                            </td>
                            <td className={`px-6 py-5 text-right font-mono font-black ${stockGainTextClass(lot.unrealizedPnlTwd)}`}>
                              {lot.marketPriceTrade > 0 ? formatSignedCurrency(lot.unrealizedPnlTwd, 'TWD') : '-'}
                              {lot.market === 'US' && lot.marketPriceTrade > 0 && (
                                <p className="text-xs font-bold text-slate-400 mt-1">{formatSignedCurrency(lot.unrealizedPnlTrade, 'USD', 2)}</p>
                              )}
                            </td>
                            <td className={`px-6 py-5 text-right font-mono font-black ${stockGainTextClass(lot.unrealizedReturnPct)}`}>
                              {lot.marketPriceTrade > 0 ? `${lot.unrealizedReturnPct >= 0 ? '+' : ''}${lot.unrealizedReturnPct.toFixed(2)}%` : '-'}
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center justify-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDetailKey(null);
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
          </div>
        </div>
      )}
    </div>
  );
};

export default InvestmentRecord;
