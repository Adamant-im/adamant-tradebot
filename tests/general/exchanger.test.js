'use strict';

const mockConfig = {
  exchange: 'fallbacktest',
  exchangeName: 'FallbackTest',
  pair: 'NEW/USDT',
  defaultPair: 'NEWUSDT',
  coin1: 'NEW',
  coin2: 'USDT',
  infoservice: ['https://info.test'],
  coin_price_fallback: { enabled: true, priceSource: 'last', cacheMs: 30_000 },
};
const mockAxiosGet = jest.fn();
const mockGetRatesCached = jest.fn();
const mockPeekCachedMarket = jest.fn();
const mockParseMarket = jest.fn();
const mockLog = { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock('../../modules/configReader', () => mockConfig);
jest.mock('../../trade/settings/tradeParams_fallbacktest', () => ({}), { virtual: true });
jest.mock('../../trade/orderUtils', () => ({
  getRatesCached: mockGetRatesCached,
  peekCachedMarket: mockPeekCachedMarket,
  parseMarket: mockParseMarket,
}));
jest.mock('../../helpers/log', () => mockLog);
jest.mock('axios', () => ({ get: mockAxiosGet }));
jest.mock('../../helpers/utils', () => ({
  getModuleName: () => 'exchanger',
  isPositiveNumber: (n) => typeof n === 'number' && Number.isFinite(n) && n > 0,
  isStableCoin: (coin) => ['USDT', 'USDC', 'USD', 'TUSD'].includes(coin),
  toFixedMeaningful: (value) => String(Number(value.toPrecision(10))),
  timeAgoString: (timestamp) => `${Math.floor((Date.now() - timestamp) / 1000)}s ago`,
}));

/**
 * Loads the exchanger and awaits its eager initial update without making a second request.
 *
 * @param {Record<string, number>} rates Initial Infoservice snapshot
 * @returns {Promise<import('../../helpers/cryptos/exchanger')>} Loaded synchronous rate service
 */
async function loadExchanger(rates = { 'USDT/USD': 0.9986, 'BTC/USD': 60_000 }) {
  mockAxiosGet.mockResolvedValue({ data: { success: true, result: rates } });
  const exchanger = require('../../helpers/cryptos/exchanger');
  await exchanger.updateCryptoRates();
  return exchanger;
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-08T10:00:00Z'));
  jest.clearAllMocks();
  mockConfig.coin1 = 'NEW';
  mockConfig.coin2 = 'USDT';
  mockConfig.pair = 'NEW/USDT';
  mockConfig.coin_price_fallback = { enabled: true, priceSource: 'last', cacheMs: 30_000 };
  mockGetRatesCached.mockReset().mockResolvedValue({ last: 2, bid: 1, ask: 3 });
  mockPeekCachedMarket.mockReset().mockReturnValue({});
  mockParseMarket.mockReset().mockReturnValue({ marketInfoSupported: false });
  mockAxiosGet.mockReset();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('keeps Infoservice authoritative and converts direct, inverse and USD cross rates synchronously', async () => {
  const exchanger = await loadExchanger({ 'NEW/USD': 3, 'BTC/USD': 60_000, 'USD/USDT': 1.01 });
  expect(exchanger.getRate('NEW', 'USD')).toBe(3);
  expect(exchanger.getRate('USD', 'NEW')).toBeCloseTo(1 / 3);
  expect(exchanger.getRate('NEW', 'BTC')).toBe(0.00005);
  expect(exchanger.getRate('NEW', 'NEW')).toBe(1);
  expect(exchanger.convertCryptos('new', 'usd', 10)).toEqual({ outAmount: 30, exchangePrice: 3 });
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(exchanger.getFallbackRateInfo('NEW')).toBeUndefined();
});

test('prices an unlisted base through the spot pair while preserving the observed stablecoin USD rate', async () => {
  const rates = { 'USDT/USD': 0.9986, 'BTC/USD': 60_000 };
  const exchanger = await loadExchanger(rates);
  expect(mockGetRatesCached).toHaveBeenCalledWith('NEW/USDT', 'exchanger', false, 30_000, expect.any(AbortSignal));
  expect(exchanger.getRate('NEW', 'USD')).toBe(1.9972);
  expect(exchanger.getRate('NEW', 'USDT')).toBe(2);
  expect(exchanger.getRate('USDT', 'NEW')).toBe(0.5);
  expect(exchanger.getRate('NEW', 'BTC')).toBeCloseTo(1.9972 / 60_000);
  expect(exchanger.calcCoin1AmountInOtherCoins(10)).toEqual({
    coin1: 10, coin2: 20, USD: 19.972, USDT: 20, BTC: 19.972 / 60_000,
  });
  expect(exchanger.currencies).toBe(rates);
  expect(exchanger.currencies['NEW/USD']).toBeUndefined();
  expect(exchanger.hasTicker('NEW')).toBe(true);
  expect(exchanger.getFallbackRateInfo('NEW')).toMatchObject({
    source: 'exchange', pair: 'NEW/USDT', exchange: 'FallbackTest', usdRate: 1.9972,
  });
});

test.each(['USDT', 'USDC', 'USD', 'TUSD'])('uses USD parity for omitted stable quote %s', async (stable) => {
  mockConfig.coin2 = stable;
  mockConfig.pair = `NEW/${stable}`;
  const exchanger = await loadExchanger({ 'BTC/USD': 60_000 });
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
  expect(exchanger.getRate('NEW', stable)).toBe(2);
  expect(exchanger.getRate(stable, 'USD')).toBe(1);
  expect(exchanger.hasTicker(stable)).toBe(true);
});

test('supports an omitted stable quote even when the base coin is listed', async () => {
  const exchanger = await loadExchanger({ 'NEW/USD': 3 });
  expect(exchanger.getRate('NEW', 'USDT')).toBe(3);
  expect(exchanger.getRate('USDT', 'NEW')).toBeCloseTo(1 / 3);
  expect(exchanger.hasTicker('USDT')).toBe(true);
  expect(exchanger.getFallbackRateInfo('USDT')).toEqual({ source: 'stablecoin', usdRate: 1 });
  expect(mockGetRatesCached).not.toHaveBeenCalled();
});

test('keeps the exact pair price when a stable quote is listed without a USD ticker', async () => {
  const exchanger = await loadExchanger({ 'USDT/BTC': 0.000016, 'BTC/USD': 60_000 });
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
  expect(exchanger.getRate('NEW', 'USDT')).toBe(2);
});

test.each([{ 'BTC/USD': 60_000 }, { 'USD/BTC': 1 / 60_000 }])('prices a non-stable quote using direct or inverse Infoservice USD rate %p', async (rates) => {
  mockConfig.coin2 = 'BTC';
  mockConfig.pair = 'NEW/BTC';
  const exchanger = await loadExchanger(rates);
  expect(exchanger.getRate('NEW', 'USD')).toBeCloseTo(120_000);
  expect(exchanger.getRate('NEW', 'BTC')).toBe(2);
});

test('keeps fallback inactive until a non-stable quote has a USD rate, logging once per transition', async () => {
  mockConfig.coin2 = 'OTHER';
  mockConfig.pair = 'NEW/OTHER';
  const exchanger = await loadExchanger({ 'BTC/USD': 60_000 });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();
  expect(exchanger.hasTicker('NEW')).toBe(false);
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('has no USD rate for NEW'))).toHaveLength(1);
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('non-stable quote OTHER'))).toHaveLength(1);

  mockAxiosGet.mockResolvedValue({ data: { result: { 'OTHER/USD': 4 } } });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBe(8);

  mockAxiosGet.mockResolvedValue({ data: { result: { 'BTC/USD': 60_000 } } });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('non-stable quote OTHER'))).toHaveLength(2);
});

