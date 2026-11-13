'use strict';

const mockExchanger = { currencies: undefined, getFallbackRateInfo: jest.fn() };
const mockOrderUtils = { parseMarket: jest.fn(), getRatesCached: jest.fn() };
const mockPerpetual = { getTickerInfo: jest.fn() };
jest.mock('../../modules/commands/context', () => ({
  exchangerUtils: mockExchanger,
  orderUtils: mockOrderUtils,
  perpetualApi: mockPerpetual,
  config: {},
  moduleName: 'commandTxs',
  log: { error: jest.fn() },
  utils: {
    toFixedMeaningful: (value) => String(value),
    timeAgoString: (timestamp) => `${Math.floor((Date.now() - timestamp) / 1000)}s ago`,
  },
}));
jest.mock('../../helpers/commandInitiator', () => ({ getCommandInitiator: jest.fn() }));
const { getCoinRatesInfo, getExchangeRatesInfo } = require('../../modules/commands/helpers');

beforeEach(() => {
  jest.resetAllMocks();
  mockExchanger.currencies = undefined;
});

test('reports an exchange fallback explicitly without mutating the Infoservice snapshot', () => {
  mockExchanger.currencies = { 'BTC/USD': 60_000 };
  mockExchanger.getFallbackRateInfo.mockReturnValue({
    source: 'exchange', usdRate: 2, exchange: 'XT', pair: 'NEW/USDT', priceSource: 'last', timestamp: Date.now() - 120_000,
  });
  const result = getCoinRatesInfo('NEW');
  expect(result.success).toBe(true);
  expect(result.exchangeRates).toEqual({ 'BTC/USD': 60_000 });
  expect(result.ratesString).toContain('XT spot ticker (NEW/USDT, last');
  expect(result.ratesString).toContain('NEW/**USD**: 2');
  expect(result.ratesString).toContain('updated 120s ago');
  expect(result.ratesString).not.toContain("doesn't monitor");
});

test('labels assumed stablecoin USD parity', () => {
  mockExchanger.getFallbackRateInfo.mockReturnValue({ source: 'stablecoin', usdRate: 1 });
  const result = getCoinRatesInfo('USDC');
  expect(result.success).toBe(true);
  expect(result.ratesString).toContain('assumed stablecoin USD parity');
});

test('keeps the Infoservice diagnostic for listed currencies', () => {
  mockExchanger.currencies = { 'BTC/USD': 60_000 };
  expect(getCoinRatesInfo('BTC')).toMatchObject({
    success: true, ratesString: 'Global market rates for BTC:\nBTC/**USD**: 60000.',
  });
});

test('handles unavailable initial Infoservice data', () => {
  expect(getCoinRatesInfo('NEW')).toMatchObject({ success: false });
});

test('uses the shared spot ticker cache for exchange diagnostics', async () => {
  mockOrderUtils.parseMarket.mockReturnValue({ pair: 'NEW/USDT', coin1: 'NEW', coin2: 'USDT', coin2Decimals: 4 });
  mockOrderUtils.getRatesCached.mockResolvedValue({ bid: 1, ask: 3 });
  await getExchangeRatesInfo('NEW/USDT');
  expect(mockOrderUtils.getRatesCached).toHaveBeenCalledWith('NEW/USDT', 'commandTxs');
  expect(mockPerpetual.getTickerInfo).not.toHaveBeenCalled();
});

test('keeps perpetual ticker diagnostics on the perpetual connector', async () => {
  mockOrderUtils.parseMarket.mockReturnValue({ pair: 'NEWUSDT', perpetual: true });
  await getExchangeRatesInfo('NEWUSDT');
  expect(mockPerpetual.getTickerInfo).toHaveBeenCalledWith('NEWUSDT', true);
  expect(mockOrderUtils.getRatesCached).not.toHaveBeenCalled();
});

test('shows Infoservice non-USD rates alongside an exchange-derived USD fallback', () => {
  mockExchanger.currencies = { 'NEW/BTC': 0.00004 };
  mockExchanger.getFallbackRateInfo.mockReturnValue({
    source: 'exchange', usdRate: 2, exchange: 'XT', pair: 'NEW/USDT', priceSource: 'last', timestamp: Date.now(),
  });
  const { success, ratesString } = getCoinRatesInfo('NEW');
  expect(success).toBe(true);
  expect(ratesString).toContain('Global market rates for NEW:');
  expect(ratesString).toContain('NEW/**BTC**: 0.00004');
  expect(ratesString).toContain('Fallback rate for NEW from XT spot ticker');
  expect(ratesString).toContain('NEW/**USD**: 2');
});
