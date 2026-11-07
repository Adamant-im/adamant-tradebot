'use strict';

/**
 * Unit tests for trade/features/mm_price_watcher.js
 *
 * @module tests/features/mm_price_watcher.test
 */

jest.mock('../../modules/configReader', () => require('./mm_price_watcher.mocks').mockConfig);
jest.mock('../../trade/settings/tradeParams_PwTestEx', () => require('./mm_price_watcher.mocks').mockTradeParams, { virtual: true });
jest.mock('../../trade/trader/trader_PwTestEx', () => require('./mm_price_watcher.mocks').mockTraderFactory, { virtual: true });
jest.mock('../../trade/trader/trader_pwtestex', () => require('./mm_price_watcher.mocks').mockTraderFactory, { virtual: true });
jest.mock('../../modules/DB', () => require('./mm_price_watcher.mocks').mockDb);
jest.mock('../../trade/orderUtils', () => require('./mm_price_watcher.mocks').mockOrderUtils);
jest.mock('../../trade/orderCollector', () => require('./mm_price_watcher.mocks').mockOrderCollector);
jest.mock('../../helpers/cryptos/exchanger', () => require('./mm_price_watcher.mocks').mockExchangerUtils);
jest.mock('../../helpers/utils', () => require('./mm_price_watcher.mocks').mockUtils);
jest.mock('../../helpers/log', () => require('./mm_price_watcher.mocks').mockLog);
jest.mock('../../helpers/notify', () => require('./mm_price_watcher.mocks').mockNotify);
jest.mock('../../trade/trader/trader_otherex', () => {
  const { mockPwExternalApi } = require('./mm_price_watcher.mocks');
  return jest.fn(() => mockPwExternalApi);
}, { virtual: true });

const {
  EXCHANGE,
  PAIR,
  COIN1,
  COIN2,
  mockTradeParams,
  mockTraderApi,
  mockPwExternalApi,
  mockTraderFactory,
  mockOrders,
  mockOrderUtils,
  mockOrderCollector,
  mockExchangerUtils,
  mockUtils,
  mockLog,
  mockNotify,
} = require('./mm_price_watcher.mocks');

/**
 * Builds a minimal parsed market descriptor.
 *
 * @param {Partial<Record<string, unknown>>} overrides Field overrides
 * @returns {Record<string, unknown>}
 */
function makeParsedMarket(overrides = {}) {
  return {
    pair: PAIR,
    coin1: COIN1,
    coin2: COIN2,
    coin1Decimals: 2,
    coin2Decimals: 4,
    isParsed: true,
    marketInfoSupported: true,
    isReversed: false,
    ...overrides,
  };
}

/**
 * Builds a two-sided order book snapshot.
 *
 * @param {number} bid Bid price
 * @param {number} ask Ask price
 * @returns {{ bids: { price: number, amount: number }[], asks: { price: number, amount: number }[] }}
 */
function makeOrderBook(bid, ask) {
  return {
    bids: [{ price: bid, amount: 100 }],
    asks: [{ price: ask, amount: 100 }],
  };
}

/**
 * Reloads mm_price_watcher. Module-level state is reset via reviewPrices() in beforeEach.
 *
 * @returns {import('../../trade/features/mm_price_watcher')}
 */
function loadPriceWatcher() {
  // eslint-disable-next-line global-require
  return require('../../trade/features/mm_price_watcher');
}

/**
 * Resets pw module state by forcing a fresh price-range calculation.
 *
 * @param {ReturnType<typeof loadPriceWatcher>} priceWatcher Loaded module
 * @returns {Promise<void>}
 */
async function resetPwState(priceWatcher) {
  priceWatcher.setIsPriceActual(false, 'test-reset');
  applyTradeParams({
    mm_isPriceWatcherActive: true,
    mm_priceWatcherSource: COIN2,
    mm_priceWatcherLowPriceInSourceCoin: 1,
    mm_priceWatcherHighPriceInSourceCoin: 2,
    mm_priceWatcherDeviationPercent: 0,
    mm_priceSupportLowPrice: 0,
  });
  stubLinearConversion();
  mockUtils.randomValue.mockImplementation((a, b) => a);
  await priceWatcher.reviewPrices();
}

/**
 * Applies tradeParams overrides for a single test.
 *
 * @param {Record<string, unknown>} overrides Trade param overrides
 * @returns {void}
 */