test.each([
  { success: false, result: { 'BTC/USD': 60_000 } },
  { result: {} }, { result: null }, { result: [] }, { result: ['BTC/USD'] }, { result: 'bad' }, {},
])('does not infer availability from an unsuccessful or malformed response %p', async (data) => {
  mockAxiosGet.mockResolvedValue({ data });
  const exchanger = require('../../helpers/cryptos/exchanger');
  await exchanger.syncStartupRates();
  expect(exchanger.currencies).toBeUndefined();
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();
  expect(exchanger.getRate('USDT', 'USD')).toBeUndefined();
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(mockLog.warn.mock.calls.some(([line]) => line.includes('has no USD rate for'))).toBe(false);
});

test('waits for the next tick after initial network failure, then activates fallback', async () => {
  mockAxiosGet.mockRejectedValue(new Error('network unavailable'));
  const exchanger = require('../../helpers/cryptos/exchanger');
  await exchanger.syncStartupRates();
  expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(mockLog.warn.mock.calls.some(([line]) => line.includes('has no USD rate for'))).toBe(false);

  mockAxiosGet.mockResolvedValue({ data: { result: { 'BTC/USD': 60_000 } } });
  await jest.advanceTimersByTimeAsync(60_000);
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
});

test('keeps missing-coin warnings transition-safe when fallback is disabled', async () => {
  mockConfig.coin_price_fallback.enabled = false;
  const exchanger = await loadExchanger({ 'BTC/USD': 60_000 });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();
  expect(exchanger.getRate('USDT', 'USD')).toBeUndefined();
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('fallback is disabled'))).toHaveLength(1);
});

