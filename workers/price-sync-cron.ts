interface PriceSyncWorkerEnv {
  PRICE_SYNC_KEY?: string;
  PRICES_API_URL?: string;
  HOLIDAY_SCHEDULE_URL?: string;
  YAHOO_QUOTE_URL?: string;
  YAHOO_CHART_URL?: string;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface PriceRow {
  symbol: string;
  companyName: string;
  market?: 'TW' | 'US';
}

interface PriceUpdateItem extends PriceRow {
  currency: 'TWD' | 'USD';
  price: number;
  fxRateToTwd: number;
  updatedAt: string;
}

interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
}

interface SyncResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  checkedAt: string;
  tradingDate: string;
  tradingTime: string;
  symbols: number;
  updated: number;
  items?: PriceUpdateItem[];
}

const TIME_ZONE = 'Asia/Taipei';
const DEFAULT_PRICES_API_URL = 'https://kidsledger.pages.dev/api/prices';
const DEFAULT_HOLIDAY_SCHEDULE_URL = 'https://www.twse.com.tw/holidaySchedule/holidaySchedule';
const DEFAULT_YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const DEFAULT_YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HOLIDAY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const YAHOO_BATCH_SIZE = 10;
const YAHOO_MAX_RETRIES = 3;
const YAHOO_RETRY_BASE_DELAY_MS = 1200;

const holidayCache = new Map<number, { expiresAt: number; dates: Set<string> }>();

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });

const getTaipeiParts = (date: Date) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value || '';

  return {
    year: Number(lookup('year')),
    month: lookup('month'),
    day: lookup('day'),
    hh: lookup('hour'),
    mm: lookup('minute'),
    ss: lookup('second'),
    weekday: lookup('weekday')
  };
};

const getTradingClock = (date: Date) => {
  const parts = getTaipeiParts(date);
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hh}${parts.mm}`,
    weekday: parts.weekday
  };
};

const isWeekday = (weekday: string) => weekday !== 'Sat' && weekday !== 'Sun';

const isTradingTime = (hhmm: string) => hhmm >= '0900' && hhmm <= '1400';

const stripTags = (input: string) =>
  input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const shouldTreatAsHolidayRow = (name: string, description: string) => {
  const text = `${name} ${description}`;

  if (text.includes('開始交易') || text.includes('最後交易日')) {
    return false;
  }

  return text.includes('放假') || text.includes('不交易') || text.includes('市場無交易');
};

const parseHolidayHtml = (html: string) => {
  const dates = new Set<string>();
  const rowPattern = /<tr[\s\S]*?<\/tr>/gi;
  const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  for (const rowMatch of html.matchAll(rowPattern)) {
    const row = rowMatch[0];
    const cells: string[] = [];

    for (const cellMatch of row.matchAll(cellPattern)) {
      cells.push(stripTags(cellMatch[1]));
    }

    if (cells.length < 2) continue;

    const date = cells[0];
    const name = cells[1] || '';
    const description = cells[2] || '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (shouldTreatAsHolidayRow(name, description)) {
      dates.add(date);
    }
  }

  return dates;
};

const fetchTradingHolidays = async (env: PriceSyncWorkerEnv, year: number) => {
  const cached = holidayCache.get(year);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.dates;
  }

  const holidayScheduleUrl = String(env.HOLIDAY_SCHEDULE_URL || DEFAULT_HOLIDAY_SCHEDULE_URL).trim();
  const queryYear = String(year - 1911);
  const url = `${holidayScheduleUrl}?queryYear=${encodeURIComponent(queryYear)}&response=html`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  if (!response.ok) {
    throw new Error(`Holiday schedule ${response.status}`);
  }

  const html = await response.text();
  const dates = parseHolidayHtml(html);
  holidayCache.set(year, {
    expiresAt: Date.now() + HOLIDAY_CACHE_TTL_MS,
    dates
  });
  return dates;
};

const fetchSymbolsFromCloudflare = async (env: PriceSyncWorkerEnv) => {
  const pricesApiUrl = String(env.PRICES_API_URL || DEFAULT_PRICES_API_URL).trim();
  const response = await fetch(pricesApiUrl, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Prices API ${response.status}`);
  }

    const data = await response.json();
  const prices = Array.isArray(data?.prices) ? data.prices : [];

  return prices
    .map((item: any) => ({
      symbol: String(item?.symbol || '').trim().toUpperCase(),
      companyName: String(item?.companyName || '').trim(),
      market: String(item?.market || 'TW').trim().toUpperCase() === 'US' ? 'US' : 'TW'
    }))
    .filter((item: PriceRow) => item.symbol);
};

const chunk = <T>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const YAHOO_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com'
};

