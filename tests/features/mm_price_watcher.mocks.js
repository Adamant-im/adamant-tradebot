'use strict';

const EXCHANGE = 'PwTestEx';
const PAIR = 'ADM/USDT';
const COIN1 = 'ADM';
const COIN2 = 'USDT';

const mockConfig = {
  exchange: EXCHANGE,
  exchangeName: EXCHANGE,
  defaultPair: PAIR,
  pair: PAIR,
  coin1: COIN1,
  coin2: COIN2,
  perpetual: false,
  apikey: 'key1',
  apisecret: 'secret1',
  apipassword: '',
  exchange_socket: false,
  exchange_socket_pull: false,
  notifyName: 'TestBot',
  silent_mode: true,
};

const mockTradeParams = {
  mm_isActive: true,
  mm_isTraderActive: true,
  mm_Policy: 'optimal',
  mm_isPriceWatcherActive: true,
  mm_priceWatcherLowPriceInSourceCoin: 0.9,
  mm_priceWatcherMidPriceInSourceCoin: 1,
  mm_priceWatcherHighPriceInSourceCoin: 1.1,
  mm_priceWatcherDeviationPercent: 1,
  mm_priceWatcherSource: COIN2,
  mm_priceWatcherSourcePolicy: 'smart',
  mm_priceWatcherAction: 'fill',
  mm_priceSupportLowPrice: 0,
  mm_isPriceChangeVolumeActive: false,
  mm_liquiditySpreadPercent: 2,
  mm_minAmount: 10,
  mm_maxAmount: 20,
};

const mockTraderApi = {
  isSecondAccount: false,
  features: () => ({ socketSupport: false }),
  getOrderBook: jest.fn(),
  getRates: jest.fn(),
  getBalances: jest.fn(),
  placeOrder: jest.fn(),
};

const mockPwExternalApi = {
  features: () => ({ socketSupport: true }),
  getOrderBook: jest.fn(),
  getRates: jest.fn(),
};

const mockTraderFactory = jest.fn(() => mockTraderApi);

const mockOrders = [];

const mockOrdersDb = {
  find: jest.fn(async () => mockOrders.slice()),
};

const mockOrderConstructor = jest.fn((data) => ({ ...data, save: async () => data._id }));

const mockDb = {
  ordersDb: Object.assign(mockOrderConstructor, {
    find: mockOrdersDb.find,
  }),
};

const mockOrderUtils = {
  parseMarket: jest.fn((marketPair) => ({
    pair: marketPair || PAIR,
    coin1: COIN1,
    coin2: COIN2,
    coin1Decimals: 2,
    coin2Decimals: 4,
    isParsed: true,
    marketInfoSupported: true,
    isReversed: false,
  })),
  updateOrders: jest.fn(async (orders) => orders),
  getOrderBookCached: jest.fn(),
  getRatesCached: jest.fn(),
  getBalancesCached: jest.fn(),
};

const mockOrderCollector = {
  clearPriceStepOrders: jest.fn(async () => {}),
  clearOrderById: jest.fn(async () => ({ isCancelRequestProcessed: true })),
  clearBuyOrdersToFreeQuoteCoin: jest.fn(async () => {}),
};

const mockExchangerUtils = {
  convertCryptos: jest.fn(),
  getRate: jest.fn(() => 1),
};

const mockUtils = {
  getModuleName: jest.fn(() => 'mm_price_watcher'),
  saveConfig: jest.fn(),
  randomValue: jest.fn((min, max) => (max === undefined ? min : (min + max) / 2)),
  unixTimeStampMs: jest.fn(() => 1_700_000_000_000),
  timestampInDaysHoursMins: jest.fn(() => '1h'),
  getOrderBookInfo: jest.fn(),
  isPositiveNumber: jest.fn((n) => typeof n === 'number' && Number.isFinite(n) && n > 0),
  numbersDifferencePercent: jest.fn((a, b) => Math.abs(a - b) / ((a + b) / 2) * 100),
  softRequire: jest.fn(() => undefined),
};

const mockLog = {
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockNotify = jest.fn();

module.exports = {
  EXCHANGE,
  PAIR,
  COIN1,
  COIN2,
  mockConfig,
  mockTradeParams,
  mockTraderApi,
  mockPwExternalApi,
  mockTraderFactory,
  mockOrders,
  mockDb,
  mockOrderUtils,
  mockOrderCollector,
  mockExchangerUtils,
  mockUtils,
  mockLog,
  mockNotify,
};