test.each([
  ['bid', { bid: 1, ask: 3, last: 5 }, 1],
  ['ask', { bid: 1, ask: 3, last: 5 }, 3],
  ['mid', { bid: 1, ask: 3, last: 5 }, 2],
  ['last', { bid: 1, ask: 3, last: 5 }, 5],
  ...[undefined, 0, -1, NaN, Infinity, '5'].map((last) => ['last', { bid: 1, ask: 3, last }, 2]),
])('extracts %s from %p', async (source, ticker, expected) => {
  mockConfig.coin_price_fallback.priceSource = source;
  mockGetRatesCached.mockResolvedValue(ticker);
  const exchanger = await loadExchanger({ 'USDT/USD': 1 });
  expect(exchanger.getRate('NEW', 'USD')).toBe(expected);
});

test.each([
  ['mid', { bid: 0, ask: 3 }], ['mid', { bid: 1, ask: Infinity }],
  ['last', { last: 0, bid: NaN, ask: 3 }], ['bid', { bid: -1, last: 5 }],
  ['ask', { ask: Infinity, last: 5 }], ['last', undefined],
])('rejects unusable %s price %p', async (source, ticker) => {
  mockConfig.coin_price_fallback.priceSource = source;
  mockGetRatesCached.mockResolvedValue(ticker);
  const exchanger = await loadExchanger();
  expect(exchanger.hasTicker('NEW')).toBe(false);
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();
  expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining(ticker === undefined ? 'Ticker request' : 'Unusable'));
});

test('retains prior rates through failures and invalid ticker responses', async () => {
  const exchanger = await loadExchanger();
  const original = exchanger.currencies;
  mockAxiosGet.mockRejectedValue(new Error('Infoservice offline'));
  mockGetRatesCached.mockRejectedValue(new Error('exchange offline'));
  await exchanger.updateCryptoRates();
  expect(exchanger.currencies).toBe(original);
  expect(exchanger.getRate('NEW', 'USD')).toBe(1.9972);

  mockGetRatesCached.mockResolvedValue({ last: 0, bid: 0, ask: 0 });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBe(1.9972);
  jest.advanceTimersByTime(59_000);
  expect(exchanger.getRate('NEW', 'USD')).toBe(1.9972);
});

test('recovers Infoservice pricing and reactivates fallback when the coin disappears again', async () => {
  const exchanger = await loadExchanger();
  mockAxiosGet.mockResolvedValue({ data: { result: { 'NEW/USD': 7, 'USDT/USD': 1 } } });
  await exchanger.updateCryptoRates();
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBe(7);
  expect(exchanger.getFallbackRateInfo('NEW')).toBeUndefined();
  expect(mockGetRatesCached).toHaveBeenCalledTimes(1);
  expect(mockLog.info.mock.calls.filter(([line]) => line.includes('recovered Infoservice pricing'))).toHaveLength(1);

  mockAxiosGet.mockResolvedValue({ data: { result: { 'USDT/USD': 1 } } });
  mockGetRatesCached.mockResolvedValue({ last: 9 });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBe(9);
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('has no USD rate for NEW'))).toHaveLength(2);
});

test('picks up newer shared ticker observations synchronously and retains them after cache expiry', async () => {
  const exchanger = await loadExchanger();
  mockPeekCachedMarket.mockReturnValue({ rates: { last: 4 }, ratesTs: Date.now() + 1 });
  expect(exchanger.getRate('NEW', 'USDT')).toBe(4);
  mockPeekCachedMarket.mockReturnValue({ rates: { last: 0 }, ratesTs: Date.now() + 2 });
  expect(exchanger.getRate('NEW', 'USDT')).toBe(4);
  mockPeekCachedMarket.mockReturnValue({ rates: { last: 3 }, ratesTs: Date.now() });
  expect(exchanger.getRate('NEW', 'USDT')).toBe(4);
  mockPeekCachedMarket.mockReturnValue({});
  expect(exchanger.getRate('NEW', 'USDT')).toBe(4);
  expect(mockGetRatesCached).toHaveBeenCalledTimes(1);
});