const getYahooQuerySymbols = (item: PriceRow) => {
  const market = item.market === 'US' ? 'US' : 'TW';
  const symbol = String(item.symbol || '').trim().toUpperCase();
  if (!symbol) return [];

  if (market === 'US') {
    return [symbol.replace(/\.(US|NYSE|NASDAQ|NASD)$/i, '')];
  }

  if (/\.(TW|TWO)$/i.test(symbol)) {
    return [symbol];
  }

  return [`${symbol}.TW`, `${symbol}.TWO`];
};

const fetchYahooBatchQuotes = async (yahooQuoteUrl: string, batch: PriceRow[]) => {
  const joinedSymbols = Array.from(
    new Set(batch.flatMap((item) => getYahooQuerySymbols(item)))
  ).join(',');
  const url = `${yahooQuoteUrl}?symbols=${encodeURIComponent(joinedSymbols)}`;

  for (let attempt = 0; attempt < YAHOO_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: YAHOO_HEADERS
    });

    if (response.ok) {
      const data = await response.json();
      return Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
    }

    if (response.status === 429 && attempt < YAHOO_MAX_RETRIES - 1) {
      const retryDelay = YAHOO_RETRY_BASE_DELAY_MS * (attempt + 1);
      await sleep(retryDelay);
      continue;
    }

    throw new Error(`Yahoo quote ${response.status}`);
  }

  return [];
};

const fetchYahooQuotes = async (env: PriceSyncWorkerEnv, symbols: PriceRow[]) => {
  const yahooQuoteUrl = String(env.YAHOO_QUOTE_URL || DEFAULT_YAHOO_QUOTE_URL).trim();
  const result = new Map<string, number>();
  const missingSymbols = new Set(symbols.map((item) => item.symbol));

  for (const batch of chunk(symbols, YAHOO_BATCH_SIZE)) {
    let quotes: any[] = [];
    try {
      quotes = await fetchYahooBatchQuotes(yahooQuoteUrl, batch);
    } catch {
      continue;
    }

    const requestedSymbolMap = new Map<string, string>();
    batch.forEach((item) => {
      getYahooQuerySymbols(item).forEach((querySymbol) => {
        requestedSymbolMap.set(querySymbol, item.symbol);
      });
    });

    quotes.forEach((quote: any) => {
      const yahooSymbol = String(quote?.symbol || '').trim().toUpperCase();
      const symbol = requestedSymbolMap.get(yahooSymbol) || yahooSymbol;
      const regularMarketPrice = Number(quote?.regularMarketPrice);
      const previousClose = Number(quote?.regularMarketPreviousClose);
      const fallbackClose = Number(quote?.postMarketPrice);

      const price = [regularMarketPrice, previousClose, fallbackClose].find((value) => Number.isFinite(value) && value > 0);
      if (symbol && price) {
        result.set(symbol, price);
        missingSymbols.delete(symbol);
      }
    });

    await sleep(250);
  }

  if (missingSymbols.size > 0) {
    const chartPrices = await fetchYahooChartFallbacks(
      env,
      symbols.filter((item) => missingSymbols.has(item.symbol))
    );
    chartPrices.forEach((price, symbol) => {
      result.set(symbol, price);
      missingSymbols.delete(symbol);
    });
  }

  if (result.size === 0) {
    throw new Error('Yahoo quote 429');
  }

  return result;
};

const extractChartClosePrice = (data: any) => {
  const result = Array.isArray(data?.chart?.result) ? data.chart.result[0] : null;
  const meta = result?.meta || {};
  const indicators = Array.isArray(result?.indicators?.quote) ? result.indicators.quote[0] : null;
  const closes = Array.isArray(indicators?.close) ? indicators.close.filter((value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0) : [];
  const closePrice = closes.length > 0 ? Number(closes[closes.length - 1]) : NaN;
  const regularMarketPrice = Number(meta?.regularMarketPrice);
  const previousClose = Number(meta?.previousClose);

  return [regularMarketPrice, closePrice, previousClose].find((value) => Number.isFinite(value) && value > 0) || null;
};

const fetchYahooChartPrice = async (chartBaseUrl: string, symbol: string) => {
  const url = `${chartBaseUrl}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;

  for (let attempt = 0; attempt < YAHOO_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: YAHOO_HEADERS
    });

    if (response.ok) {
      const data = await response.json();
      const price = extractChartClosePrice(data);
      if (price) {
        return price;
      }
      return null;
    }

    if (response.status === 429 && attempt < YAHOO_MAX_RETRIES - 1) {
      const retryDelay = YAHOO_RETRY_BASE_DELAY_MS * (attempt + 1);
      await sleep(retryDelay);
      continue;
    }

    return null;
  }

  return null;
};

const fetchYahooChartFallbacks = async (env: PriceSyncWorkerEnv, symbols: PriceRow[]) => {
  const chartBaseUrl = String(env.YAHOO_CHART_URL || DEFAULT_YAHOO_CHART_URL).trim();
  const result = new Map<string, number>();

  for (const item of symbols) {
    for (const querySymbol of getYahooQuerySymbols(item)) {
      const price = await fetchYahooChartPrice(chartBaseUrl, querySymbol);
      if (price) {
        result.set(item.symbol, price);
        break;
      }
    }
    await sleep(350);
  }

  return result;
};

const pushPricesToCloudflare = async (env: PriceSyncWorkerEnv, items: PriceUpdateItem[]) => {
  const pricesApiUrl = String(env.PRICES_API_URL || DEFAULT_PRICES_API_URL).trim();
  const syncKey = String(env.PRICE_SYNC_KEY || '').trim();

  if (!syncKey) {
    throw new Error('PRICE_SYNC_KEY is not configured');
  }

  const response = await fetch(`${pricesApiUrl.replace(/\/$/, '')}/bulk-upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-price-sync-key': syncKey
    },
    body: JSON.stringify({ items })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as any)?.error || `Bulk upsert ${response.status}`));
  }

  return data;
};