function applyTradeParams(overrides) {
  Object.keys(mockTradeParams).forEach((key) => {
    if (!(key in overrides) && key.startsWith('saved_')) {
      delete mockTradeParams[key];
    }
  });
  Object.assign(mockTradeParams, overrides);
}

/**
 * Stubs exchanger conversion as a simple multiply-by-rate helper.
 *
 * @returns {void}
 */
function stubLinearConversion() {
  mockExchangerUtils.convertCryptos.mockImplementation((from, to, amount, _fee, specificRate) => {
    const rate = typeof specificRate === 'number' ? specificRate : mockExchangerUtils.getRate(from, to);
    return { outAmount: amount * rate, exchangePrice: rate };
  });
  mockExchangerUtils.getRate.mockImplementation((from, to) => {
    if (from === to) {
      return 1;
    }
    if (from === 'BTC' && to === COIN2) {
      return 64_000;
    }
    if (from === COIN2 && to === 'BTC') {
      return 1 / 64_000;
    }
    return 1;
  });
}

describe('mm_price_watcher', () => {
  /** @type {ReturnType<typeof loadPriceWatcher>} */
  let pw;

  beforeAll(() => {
    pw = loadPriceWatcher();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOrders.length = 0;
    applyTradeParams({
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
      mm_isPriceSupportActive: undefined,
      mm_isPriceChangeVolumeActive: false,
      mm_liquiditySpreadPercent: 2,
      mm_minAmount: 10,
      mm_maxAmount: 20,
    });
    mockUtils.randomValue.mockImplementation((min, max) => (max === undefined ? min : (min + max) / 2));
    mockOrderUtils.parseMarket.mockImplementation((marketPair) => makeParsedMarket({ pair: marketPair }));
    stubLinearConversion();
    mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(1, 1.02));
    mockUtils.getOrderBookInfo.mockReturnValue({
      smartBid: 1,
      smartAsk: 1.02,
      sideTargetPrice: 'buy',
      amountTargetPrice: 15,
      amountTargetPriceQuote: 15,
    });
    mockOrderUtils.getBalancesCached.mockResolvedValue([
      { code: COIN1, free: 1000, freezed: 0 },
      { code: COIN2, free: 1000, freezed: 0 },
    ]);
    mockTraderApi.placeOrder.mockResolvedValue({ orderId: 'pw-order-1' });
    pw.setIsPriceActual(false, 'test-reset');
    await pw.reviewPrices();
  });

  describe('enablement and state getters', () => {
    test('getIsPriceWatcherEnabled is true for regular policy with active Pw', () => {
      expect(pw.getIsPriceWatcherEnabled()).toBe(true);
    });

    test('getIsPriceWatcherEnabled is false for wash policy when trader is active', () => {
      applyTradeParams({ mm_Policy: 'wash' });
      expect(pw.getIsPriceWatcherEnabled()).toBe(false);
    });

    test('getIsPriceWatcherEnabled works with support price only', () => {
      applyTradeParams({
        mm_isPriceWatcherActive: false,
        mm_priceSupportLowPrice: 0.5,
        mm_isPriceSupportActive: undefined,
      });
      expect(pw.getIsPriceWatcherEnabled()).toBe(true);
    });

    test('getIsPriceWatcherEnabled is false when support price is stored but inactive', () => {
      applyTradeParams({
        mm_isPriceWatcherActive: false,
        mm_priceSupportLowPrice: 0.5,
        mm_isPriceSupportActive: false,
      });
      expect(pw.getIsPriceWatcherEnabled()).toBe(false);
    });

    test('getIsPriceActualAndEnabled requires actual range and enabled flag', () => {
      pw.setIsPriceActual(false, 'test');
      expect(pw.getIsPriceActualAndEnabled()).toBe(false);
      pw.setIsPriceActual(true, 'test');
      expect(pw.getIsPriceActualAndEnabled()).toBe(true);
    });

    test('getHighPriceString renders Infinity without decimals', async () => {
      applyTradeParams({
        mm_isPriceWatcherActive: false,
        mm_priceSupportLowPrice: 0.75,
      });
      await pw.reviewPrices();
      expect(pw.getHighPriceString()).toBe('Infinity');
    });

    test('getIgnorePriceNotActual reflects NOT_ACTUAL_PRICE_ACTION', () => {
      expect(pw.getIgnorePriceNotActual()).toBe(false);
    });
  });

  describe('savePw and restorePw', () => {
    test('savePw stores current parameters and restorePw restores them', () => {
      applyTradeParams({
        mm_priceWatcherLowPriceInSourceCoin: 0.8,
        mm_priceWatcherHighPriceInSourceCoin: 1.2,
        mm_priceWatcherSource: 'BTC',
      });

      pw.savePw('depth-pm');
      expect(mockUtils.saveConfig).toHaveBeenCalledWith(false, 'PriceWatcher-savePw()');
      expect(mockTradeParams.saved_mm_priceWatcherSource).toBe('BTC');

      mockTradeParams.mm_priceWatcherLowPriceInSourceCoin = 0.1;
      mockTradeParams.mm_priceWatcherHighPriceInSourceCoin = 0.2;
      mockTradeParams.mm_priceWatcherSource = COIN2;

      const restored = pw.restorePw('after-pm');
      expect(restored).toBe(true);
      expect(mockTradeParams.mm_priceWatcherSource).toBe('BTC');
      expect(pw.getIsPriceActual()).toBe(false);
    });

    test('restorePw returns false when nothing was saved', () => {
      delete mockTradeParams.saved_mm_priceWatcher_timestamp;
      expect(pw.restorePw('noop')).toBe(false);
    });
  });

  describe('info strings', () => {
    test('getPwInfoString for static range in quote coin', () => {
      applyTradeParams({
        mm_priceWatcherSource: COIN2,
        mm_priceWatcherLowPriceInSourceCoin: 0.9,
        mm_priceWatcherHighPriceInSourceCoin: 1.1,
        mm_priceWatcherDeviationPercent: 2,
      });
      expect(pw.getPwInfoString()).toContain('from 0.9000 to 1.1000 USDT');
    });

    test('getPwInfoString for Pair@Exchange source', () => {
      applyTradeParams({
        mm_priceWatcherSource: `${PAIR}@OtherEx`,
        mm_priceWatcherSourcePolicy: 'strict',
        mm_priceWatcherAction: 'prevent',
        mm_priceWatcherDeviationPercent: 1.5,
      });
      expect(pw.getPwInfoString()).toContain(`based on _${PAIR}@OtherEx_`);
      expect(pw.getPwInfoString()).toContain('_prevent_ action');
    });

    test('getSetWithSupportPriceString reflects support-only range', async () => {
      applyTradeParams({
        mm_isPriceWatcherActive: false,
        mm_priceSupportLowPrice: 0.55,
      });
      await pw.reviewPrices();
      expect(pw.getSetWithSupportPriceString()).toContain('support price of 0.5500 USDT');
      expect(pw.getIsPriceRangeSetWithSupportPrice()).toBe(true);
    });
  });

  describe('setPriceRange static source (Case 2)', () => {
    test('uses low/high from source coin bounds without applying deviation again', async () => {
      applyTradeParams({
        mm_priceWatcherSource: COIN2,
        mm_priceWatcherLowPriceInSourceCoin: 1,
        mm_priceWatcherHighPriceInSourceCoin: 2,
        mm_priceWatcherDeviationPercent: 10,
      });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);

      await pw.reviewPrices();

      expect(pw.getIsPriceActual()).toBe(true);
      expect(pw.getLowPrice()).toBeCloseTo(1, 5);
      expect(pw.getHighPrice()).toBeCloseTo(2, 5);
    });
  });

  describe('setPriceRange Pair@Exchange', () => {
    test('uses strict bid/ask for same pair on external exchange (Case 1A)', async () => {
      applyTradeParams({
        mm_priceWatcherSource: `${PAIR}@OtherEx`,
        mm_priceWatcherSourcePolicy: 'strict',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockReturnValue(makeParsedMarket({ pair: PAIR }));
      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.95, 1.05));
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.94, smartAsk: 1.06 });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);

      await pw.reviewPrices();

      expect(pw.getLowPrice()).toBeCloseTo(0.95, 4);
      expect(pw.getHighPrice()).toBeCloseTo(1.05, 4);
      expect(pw.getIsPriceAnomaly()).toBe(false);
    });

    test('uses smart bid/ask when policy is smart', async () => {
      applyTradeParams({
        mm_priceWatcherSource: `${PAIR}@OtherEx`,
        mm_priceWatcherSourcePolicy: 'smart',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockReturnValue(makeParsedMarket({ pair: PAIR }));
      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.95, 1.05));
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.96, smartAsk: 1.04 });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);

      await pw.reviewPrices();

      expect(pw.getLowPrice()).toBeCloseTo(0.96, 4);
      expect(pw.getHighPrice()).toBeCloseTo(1.04, 4);
    });

    test('converts ADM/BTC@OtherEx via direct BTC/USDT cross-market pair (Case 1B.c)', async () => {
      applyTradeParams({
        mm_priceWatcherSource: 'ADM/BTC@OtherEx',
        mm_priceWatcherSourcePolicy: 'strict',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockImplementation((marketPair) => {
        if (marketPair === 'ADM/BTC') {
          return makeParsedMarket({
            pair: 'ADM/BTC',
            coin2: 'BTC',
            coin1Decimals: 8,
            coin2Decimals: 8,
          });
        }
        if (marketPair === 'BTC/USDT') {
          return makeParsedMarket({
            pair: 'BTC/USDT',
            coin1: 'BTC',
            coin2: COIN2,
            isParsed: true,
          });
        }
        return makeParsedMarket({ pair: marketPair, isParsed: false });
      });

      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.000015, 0.000017));
      mockPwExternalApi.getRates.mockResolvedValue({ bid: 64_000, ask: 65_000 });
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.000015, smartAsk: 0.000017 });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);
      mockUtils.numbersDifferencePercent.mockReturnValue(1);

      await pw.reviewPrices();

      expect(mockPwExternalApi.getRates).toHaveBeenCalledWith('BTC/USDT');
      expect(mockExchangerUtils.convertCryptos).toHaveBeenCalledWith(
          'BTC', COIN2, 0.000015, false, 64_000, false,
      );
      expect(mockExchangerUtils.convertCryptos).toHaveBeenCalledWith(
          'BTC', COIN2, 0.000017, false, 65_000, false,
      );
      expect(pw.getLowPrice()).toBeCloseTo(0.96, 3);
      expect(pw.getHighPrice()).toBeCloseTo(1.105, 3);
    });

    test('inverts USDT/BTC rates when only inverted cross-market exists', async () => {
      applyTradeParams({
        mm_priceWatcherSource: 'ADM/BTC@OtherEx',
        mm_priceWatcherSourcePolicy: 'strict',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockImplementation((marketPair) => {
        if (marketPair === 'ADM/BTC') {
          return makeParsedMarket({ pair: 'ADM/BTC', coin2: 'BTC', coin1Decimals: 8, coin2Decimals: 8 });
        }
        if (marketPair === `${COIN2}/BTC`) {
          return makeParsedMarket({
            pair: `${COIN2}/BTC`,
            coin1: COIN2,
            coin2: 'BTC',
            isParsed: true,
          });
        }
        if (marketPair === `BTC/${COIN2}`) {
          return makeParsedMarket({ pair: `BTC/${COIN2}`, coin1: 'BTC', coin2: COIN2, isParsed: false });
        }
        return makeParsedMarket({ pair: marketPair, isParsed: false });
      });

      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.000010, 0.000012));
      mockPwExternalApi.getRates.mockResolvedValue({ bid: 0.000015625, ask: 0.000016129 });
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.000010, smartAsk: 0.000012 });
      mockUtils.randomValue.mockImplementation((a, b) => a);
      mockUtils.numbersDifferencePercent.mockReturnValue(1);

      await pw.reviewPrices();

      expect(mockExchangerUtils.convertCryptos).toHaveBeenCalledWith(
          'BTC', COIN2, 0.000010, false, 1 / 0.000016129, false,
      );
      expect(mockExchangerUtils.convertCryptos).toHaveBeenCalledWith(
          'BTC', COIN2, 0.000012, false, 1 / 0.000015625, false,
      );
    });

    test('marks anomaly when cross-market conversion diverges from global rate', async () => {
      applyTradeParams({
        mm_priceWatcherSource: 'ADM/BTC@OtherEx',
        mm_priceWatcherSourcePolicy: 'strict',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockImplementation((marketPair) => {
        if (marketPair === 'ADM/BTC') {
          return makeParsedMarket({ pair: 'ADM/BTC', coin2: 'BTC' });
        }
        if (marketPair === 'BTC/USDT') {
          return makeParsedMarket({ pair: 'BTC/USDT', coin1: 'BTC', coin2: COIN2, isParsed: true });
        }
        return makeParsedMarket({ pair: marketPair, isParsed: false });
      });

      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.000015, 0.000017));
      mockPwExternalApi.getRates.mockResolvedValue({ bid: 50_000, ask: 51_000 });
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.000015, smartAsk: 0.000017 });
      mockUtils.randomValue.mockImplementation((a, b) => a);
      mockUtils.numbersDifferencePercent.mockImplementation((a, b) => {
        if (a > 0.5 && b > 0.5) {
          return 35;
        }
        return 1;
      });

      await pw.reviewPrices();

      expect(pw.getIsPriceAnomaly()).toBe(true);
      expect(pw.getIsPriceActualConsistentAndEnabled()).toBe(false);
    });

    test('falls back to global rates when cross-market is unavailable (Case 1B.g)', async () => {
      applyTradeParams({
        mm_priceWatcherSource: 'ADM/BTC@OtherEx',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockImplementation((marketPair) => {
        if (marketPair === 'ADM/BTC') {
          return makeParsedMarket({ pair: 'ADM/BTC', coin2: 'BTC' });
        }
        return makeParsedMarket({ pair: marketPair, isParsed: false });
      });

      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.000015, 0.000017));
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.000015, smartAsk: 0.000017 });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);

      await pw.reviewPrices();

      expect(mockPwExternalApi.getRates).not.toHaveBeenCalled();
      expect(pw.getIsPriceActual()).toBe(true);
      expect(pw.getLowPrice()).toBeCloseTo(0.96, 3);
    });

    test('clears isPriceAnomaly when switching back to static source', async () => {
      applyTradeParams({
        mm_priceWatcherSource: 'ADM/BTC@OtherEx',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockImplementation((marketPair) => {
        if (marketPair === 'ADM/BTC') {
          return makeParsedMarket({ pair: 'ADM/BTC', coin2: 'BTC' });
        }
        if (marketPair === 'BTC/USDT') {
          return makeParsedMarket({ pair: 'BTC/USDT', coin1: 'BTC', coin2: COIN2, isParsed: true });
        }
        return makeParsedMarket({ pair: marketPair, isParsed: false });
      });

      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.000015, 0.000017));
      mockPwExternalApi.getRates.mockResolvedValue({ bid: 50_000, ask: 51_000 });
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.000015, smartAsk: 0.000017 });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);
      mockUtils.numbersDifferencePercent.mockReturnValue(35);

      await pw.reviewPrices();
      expect(pw.getIsPriceAnomaly()).toBe(true);

      applyTradeParams({
        mm_priceWatcherSource: COIN2,
        mm_priceWatcherLowPriceInSourceCoin: 0.9,
        mm_priceWatcherHighPriceInSourceCoin: 1.1,
        mm_priceWatcherDeviationPercent: 0,
      });
      await pw.reviewPrices();

      expect(pw.getIsPriceAnomaly()).toBe(false);
    });

    test('keeps isPriceAnomaly when recalculation fails after anomaly was detected', async () => {
      applyTradeParams({
        mm_priceWatcherSource: 'ADM/BTC@OtherEx',
        mm_priceWatcherDeviationPercent: 0,
      });

      mockOrderUtils.parseMarket.mockImplementation((marketPair) => {
        if (marketPair === 'ADM/BTC') {
          return makeParsedMarket({ pair: 'ADM/BTC', coin2: 'BTC' });
        }
        if (marketPair === 'BTC/USDT') {
          return makeParsedMarket({ pair: 'BTC/USDT', coin1: 'BTC', coin2: COIN2, isParsed: true });
        }
        return makeParsedMarket({ pair: marketPair, isParsed: false });
      });

      mockPwExternalApi.getOrderBook.mockResolvedValue(makeOrderBook(0.000015, 0.000017));
      mockPwExternalApi.getRates.mockResolvedValue({ bid: 50_000, ask: 51_000 });
      mockUtils.getOrderBookInfo.mockReturnValue({ smartBid: 0.000015, smartAsk: 0.000017 });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);
      mockUtils.numbersDifferencePercent.mockReturnValue(35);

      await pw.reviewPrices();
      expect(pw.getIsPriceAnomaly()).toBe(true);

      mockPwExternalApi.getOrderBook.mockResolvedValue(null);
      await pw.reviewPrices();

      expect(pw.getIsPriceAnomaly()).toBe(true);
    });
  });

  describe('setPriceRange errors and retries', () => {
    test('keeps previous range for first failures then marks not actual after threshold', async () => {
      applyTradeParams({
        mm_priceWatcherSource: `${PAIR}@OtherEx`,
      });
      pw.setIsPriceActual(true, 'seed');
      mockOrderUtils.parseMarket.mockReturnValue(makeParsedMarket());
      mockPwExternalApi.getOrderBook.mockResolvedValue(null);

      for (let i = 0; i < 11; i++) {
        // eslint-disable-next-line no-await-in-loop
        await pw.reviewPrices();
      }

      expect(pw.getIsPriceActual()).toBe(false);
      expect(mockNotify).toHaveBeenCalled();
    });
  });

  describe('reviewPrices trading decisions', () => {
    beforeEach(async () => {
      applyTradeParams({
        mm_priceWatcherSource: COIN2,
        mm_priceWatcherLowPriceInSourceCoin: 0.9,
        mm_priceWatcherHighPriceInSourceCoin: 1.2,
        mm_priceWatcherDeviationPercent: 0,
        mm_priceWatcherAction: 'fill',
      });
      mockUtils.randomValue.mockImplementation((a, b) => (a + b) / 2);
      await pw.reviewPrices();
    });

    test('logs in-range and does not place orders when price fits Pw range', async () => {
      mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(1, 1.05));

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('within the allowed range'));
    });

    test('places buy pw-order when ask is below low bound', async () => {
      mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(0.8, 0.85));
      mockUtils.getOrderBookInfo.mockReturnValue({
        sideTargetPrice: 'buy',
        amountTargetPrice: 12,
        amountTargetPriceQuote: 10.2,
      });

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).toHaveBeenCalled();
      const placeOrderArgs = mockTraderApi.placeOrder.mock.calls[0];
      expect(placeOrderArgs[0]).toBe('buy');
      expect(placeOrderArgs[2]).toBe(pw.getLowPrice());
      expect(placeOrderArgs[3]).toBeGreaterThan(11);
    });

    test('places sell pw-order when bid is above high bound', async () => {
      mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(1.3, 1.35));
      mockUtils.getOrderBookInfo.mockReturnValue({
        sideTargetPrice: 'sell',
        amountTargetPrice: 12,
        amountTargetPriceQuote: 15.6,
      });

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).toHaveBeenCalled();
      const placeOrderArgs = mockTraderApi.placeOrder.mock.calls[0];
      expect(placeOrderArgs[0]).toBe('sell');
      expect(placeOrderArgs[2]).toBe(pw.getHighPrice());
      expect(placeOrderArgs[3]).toBeGreaterThan(11);
    });

    test('skips pw-order for prevent action when price is out of range', async () => {
      applyTradeParams({ mm_priceWatcherAction: 'prevent' });
      mockUtils.randomValue.mockImplementation((a, b) => a);
      await pw.reviewPrices();

      mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(0.8, 0.85));

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).not.toHaveBeenCalled();
      expect(mockLog.log).toHaveBeenCalledWith(expect.stringContaining('leaving it as is due to'));
    });

    test('still buys for support price under prevent action', async () => {
      applyTradeParams({
        mm_priceWatcherAction: 'prevent',
        mm_priceSupportLowPrice: 0.95,
        mm_isPriceWatcherActive: false,
      });
      mockUtils.randomValue.mockImplementation((a, b) => a);
      await pw.reviewPrices();

      mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(0.8, 0.85));
      mockUtils.getOrderBookInfo.mockReturnValue({
        sideTargetPrice: 'buy',
        amountTargetPrice: 11,
        amountTargetPriceQuote: 10.45,
      });

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Support price'));
    });

    test('skips pw-order for depth policy without second account', async () => {
      applyTradeParams({ mm_Policy: 'depth' });
      mockUtils.randomValue.mockImplementation((a, b) => a);
      await pw.reviewPrices();

      mockOrderUtils.getOrderBookCached.mockResolvedValue(makeOrderBook(1.3, 1.35));

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).not.toHaveBeenCalled();
    });

    test('returns early when order book is empty', async () => {
      mockOrderUtils.getOrderBookCached.mockResolvedValue({ bids: [], asks: [] });

      await pw.reviewPrices();

      expect(mockTraderApi.placeOrder).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Order books are empty'));
    });
  });

  describe('closePriceWatcherOrders', () => {
    test('cancels expired pw-orders and keeps active ones', async () => {
      const expiredOrder = {
        _id: 'expired',
        dateTill: 1,
        pair: PAIR,
        side: 'buy',
      };
      const activeOrder = {
        _id: 'active',
        dateTill: Number.MAX_SAFE_INTEGER,
        pair: PAIR,
        side: 'sell',
      };

      const result = await pw.closePriceWatcherOrders([expiredOrder, activeOrder]);

      expect(mockOrderCollector.clearOrderById).toHaveBeenCalledTimes(1);
      expect(result).toEqual([activeOrder]);
    });
  });

  describe('placePriceWatcherOrder', () => {
    test('returns early when order book info is incomplete', async () => {
      const placed = await pw.placePriceWatcherOrder(
          1, { sideTargetPrice: '', amountTargetPrice: 0, amountTargetPriceQuote: 0 }, 1,
      );
      expect(placed).toBeUndefined();
      expect(mockTraderApi.placeOrder).not.toHaveBeenCalled();
    });

    test('clears price-step orders and retries balances when funds are insufficient', async () => {
      mockOrderUtils.getBalancesCached
          .mockResolvedValueOnce([{ code: COIN2, free: 1, freezed: 0 }])
          .mockResolvedValueOnce([{ code: COIN2, free: 100, freezed: 0 }]);

      const placed = await pw.placePriceWatcherOrder(
          0.9,
          { sideTargetPrice: 'buy', amountTargetPrice: 10, amountTargetPriceQuote: 9 },
          0.85,
      );

      expect(mockOrderCollector.clearPriceStepOrders).toHaveBeenCalled();
      expect(placed).toBe(true);
    });

    test('escalates support-price fund freeing when still insufficient on buy', async () => {
      applyTradeParams({ mm_priceSupportLowPrice: 0.95 });
      mockOrderUtils.getBalancesCached
          .mockResolvedValueOnce([{ code: COIN2, free: 1, freezed: 0 }])
          .mockResolvedValueOnce([{ code: COIN2, free: 1, freezed: 0 }])
          .mockResolvedValueOnce([{ code: COIN2, free: 1, freezed: 0 }])
          .mockResolvedValueOnce([{ code: COIN2, free: 100, freezed: 0 }]);

      await pw.placePriceWatcherOrder(
          0.95,
          { sideTargetPrice: 'buy', amountTargetPrice: 10, amountTargetPriceQuote: 9.5 },
          0.9,
      );

      expect(mockOrderCollector.clearBuyOrdersToFreeQuoteCoin).toHaveBeenCalled();
    });
  });

  describe('setPwExchangeApi and getIsSameExchangePw', () => {
    test('getIsSameExchangePw is true when source targets config exchange', () => {
      applyTradeParams({ mm_priceWatcherSource: `${PAIR}@PwTestEx` });
      pw.setPwExchangeApi('PwTestEx', COIN1, COIN2);
      expect(pw.getIsSameExchangePw()).toBe(true);
    });

    test('reuses main trader API for different pair on same exchange', () => {
      mockLog.info.mockClear();
      pw.setPwExchangeApi(EXCHANGE, COIN1, 'BTC');
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('internal'));
    });

    test('does not reload internal API when same exchange pair is unchanged', () => {
      pw.setPwExchangeApi(EXCHANGE, COIN1, COIN2);
      mockLog.info.mockClear();
      pw.setPwExchangeApi(EXCHANGE, COIN1, COIN2);
      expect(mockLog.info).not.toHaveBeenCalled();
    });

    test('does not reload internal API when only exchange name casing changes', () => {
      pw.setPwExchangeApi(EXCHANGE, COIN1, COIN2);
      mockLog.info.mockClear();
      pw.setPwExchangeApi(EXCHANGE.toLowerCase(), COIN1, COIN2);
      expect(mockLog.info).not.toHaveBeenCalled();
    });
  });
});