test('refreshes the exchange ticker periodically even while Infoservice is temporarily down', async () => {
  const exchanger = await loadExchanger();
  mockAxiosGet.mockRejectedValue(new Error('Infoservice offline'));
  mockGetRatesCached.mockResolvedValue({ last: 6 });
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockGetRatesCached).toHaveBeenCalledTimes(2);
  expect(exchanger.getRate('NEW', 'USDT')).toBe(6);
});

test('uses the latest cached observation if another caller refreshes during the periodic fetch', async () => {
  const exchanger = await loadExchanger();
  mockGetRatesCached.mockResolvedValue({ last: 3 });
  mockPeekCachedMarket.mockReturnValue({ rates: { last: 5 }, ratesTs: Date.now() + 1 });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USDT')).toBe(5);
});

test('deduplicates in-flight Infoservice updates and retries fallback once after metadata warmup', async () => {
  let resolveInfoservice;
  mockAxiosGet.mockReturnValue(new Promise((resolve) => { resolveInfoservice = resolve; }));
  mockGetRatesCached.mockResolvedValueOnce(undefined).mockResolvedValue({ last: 8 });
  const exchanger = require('../../helpers/cryptos/exchanger');
  const first = exchanger.updateCryptoRates();
  const second = exchanger.updateCryptoRates();
  expect(first).toBe(second);
  expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  resolveInfoservice({ data: { result: { 'USDT/USD': 1 } } });
  await first;
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();

  const startup = exchanger.syncStartupRates();
  expect(exchanger.syncStartupRates()).toBe(startup);
  await startup;
  expect(exchanger.getRate('NEW', 'USD')).toBe(8);
  expect(mockGetRatesCached).toHaveBeenCalledTimes(2);
  expect(mockAxiosGet).toHaveBeenCalledTimes(1);
});

test('recognizes first keys and exact symbols, and ignores invalid prices', async () => {
  const exchanger = await loadExchanger({ 'FIRST/BTC': 1, 'USD/NEW': 0.5, 'BAD/USD': 0, 'NEG/USD': -1 });
  expect(exchanger.hasTicker('FIRST')).toBe(true);
  expect(exchanger.hasTicker('FIR')).toBe(false);
  expect(exchanger.hasTicker('BTC')).toBe(true);
  expect(exchanger.hasTicker('BAD')).toBe(false);
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
  expect(exchanger.getRate('USD', 'BAD')).toBeUndefined();
  expect(exchanger.getRate('NEG', 'USD')).toBeUndefined();
  expect(mockGetRatesCached).not.toHaveBeenCalled();
});

test('uses fallback USD pricing even if Infoservice lists only a non-USD base pair', async () => {
  const exchanger = await loadExchanger({ 'NEW/BTC': 0.00004, 'BTC/USD': 60_000, 'USDT/USD': 1 });
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
  expect(exchanger.getRate('NEW', 'BTC')).toBe(0.00004);
  expect(exchanger.getFallbackRateInfo('NEW')).toMatchObject({ source: 'exchange', usdRate: 2 });
});

test('logs the actual midpoint price once on activation and once after a failure recovers', async () => {
  mockGetRatesCached.mockResolvedValue({ bid: 1, ask: 3 });
  const exchanger = await loadExchanger({ 'USDT/USD': 1 });
  expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('FallbackTest NEW/USDT mid 2 (~2 USD)'));
  expect(exchanger.getFallbackRateInfo('NEW').priceSource).toBe('mid');
  await exchanger.updateCryptoRates();
  expect(mockLog.info).toHaveBeenCalledTimes(1);

  mockGetRatesCached.mockResolvedValue(undefined);
  await exchanger.updateCryptoRates();
  await exchanger.updateCryptoRates();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('Ticker request'))).toHaveLength(1);
  mockGetRatesCached.mockResolvedValue({ last: 4 });
  await exchanger.updateCryptoRates();
  expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Recovered exchange ticker pricing.'));
  expect(mockLog.info).toHaveBeenCalledTimes(2);
});

