const fs = require('fs');
const path = require('path');

const configRootDir = path.join(__dirname, '../..');
const originalArgv = process.argv.slice();

function resolveSafeConfigName() {
  const configNames = fs.readdirSync(configRootDir)
      .map((fileName) => fileName.match(/^config\.(.+)\.jsonc$/i)?.[1])
      .filter(Boolean)
      .sort();

  const preferred = configNames.filter((name) => !name.startsWith('-') && !['default', 'test', 'dev'].includes(name));

  return preferred[0] || configNames[0];
}

process.argv = [process.argv[0], process.argv[1], resolveSafeConfigName()];

afterAll(() => {
  process.argv = originalArgv;
});
/**
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/bot/orderBookInfo.d.js').QuoteHunterBookSideRow} QuoteHunterBookSideRow
 */

const utils = require('../../helpers/utils');
const mocks = require('./utils.mock');

function expectRowsContaining(actualRows, expectedRows) {
  expect(actualRows).toEqual(expect.arrayContaining(
      expectedRows.map((expectedRow) => expect.objectContaining(expectedRow)),
  ));
}

describe("Order Book Information Tests", () => {
  // Add specific mock scenarios
  /**
  const allMocks = {
    heavyLoaded: mocks.heavyLoaded,
    sparse: mocks.sparse,
    randomPriceSteps: mocks.randomPriceSteps,
    consistentPriceSteps: mocks.consistentPriceSteps,
    largeOrdersDominated: mocks.largeOrdersDominated,
    smallOrdersDominated: mocks.smallOrdersDominated,
    ascendingPrice: mocks.ascendingPrice,
    descendingPrice: mocks.descendingPrice,
    volatileOrderBook: mocks.volatileOrderBook,
    balancedOrderBook: mocks.balancedOrderBook,
    ...
  };
  */

  // Add new mock scenarios
  /**
  const allMocks = {
    cl03_Top10BidsNotClean: mocks.cl03_Top10BidsNotClean,
    cl04_Top10AsksNotClean: mocks.cl04_Top10AsksNotClean,
    cl05_Top10BothSidesNotClean: mocks.cl05_Top10BothSidesNotClean,
  };
  */

  // Add Quote Hunter mock scenarios
  const allMocks = Object.fromEntries(
      Object.entries(mocks).filter(([mockName]) => mockName.startsWith('qh')),
  );

  // Add all mock scenarios
  // const allMocks = mocks;

  // Iterate through each mock scenario
  for (const mockName in allMocks) {
    test(`Test getOrderBookInfo with ${mockName}`, () => {
      console.log(`============================================================\nTesting ${mockName}:`);

      const mockData = allMocks[mockName];
      const orderBookInfoArgs = mockData.orderBookInfoArgs || {};
      const orderBook = /** @type {DepthResult} */ (/** @type {unknown} */ (mockData.orderBook));

      // Sorting asks and bids
      orderBook.asks.sort((a, b) => Number(a.price) - Number(b.price));
      orderBook.bids.sort((a, b) => Number(b.price) - Number(a.price));

      // Testing getOrderBookInfo
      const orderBookInfo = utils.getOrderBookInfo(
          orderBook,
          orderBookInfoArgs.placedAmount,
          orderBookInfoArgs.targetPrice,
          undefined,
          orderBookInfoArgs.openOrders,
          orderBookInfoArgs.openOrders ? 'TestQhTable' : 'Test',
      );

      if (orderBookInfo) {
        if (mockData.expectedValues) {
          expect(orderBookInfo.smartBid).toBe(mockData.expectedValues.smartBid);
          expect(orderBookInfo.smartAsk).toBe(mockData.expectedValues.smartAsk);
          expect(orderBookInfo.cleanBid).toBe(mockData.expectedValues.cleanBid);
          expect(orderBookInfo.cleanAsk).toBe(mockData.expectedValues.cleanAsk);
        }

        if (mockData.qhExpected) {
          expect(Array.isArray(orderBookInfo.qhTable)).toBe(true);

          if (mockData.qhExpected.qhTableOrder) {
            expect(orderBookInfo.qhTable.map((row) => row.bidPrice)).toEqual(mockData.qhExpected.qhTableOrder);
          }

          expectRowsContaining(orderBookInfo.qhTable, mockData.qhExpected.qhTable);

          if (mockData.qhExpected.bidsOrder) {
            expect(orderBookInfo.qhOwnThirdPartyTable.bids.map((row) => row.price)).toEqual(mockData.qhExpected.bidsOrder);
          }

          expectRowsContaining(orderBookInfo.qhOwnThirdPartyTable.bids, mockData.qhExpected.bids);

          if (mockData.qhExpected.asksOrder) {
            expect(orderBookInfo.qhOwnThirdPartyTable.asks.map((row) => row.price)).toEqual(mockData.qhExpected.asksOrder);
          }

          expectRowsContaining(orderBookInfo.qhOwnThirdPartyTable.asks, mockData.qhExpected.asks);
        }
      } else {
        console.warn(`Unable to calculate order book info for ${mockName}. Skipping.`);
      }
    });
  }
});