const syncPrices = async (env: PriceSyncWorkerEnv, options: SyncOptions = {}): Promise<SyncResult> => {
  const checkedAt = new Date();
  const tradingClock = getTradingClock(checkedAt);

  if (!options.force) {
    if (!isWeekday(tradingClock.weekday)) {
      return {
        ok: true,
        skipped: true,
        reason: 'weekend',
        checkedAt: checkedAt.toISOString(),
        tradingDate: tradingClock.isoDate,
        tradingTime: tradingClock.hhmm,
        symbols: 0,
        updated: 0
      };
    }

    if (!isTradingTime(tradingClock.hhmm)) {
      return {
        ok: true,
        skipped: true,
        reason: 'outside-trading-hours',
        checkedAt: checkedAt.toISOString(),
        tradingDate: tradingClock.isoDate,
        tradingTime: tradingClock.hhmm,
        symbols: 0,
        updated: 0
      };
    }

    const holidays = await fetchTradingHolidays(env, Number(tradingClock.isoDate.slice(0, 4)));
    if (holidays.has(tradingClock.isoDate)) {
      return {
        ok: true,
        skipped: true,
        reason: 'twse-holiday',
        checkedAt: checkedAt.toISOString(),
        tradingDate: tradingClock.isoDate,
        tradingTime: tradingClock.hhmm,
        symbols: 0,
        updated: 0
      };
    }
  }

  const symbols = await fetchSymbolsFromCloudflare(env);
  if (symbols.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no-symbols',
      checkedAt: checkedAt.toISOString(),
      tradingDate: tradingClock.isoDate,
      tradingTime: tradingClock.hhmm,
      symbols: 0,
      updated: 0
    };
  }

  const quotes = await fetchYahooQuotes(env, symbols);
  const updatedAt = checkedAt.toISOString();
  const items = symbols
    .map((item) => {
      const price = quotes.get(item.symbol);
      if (!price) return null;
      const market = item.market === 'US' ? 'US' : 'TW';
      return {
        symbol: item.symbol,
        companyName: item.companyName,
        market,
        currency: market === 'US' ? 'USD' : 'TWD',
        price,
        fxRateToTwd: market === 'US' ? 0 : 1,
        updatedAt
      };
    })
    .filter((item): item is PriceUpdateItem => item !== null);

  if (items.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no-valid-quotes',
      checkedAt: checkedAt.toISOString(),
      tradingDate: tradingClock.isoDate,
      tradingTime: tradingClock.hhmm,
      symbols: symbols.length,
      updated: 0
    };
  }

  if (!options.dryRun) {
    await pushPricesToCloudflare(env, items);
  }

  return {
    ok: true,
    skipped: false,
    checkedAt: checkedAt.toISOString(),
    tradingDate: tradingClock.isoDate,
    tradingTime: tradingClock.hhmm,
    symbols: symbols.length,
    updated: items.length,
    items: options.dryRun ? items : undefined
  };
};

const authorizeRequest = (request: Request, env: PriceSyncWorkerEnv) => {
  const expectedKey = String(env.PRICE_SYNC_KEY || '').trim();
  if (!expectedKey) {
    throw new Error('PRICE_SYNC_KEY is not configured');
  }

  const incomingKey = String(request.headers.get('x-price-sync-key') || '').trim();
  if (!incomingKey || incomingKey !== expectedKey) {
    return false;
  }

  return true;
};

export default {
  async scheduled(_controller: ScheduledController, env: PriceSyncWorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(syncPrices(env));
  },

  async fetch(request: Request, env: PriceSyncWorkerEnv) {
    try {
      if (!authorizeRequest(request, env)) {
        return json(401, { ok: false, error: 'Unauthorized' });
      }

      const url = new URL(request.url);
      const force = url.searchParams.get('force') === '1';
      const dryRun = url.searchParams.get('dryRun') === '1';
      const result = await syncPrices(env, { force, dryRun });
      return json(200, result as unknown as Record<string, unknown>);
    } catch (error) {
      return json(500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
};