test('distinguishes failed requests and invalid payloads without repeating warnings', async () => {
  const exchanger = await loadExchanger();
  mockGetRatesCached.mockResolvedValue(undefined);
  await exchanger.updateCryptoRates();
  await exchanger.updateCryptoRates();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('Ticker request'))).toHaveLength(1);

  mockGetRatesCached.mockResolvedValue({ last: 0, bid: -1, ask: NaN });
  await exchanger.updateCryptoRates();
  await exchanger.updateCryptoRates();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('Unusable'))).toHaveLength(1);
  expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('last=0, bid=-1, ask=NaN'));
  expect(exchanger.getRate('NEW', 'USD')).toBe(1.9972);
});

test('does not claim fallback was deactivated when it was disabled', async () => {
  mockConfig.coin_price_fallback.enabled = false;
  const exchanger = await loadExchanger();
  mockAxiosGet.mockResolvedValue({ data: { result: { 'NEW/USD': 3 } } });
  await exchanger.updateCryptoRates();
  expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('recovered Infoservice pricing.'));
  expect(mockLog.info.mock.calls.some(([line]) => line.includes('deactivated'))).toBe(false);
});

test('logs non-stable quote recovery once when it makes fallback eligible', async () => {
  mockConfig.coin2 = 'OTHER';
  mockConfig.pair = 'NEW/OTHER';
  const exchanger = await loadExchanger({ 'BTC/USD': 60_000 });
  mockAxiosGet.mockResolvedValue({ data: { result: { 'OTHER/USD': 4 } } });
  await exchanger.updateCryptoRates();
  await exchanger.updateCryptoRates();
  expect(mockLog.info.mock.calls.filter(([line]) => line.includes('recovered the OTHER/USD quote rate'))).toHaveLength(1);
});

test('bounds startup at 15 seconds while keeping Infoservice refresh independent of a hung ticker', async () => {
  mockAxiosGet.mockResolvedValue({ data: { result: { 'USDT/USD': 1 } } });
  mockGetRatesCached.mockReturnValue(new Promise(() => {}));
  const exchanger = require('../../helpers/cryptos/exchanger');
  let startupDone = false;
  const startup = exchanger.syncStartupRates().then(() => { startupDone = true; });
  await jest.advanceTimersByTimeAsync(14_999);
  expect(startupDone).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await startup;
  expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('exceeded 15000 ms'));

  await jest.advanceTimersByTimeAsync(105_000);
  expect(mockAxiosGet).toHaveBeenCalledTimes(3);
  expect(mockGetRatesCached.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('exceeded 60000 ms'));
  mockAxiosGet.mockResolvedValue({ data: { result: { 'NEW/USD': 7 } } });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBe(7);
});

test('ignores a late ticker result after Infoservice recovers', async () => {
  let resolveTicker;
  mockAxiosGet.mockResolvedValue({ data: { result: { 'USDT/USD': 1 } } });
  mockGetRatesCached.mockReturnValue(new Promise((resolve) => { resolveTicker = resolve; }));
  const exchanger = require('../../helpers/cryptos/exchanger');
  const initial = exchanger.updateCryptoRates();
  await jest.advanceTimersByTimeAsync(0);
  mockAxiosGet.mockResolvedValue({ data: { result: { 'NEW/USD': 7 } } });
  await exchanger.updateCryptoRates();
  resolveTicker({ last: 99 });
  await initial;
  expect(exchanger.getRate('NEW', 'USD')).toBe(7);
  expect(exchanger.getFallbackRateInfo('NEW')).toBeUndefined();
  expect(mockLog.info.mock.calls.some(([line]) => line.includes('last 99'))).toBe(false);
});

test('stops polling an absent spot market after a successful metadata load', async () => {
  const api = { getMarkets: jest.fn(async () => ({ 'OTHER/USDT': {} })), marketInfo: jest.fn(async () => undefined) };
  mockParseMarket.mockReturnValue({ marketInfoSupported: true, exchangeApi: api });
  const exchanger = await loadExchanger();
  await exchanger.updateCryptoRates();
  await exchanger.syncStartupRates();
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(api.getMarkets).toHaveBeenCalledTimes(1);
  expect(exchanger.getRate('NEW', 'USD')).toBeUndefined();
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('does not list spot market'))).toHaveLength(1);
});