describe('summarizeQhTableMatch', () => {
  test('keeps the visible own-then-third-party execution sequence', () => {
    /** @type {QuoteHunterBookSideRow[]} */
    const rows = [
      {
        index: 0,
        price: 100,
        amount: 0.5,
        amountAcc: 0.5,
        quote: 50,
        quoteAcc: 50,
        ownAmount: 0.3,
        ownAmountAcc: 0.3,
        ownQuote: 30,
        ownQuoteAcc: 30,
        thirdPartyAmount: 0.2,
        thirdPartyAmountAcc: 0.2,
        thirdPartyQuote: 20,
        thirdPartyQuoteAcc: 20,
        startsWithOurOrders: true,
        startsWithThirdPartyOrders: false,
        side: 'bids',
      },
      {
        index: 1,
        price: 99,
        amount: 0.5,
        amountAcc: 1,
        quote: 49.5,
        quoteAcc: 99.5,
        ownAmount: 0.1,
        ownAmountAcc: 0.4,
        ownQuote: 9.9,
        ownQuoteAcc: 39.9,
        thirdPartyAmount: 0.4,
        thirdPartyAmountAcc: 0.6,
        thirdPartyQuote: 39.6,
        thirdPartyQuoteAcc: 59.6,
        startsWithOurOrders: false,
        startsWithThirdPartyOrders: false,
        side: 'bids',
      },
    ];
    const summary = utils.summarizeQhTableMatch(rows, 0.85);

    expect(summary).toEqual(expect.objectContaining({
      requestedAmount: 0.85,
      ownMatchedAmount: 0.4,
      thirdPartyMatchedAmount: 0.45,
      amountUntilThirdParty: 0.3,
      topStartsWithOurOrders: true,
      topStartsWithThirdPartyOrders: false,
    }));
    expect(summary.matchedAmount).toBeCloseTo(0.85, 10);
    expect(summary.ownMatchedQuote).toBeCloseTo(39.9, 10);
    expect(summary.thirdPartyMatchedQuote).toBeCloseTo(44.75, 10);
    expect(summary.matchedLevels).toEqual([
      {
        price: 100,
        ownMatchedAmount: 0.3,
        ownMatchedQuote: 30,
        thirdPartyMatchedAmount: 0.2,
        thirdPartyMatchedQuote: 20,
      },
      {
        price: 99,
        ownMatchedAmount: 0.1,
        ownMatchedQuote: 9.9,
        thirdPartyMatchedAmount: 0.25,
        thirdPartyMatchedQuote: 24.75,
      },
    ]);
  });

  test('sanitizes invalid input and reports an empty match', () => {
    expect(utils.summarizeQhTableMatch(undefined, -1)).toEqual({
      requestedAmount: 0,
      matchedAmount: 0,
      ownMatchedAmount: 0,
      ownMatchedQuote: 0,
      thirdPartyMatchedAmount: 0,
      thirdPartyMatchedQuote: 0,
      matchedLevels: [],
      amountUntilThirdParty: 0,
      topStartsWithOurOrders: false,
      topStartsWithThirdPartyOrders: false,
    });
  });
});

describe('softRequire', () => {
  test('resolves relative paths from the calling file', () => {
    const mod = utils.softRequire('../../helpers/const');

    expect(mod).toBeDefined();
    expect(mod).toBe(require('../../helpers/const'));
  });

  test('resolves relative paths from an explicit fromFile base', () => {
    const base = path.join(__dirname, '../../modules/commands/account.js');
    const mod = utils.softRequire('../../trade/mm_balance_watcher', base);

    expect(mod).toBeDefined();
    expect(typeof mod.guardBalances).toBe('function');
  });

  test('returns undefined for a missing relative module', () => {
    expect(utils.softRequire('./no-such-module-here', __filename)).toBeUndefined();
  });
});

beforeAll(() => {
  utils.setDebugDecimals(5, 2, 2);
});

afterAll(() => {
});
