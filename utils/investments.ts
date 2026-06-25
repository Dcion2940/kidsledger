import { Investment, InvestmentMarket, OrderChannel, Price, SupportedCurrency, TradeAction } from '../types';

export const TW_BUY_FEE_RATE = 0.001425;
export const TW_SELL_FEE_RATE = 0.004425;
export const ESUN_US_ELECTRONIC_FEE_RATE = 0.004;
export const ESUN_US_SELL_SEC_FEE_RATE = 0.0000206;

export const DEFAULT_US_BROKER = '玉山證券';
export const DEFAULT_US_ORDER_CHANNEL: OrderChannel = 'ELECTRONIC';

export const normalizeSymbolForMarket = (symbol: string, market: InvestmentMarket) => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (market === 'US') {
    return normalized.replace(/\.(US|NYSE|NASDAQ|NASD)$/i, '');
  }
  return normalized.replace(/\.(TW|TWO)$/i, '');
};

export const normalizeInvestment = (item: any): Investment => {
  const market = String(item?.market || 'TW').toUpperCase() === 'US' ? 'US' : 'TW';
  const tradeCurrency: SupportedCurrency =
    String(item?.tradeCurrency || (market === 'US' ? 'USD' : 'TWD')).toUpperCase() === 'USD' ? 'USD' : 'TWD';
  const settlementCurrency: SupportedCurrency =
    String(item?.settlementCurrency || 'TWD').toUpperCase() === 'USD' ? 'USD' : 'TWD';
  const feeCurrency: SupportedCurrency =
    String(item?.feeCurrency || tradeCurrency).toUpperCase() === 'USD' ? 'USD' : 'TWD';
  const fxRateToTwd = Number(item?.fxRateToTwd);
  const netAmountTwd = Number(item?.netAmountTwd);
  const normalizedFxRateToTwd = Number.isFinite(fxRateToTwd) && fxRateToTwd > 0 ? fxRateToTwd : market === 'US' ? 0 : 1;
  const fallbackNetAmountTwd = totalAmountToTwd(Number(item?.totalAmount || 0), market, normalizedFxRateToTwd);

  const rawSellStrategy = String(item?.sellStrategy || '').trim();
  const sellStrategy =
    rawSellStrategy === 'FIFO' || rawSellStrategy === 'LOWEST_COST' || rawSellStrategy === 'SPECIFIC'
      ? rawSellStrategy
      : undefined;

  return {
    id: String(item?.id || ''),
    childId: String(item?.childId || ''),
    date: String(item?.date || ''),
    market,
    symbol: normalizeSymbolForMarket(String(item?.symbol || ''), market),
    companyName: String(item?.companyName || ''),
    quantity: Number(item?.quantity || 0),
    price: Number(item?.price || 0),
    totalAmount: Number(item?.totalAmount || 0),
    action: String(item?.action || '') as TradeAction,
    broker: String(item?.broker || ''),
    orderChannel: String(item?.orderChannel || '') === 'MANUAL' ? 'MANUAL' : 'ELECTRONIC',
    tradeCurrency,
    settlementCurrency,
    fxRateToTwd: normalizedFxRateToTwd,
    feeAmount: Number(item?.feeAmount || 0),
    feeCurrency,
    netAmountTwd: Number.isFinite(netAmountTwd) && netAmountTwd > 0
      ? netAmountTwd
      : fallbackNetAmountTwd,
    sellStrategy,
    sellAllocations: String(item?.sellAllocations || '') || undefined
  };
};

export const normalizePrice = (item: any): Price => {
  const market = String(item?.market || 'TW').toUpperCase() === 'US' ? 'US' : 'TW';
  const currency: SupportedCurrency =
    String(item?.currency || (market === 'US' ? 'USD' : 'TWD')).toUpperCase() === 'USD' ? 'USD' : 'TWD';
  const fxRateToTwd = Number(item?.fxRateToTwd);

  return {
    symbol: normalizeSymbolForMarket(String(item?.symbol || ''), market),
    companyName: String(item?.companyName || ''),
    market,
    currency,
    price: Number(item?.price || 0),
    fxRateToTwd: Number.isFinite(fxRateToTwd) && fxRateToTwd > 0 ? fxRateToTwd : market === 'US' ? 0 : 1,
    updatedAt: String(item?.updatedAt || '')
  };
};

export const getMarketTradeCurrency = (market: InvestmentMarket): SupportedCurrency =>
  market === 'US' ? 'USD' : 'TWD';

export const totalAmountToTwd = (amount: number, market: InvestmentMarket, fxRateToTwd?: number) => {
  if (!Number.isFinite(amount)) return 0;
  if (market === 'US') {
    const fx = Number(fxRateToTwd);
    return Number.isFinite(fx) && fx > 0 ? amount * fx : 0;
  }
  return amount;
};

export const getPriceFxRateToTwd = (price?: Price, fallback = 0) => {
  const fx = Number(price?.fxRateToTwd);
  if (Number.isFinite(fx) && fx > 0) return fx;
  return fallback;
};

export const calculateEstimatedFee = ({
  market,
  action,
  quantity,
  price,
  broker,
  orderChannel
}: {
  market: InvestmentMarket;
  action: TradeAction;
  quantity: number;
  price: number;
  broker?: string;
  orderChannel?: OrderChannel;
}) => {
  if (quantity <= 0 || price <= 0) return 0;
  const grossAmount = quantity * price;

  if (market === 'US') {
    const normalizedBroker = String(broker || '').trim();
    const normalizedChannel = orderChannel || DEFAULT_US_ORDER_CHANNEL;
    if (normalizedBroker === DEFAULT_US_BROKER && normalizedChannel === 'ELECTRONIC') {
      const commission = grossAmount * ESUN_US_ELECTRONIC_FEE_RATE;
      const secFee = action === 'SELL' ? grossAmount * ESUN_US_SELL_SEC_FEE_RATE : 0;
      return roundUsd(commission + secFee);
    }
    return roundUsd(0);
  }

  const feeRate = action === 'BUY' ? TW_BUY_FEE_RATE : TW_SELL_FEE_RATE;
  return action === 'BUY'
    ? Math.floor(grossAmount * feeRate)
    : Math.ceil(grossAmount * feeRate);
};

export const calculateTradeTotal = ({
  market,
  quantity,
  price,
  action,
  feeAmount,
  broker,
  orderChannel
}: {
  market: InvestmentMarket;
  quantity: number;
  price: number;
  action: TradeAction;
  feeAmount?: number;
  broker?: string;
  orderChannel?: OrderChannel;
}) => {
  if (quantity <= 0 || price <= 0) return 0;
  const grossAmount = quantity * price;
  const fee = Number.isFinite(Number(feeAmount))
    ? Number(feeAmount)
    : calculateEstimatedFee({ market, action, quantity, price, broker, orderChannel });
  const total = action === 'BUY' ? grossAmount + fee : grossAmount - fee;

  if (market === 'US') {
    return roundUsd(total);
  }

  return action === 'BUY' ? Math.floor(total) : Math.ceil(total);
};

export const calculateNetAmountTwd = ({
  market,
  totalAmount,
  fxRateToTwd
}: {
  market: InvestmentMarket;
  totalAmount: number;
  fxRateToTwd?: number;
}) => totalAmountToTwd(totalAmount, market, fxRateToTwd);

export const formatCurrency = (value: number, currency: SupportedCurrency, digits = 0) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  const formatted = safeValue.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  return currency === 'USD' ? `USD ${formatted}` : formatted;
};

const roundUsd = (value: number) => Math.round(value * 100) / 100;