test('retries metadata after an unavailable load and awaits async marketInfo', async () => {
  const api = { getMarkets: jest.fn(async () => undefined), marketInfo: jest.fn(async () => ({})) };
  mockParseMarket.mockReturnValue({ marketInfoSupported: true, exchangeApi: api });
  const exchanger = await loadExchanger();
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  api.getMarkets.mockResolvedValue({ 'NEW/USDT': {} });
  await exchanger.syncStartupRates();
  expect(mockGetRatesCached).toHaveBeenCalledTimes(1);
  expect(exchanger.getRate('NEW', 'USDT')).toBe(2);
  expect(mockLog.warn.mock.calls.some(([line]) => line.includes('does not list spot market'))).toBe(false);
});

test('retries timed-out tickers and warns once when the retained observation is stale', async () => {
  const exchanger = await loadExchanger({ 'USDT/USD': 1 });
  mockGetRatesCached.mockReturnValue(new Promise(() => {}));
  await jest.advanceTimersByTimeAsync(3 * 60 * 60_000);
  expect(mockGetRatesCached.mock.calls.length).toBeGreaterThan(2);
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('exceeded 60000 ms'))).toHaveLength(1);
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('at least 5 minutes old'))).toHaveLength(1);
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);

  mockGetRatesCached.mockResolvedValue({ last: 4 });
  await jest.advanceTimersByTimeAsync(120_000);
  expect(exchanger.getRate('NEW', 'USD')).toBe(4);
  mockGetRatesCached.mockReturnValue(new Promise(() => {}));
  await jest.advanceTimersByTimeAsync(6 * 60_000);
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('at least 5 minutes old'))).toHaveLength(2);
});

test('ignores a late ticker after its timeout and a successful retry', async () => {
  const exchanger = await loadExchanger({ 'USDT/USD': 1 });
  let resolveOld;
  mockGetRatesCached.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  const expired = exchanger.updateCryptoRates();
  await jest.advanceTimersByTimeAsync(60_000);
  await expired;
  expect(mockGetRatesCached.mock.calls[1][4].aborted).toBe(true);
  mockGetRatesCached.mockResolvedValue({ last: 4 });
  await exchanger.updateCryptoRates();
  resolveOld({ last: 99 });
  await jest.advanceTimersByTimeAsync(0);
  expect(exchanger.getRate('NEW', 'USD')).toBe(4);
});

test('logs unavailable market metadata once and retries until it recovers', async () => {
  const api = { getMarkets: jest.fn(async () => ({})), marketInfo: jest.fn(async () => ({})) };
  mockParseMarket.mockReturnValue({ marketInfoSupported: true, exchangeApi: api });
  const exchanger = await loadExchanger({ 'USDT/USD': 1 });
  await jest.advanceTimersByTimeAsync(60 * 60_000);
  expect(mockGetRatesCached).not.toHaveBeenCalled();
  expect(api.getMarkets.mock.calls.length).toBeGreaterThan(1);
  expect(mockLog.warn.mock.calls.filter(([line]) => line.includes('Spot market metadata unavailable'))).toHaveLength(1);

  api.getMarkets.mockResolvedValue({ 'NEW/USDT': {} });
  await exchanger.updateCryptoRates();
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
  expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Recovered exchange ticker pricing.'));
});

test('times out metadata requests and ignores their late market-absence result', async () => {
  let resolveOld;
  const api = {
    getMarkets: jest.fn().mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
        .mockResolvedValue({ 'NEW/USDT': {} }),
    marketInfo: jest.fn(async () => ({})),
  };
  mockParseMarket.mockReturnValue({ marketInfoSupported: true, exchangeApi: api });
  mockAxiosGet.mockResolvedValue({ data: { result: { 'USDT/USD': 1 } } });
  const exchanger = require('../../helpers/cryptos/exchanger');
  const initial = exchanger.updateCryptoRates();
  await jest.advanceTimersByTimeAsync(60_000);
  await initial;
  await exchanger.updateCryptoRates();
  resolveOld({ 'OTHER/USDT': {} });
  await jest.advanceTimersByTimeAsync(0);
  expect(api.marketInfo).toHaveBeenCalledTimes(1);
  expect(exchanger.getRate('NEW', 'USD')).toBe(2);
  expect(mockLog.warn.mock.calls.some(([line]) => line.includes('does not list spot market'))).toBe(false);
});
