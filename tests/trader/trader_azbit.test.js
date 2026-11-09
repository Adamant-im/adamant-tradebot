'use strict';

/**
 * @typedef {import('../../types/azbit/api.d.js').AzbitOrder} AzbitOrder
 * @typedef {import('../../types/order-info.d.js').OrderStatus} OrderStatus
 */

const MockAdapter = require('axios-mock-adapter');
const crypto = require('node:crypto');
const fs = require('node:fs');

jest.mock('../../modules/configReader', () => require('./stubConfigReader').forExchange('azbit', 'Azbit'));
jest.mock('../../helpers/log', () => require('./stubConfigReader').silentLog);
jest.mock('../../trade/settings/tradeParams_azbit', () => ({}), { virtual: true });
jest.mock('../../modules/commands/context', () => ({
  traderapi: { features: () => ({ supportCoinNetworks: true }) },
  utils: require('../../helpers/utils'),
}));

const { silentLog } = require('./stubConfigReader');
const Api = require('../../trade/api/azbit_api');
const Trader = require('../../trade/trader/trader_azbit');
const utils = require('../../helpers/utils');
const { supportedNetworksString } = require('../../modules/commands/info');

const base = 'https://data.azbit.com/api';
const metadataBase = 'https://api2.azbit.com/api';
const id = '70192a8b-c34e-48ce-badf-889584670507';
const market = {
  code: 'ADM_USDT',
  digitsPrice: 8,
  digitsAmount: 8,
  minBaseAmount: 1e-8,
  minQuoteAmount: 0.5,
};

const currency = (code, patch = {}) => ({
  code,
  value: code === 'ADM' ? 'ADAMANT Messenger' : 'Tether',
  isHalted: false,
  isFiat: false,
  isFuturesOnlyCurrency: false,
  digits: 8,
  allowDeposits: true,
  allowWithdrawals: true,
  networkConfirmations: code === 'ADM' ? '28' : '20',
  currencyChains: code === 'ADM' ?
    [{
      chainId: 350,
      isNativeToken: true,
      contractAddress: null,
      chainName: 'ADM',
      displayName: 'ADM',
      type: 0,
    }] :
    [{
      chainId: 140,
      isNativeToken: false,
      contractAddress: '0x-token',
      chainName: 'ETH',
      displayName: 'ETH',
      type: 0,
    }],
  ...patch,
});

const networkFees = [
  {
    currencyCode: 'ADM',
    chainCommissions: [{
      chainName: 'ADM',
      chainId: 350,
      minimalWithdrawal: 15,
      minimalWithdrawalCurrency: 'ADM',
      depositFee: 0,
      withdrawalFee: '15.0',
      withdrawalFeeCurrency: 'ADM',
    }],
  },
  {
    currencyCode: 'USDT',
    chainCommissions: [{
      chainName: 'ETH',
      chainId: 140,
      minimalWithdrawal: 5,
      minimalWithdrawalCurrency: 'USDT',
      depositFee: 0,
      withdrawalFee: '5.0',
      withdrawalFeeCurrency: 'USDT',
    }],
  },
];

const order = (patch = {}) => ({
  id,
  currencyPairCode: 'ADM_USDT',
  isBid: false,
  price: 0.02,
  initialAmount: 60,
  amount: 0,
  amountExecuted: 0,
  remainingAmount: 60,
  quoteAmount: 1.2,
  date: '2026-09-07T10:00:00Z',
  status: 'Created',
  isCanceled: false,
  deals: [],
  ...patch,
});

let mock;
let trader;
let api;
const statusEvidence = [];

beforeEach(async () => {
  mock = new MockAdapter(Api.axios, { onNoMatch: 'throwException' });

  Trader.exchangeMarkets = undefined;
  Trader.marketsPromise = undefined;
  Trader.exchangeCurrencies = undefined;
  Trader.currenciesPromise = undefined;

  mock.onGet(base + '/currencies/pairs').reply(200, [market]);

  trader = Trader('public', 'private', '', silentLog, false, false);
  api = Api();

  api.setConfig('https://data.azbit.com', 'public', 'private', '', silentLog);

  await trader.getMarkets();
});

afterEach(() => mock.restore());

afterAll(() => {
  if (process.env.AZBIT_MOCK_REPORT) {
    fs.writeFileSync(process.env.AZBIT_MOCK_REPORT,
        '# Azbit mock order-state evidence\n\nThese are simulated exchange payloads and their actual normalized test results, not live responses.\n\n' +
        '```json\n' + JSON.stringify(statusEvidence, null, 2) + '\n```\n');
  }
});

const activeUrl = base + '/user/orders?currencyPairCode=ADM_USDT&status=active';
const detailUrl = base + `/orders/${id}/deals`;

describe('Azbit wire contract', () => {
  test('public requests omit signing headers even on a configured private client', async () => {
    mock.onGet(base + '/tickers?currencyPairCode=ADM_USDT').reply((request) => {
      expect(request.headers['API-PublicKey']).toBeUndefined();
      expect(request.headers['API-Signature']).toBeUndefined();
      expect(request.data).toBeUndefined();
      return [200, []];
    });
    expect(await api.ticker('ADM_USDT')).toEqual([]);
  });

  test('official API2 metadata requests remain public and use their own origin', async () => {
    mock.onGet(metadataBase + '/currencies').reply((request) => {
      expect(request.headers['API-PublicKey']).toBeUndefined();
      expect(request.headers['API-Signature']).toBeUndefined();
      return [200, [currency('ADM')]];
    });
    expect(await api.getCurrenciesDetails()).toEqual([currency('ADM')]);
  });

  test('public requests preserve HTTP failures and sanitize transport errors', async () => {
    const url = base + '/tickers?currencyPairCode=ADM_USDT';

    mock.onGet(url).replyOnce(403, { Message: 'Denied' }).onGet(url).replyOnce(503, '').onGet(url).networkError();

    expect(await api.ticker('ADM_USDT')).toMatchObject({ httpStatus: 403, azbitErrorInfo: expect.stringContaining('Denied') });
    await expect(api.ticker('ADM_USDT')).rejects.toThrow('HTTP 503');
    await expect(api.ticker('ADM_USDT')).rejects.toThrow('Azbit GET /tickers transport failed — unknown transport failure');
  });

  test('signs the encoded query and sends no GET body', async () => {
    mock.onGet().reply((request) => {
      expect(request.url).toBe(base + '/user/orders?currencyPairCode=ADM_USDT&status=all');
      expect(request.data).toBeUndefined();
      expect(request.headers['API-Signature']).toBe(crypto.createHmac('sha256', 'private').update('public' + request.url).digest('hex'));
      return [200, []];
    });
    expect(await api.getOrders('ADM_USDT', 'all')).toEqual([]);
  });

  test('signs exactly the transmitted POST bytes', async () => {
    mock.onPost(base + '/v200/orders').reply((request) => {
      const expectedSignature = crypto.createHmac('sha256', 'private')
          .update('public' + request.url + request.data)
          .digest('hex');

      expect(request.headers['API-Signature']).toBe(expectedSignature);
      expect(JSON.parse(request.data)).toEqual({
        side: 'buy',
        currencyPairCode: 'ADM_USDT',
        amount: 30,
        price: 0.02,
      });

      return [200, { succeeded: true, data: { id } }];
    });

    expect(await api.addOrder('ADM_USDT', 30, 0.02, 'buy')).toEqual({
      succeeded: true,
      data: { id },
    });
  });

  test('DELETE signature has no phantom JSON body and includes accountId query', async () => {
    mock.onDelete().reply((request) => {
      expect(request.url).toBe(base + `/v200/orders/${id}?accountId=${id}`);
      expect(request.data).toBeUndefined();
      expect(request.headers['API-Signature']).toBe(crypto.createHmac('sha256', 'private').update('public' + request.url).digest('hex'));
      return [200, { succeeded: true }];
    });
    await api.cancelOrder(id, id);
  });

  test.each([401, 403, 400, 404, 422])('retains final HTTP %s errors', async (status) => {
    mock.onGet(base + '/wallets/balances').reply(status, { Message: 'Denied' });
    expect(await api.getBalances()).toMatchObject({ httpStatus: status, azbitErrorInfo: expect.stringContaining('Denied') });
    expect(await trader.getBalances()).toBeUndefined();
  });

  test('stores the configured logger and records authentication failures in the API client', async () => {
    const logger = { ...silentLog, warn: jest.fn() };

    api.setConfig('https://data.azbit.com', 'public', 'private', '', logger);
    mock.onGet(base + '/wallets/balances').replyOnce(401, { Message: 'Bad signature' }).onGet(base + '/wallets/balances').reply(403, { Message: 'Forbidden' });

    await api.getBalances();
    await api.getBalances();

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls.flat().join(' ')).toMatch(/HTTP 401.*HTTP 403/);
    expect(logger.warn.mock.calls.flat().join(' ')).not.toMatch(/public|private|API-Signature/);
  });

  test.each([408, 423, 429, 500, 502, 503, 504, 599])('rejects HTTP %s even without an error body', async (status) => {
    mock.onGet(base + '/wallets/balances').reply(status, '');
    await expect(api.getBalances()).rejects.toThrow(`HTTP ${status}`);
  });

  test('timeout is sanitized, does not retry a placement, and never exposes keys', async () => {
    mock.onPost().timeout();
    await expect(api.addOrder('ADM_USDT', 30, 0.02, 'buy', 'id')).rejects.toThrow('ECONNABORTED');
    expect(mock.history.post).toHaveLength(1);

    try {
      await api.addOrder('ADM_USDT', 30, 0.02, 'buy');
    } catch (error) {
      expect(/** @type {{config?: unknown}} */ (error).config).toBeUndefined();
      expect(String(error)).not.toMatch(/public|private|API-Signature/);
    }
  });

  test.each([null, false, '', undefined])('does not manufacture success from read payload %p', async (payload) => {
    mock.onGet(base + '/wallets/balances').reply(200, payload);
    expect(await trader.getBalances()).toBeUndefined();
  });

  test('public-only instances do not inherit private credentials', async () => {
    api.setConfig('https://data.azbit.com', 'public', 'private', '', silentLog, true);
    await expect(api.getBalances()).rejects.toThrow('not configured');
  });
});

describe('Azbit metadata and balances', () => {
  test('cached whole-list and pair lookups stay consistent for all accepted formats', async () => {
    const markets = await trader.getMarkets();

    for (const pair of ['adm/usdt', 'ADM-USDT', 'ADM_USDT', 'ADMUSDT']) expect(trader.marketInfo(pair)).toBe(markets.ADM_USDT);
    expect(await trader.getMarkets('ADM/USDT')).toBe(markets.ADM_USDT);
    expect(trader.marketInfo()).toBeUndefined();
  });

  test('concurrent market loads share the same request and all await its completion', async () => {
    Trader.exchangeMarkets = undefined;
    mock.resetHistory();

    const values = await Promise.all([trader.getMarkets(), trader.getMarkets('ADM/USDT'), trader.getMarkets()]);

    expect(values.every(Boolean)).toBe(true);
    expect(mock.history.get).toHaveLength(1);
  });

  test('rejects case-colliding native pair codes instead of caching an ambiguous market', async () => {
    Trader.exchangeMarkets = undefined;
    mock.onGet(base + '/currencies/pairs').reply(200, [
      { ...market, code: 'foo_USDT' },
      { ...market, code: 'FOO_USDT' },
    ]);

    expect(await trader.getMarkets()).toBeUndefined();
    expect(Trader.exchangeMarkets).toBeUndefined();
  });

  test('logs the offending native code and method for an invalid market pair', async () => {
    const warn = jest.fn();
    const loggingTrader = Trader('public', 'private', '', { ...silentLog, warn }, false, false);

    Trader.exchangeMarkets = undefined;
    mock.onGet(base + '/currencies/pairs').reply(200, [{ ...market, code: 'INVALID' }]);

    expect(await loggingTrader.getMarkets()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
        'Error while processing getMarkets() of trader_azbit.js: Invalid market pair "INVALID"',
    ));
  });

  test('logs the exact invalid field, value, pair and processing stage', async () => {
    const warn = jest.fn();
    const loggingTrader = Trader('public', 'private', '', { ...silentLog, warn }, false, false);

    await loggingTrader.getMarkets();
    mock.onGet(base + '/tickers?currencyPairCode=ADM_USDT').reply(200, [{
      currencyPairCode: 'ADM_USDT',
      price: 0.02,
      volume24h: 10,
      askPrice: 'not-a-number',
      bidPrice: 0.019,
      high24h: 0.022,
      low24h: 0.018,
    }]);

    expect(await loggingTrader.getRates('ADM/USDT')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
        'Error while processing getRates(ADM/USDT) of trader_azbit.js: Invalid ticker askPrice for "ADM_USDT" — ' +
        'received "not-a-number", expected a finite nonnegative number',
    ));
  });

  test('empty currencies settle and can be retried with detailed status, precision and network fees', async () => {
    mock.onGet(metadataBase + '/currencies').replyOnce(200, []).onGet(metadataBase + '/currencies').reply(200, [currency('ADM'), currency('USDT')]);
    mock.onGet(metadataBase + '/currency-pairs/network-commissions').reply(200, networkFees);

    expect(await trader.getCurrencies()).toBeUndefined();

    const currencies = await trader.getCurrencies();

    expect(currencies.ADM).toMatchObject({ symbol: 'ADM', name: 'ADAMANT Messenger', status: 'ONLINE', decimals: 8,
      depositEnabled: true, withdrawEnabled: true, defaultNetwork: 'ADM',
      networks: { ADM: { status: 'ONLINE', confirmations: '28', withdrawalFee: 15, minWithdrawal: 15 } } });
    expect(currencies.USDT.networks.ERC20).toMatchObject({ chainNamePlain: 'ETH', withdrawalFee: 5, minWithdrawal: 5,
      contractAddress: '0x-token' });
    expect(trader.currencyInfo('adm')).toBe(currencies.ADM);
  });

  test('forceUpdate refreshes cached currency availability', async () => {
    mock.onGet(metadataBase + '/currencies').replyOnce(200, [currency('ADM')])
        .onGet(metadataBase + '/currencies').reply(200, [currency('ADM', { isHalted: true, allowDeposits: false, allowWithdrawals: false })]);
    mock.onGet(metadataBase + '/currency-pairs/network-commissions').reply(200, networkFees);

    expect((await trader.getCurrencies('ADM')).status).toBe('ONLINE');
    expect((await trader.getCurrencies('ADM', true)).status).toBe('OFFLINE');
  });

  test('merges locked-only assets and absent frozen rows without losing balances', async () => {
    mock.onGet(base + '/wallets/balances').reply(200, { balances: [{ currencyCode: 'ADM', amount: 10 }, { currencyCode: 'BTC', amount: 0 }],
      balancesBlockedInOrder: [{ currencyCode: 'USDT', amount: 2 }] });

    expect(await trader.getBalances()).toEqual([
      { code: 'ADM', free: 10, freezed: 0, total: 10, accountType: 'unified' },
      { code: 'USDT', free: 0, freezed: 2, total: 2, accountType: 'unified' },
    ]);
    expect(await trader.getBalances(false)).toHaveLength(3);
  });

  test.each(['funding', 'all', 'isolated', '', null])('does not silently route unsupported account %p', async (account) => {
    mock.resetHistory();

    expect(await trader.getBalances(true, account)).toBeUndefined();
    expect(mock.history.get).toHaveLength(0);
  });

  test.each([
    {},
    { balances: [], balancesBlockedInOrder: null },
    { balances: [{ currencyCode: 'ADM', amount: null }], balancesBlockedInOrder: [] },
  ])('rejects malformed balances %p', async (data) => {
    mock.onGet(base + '/wallets/balances').reply(200, data);
    expect(await trader.getBalances()).toBeUndefined();
  });

  test('UTA types are read from accountType, not mutable names', async () => {
    mock.onGet(base + '/uta/accounts').reply(200, [{
      id,
      name: 'Funding',
      accountType: 'UnifiedTradingMain',
      currencyCode: 'USDT',
      balance: 4,
      usedMargin: 0,
      blockedCopyTradingBalance: 0,
    }]);

    expect((await trader.getAccounts())[0].accountType).toBe('UnifiedTradingMain');
    expect(trader.features()).toMatchObject({
      getCurrencies: true,
      getTradingFees: true,
      supportCoinNetworks: true,
      placeMarketOrder: false,
      allowAmountForMarketBuy: false,
      allowAmountForMarketSell: false,
      amountForMarketOrderNecessary: false,
      supportTransferBetweenAccounts: false,
    });
  });

  test('accepts finite decimal strings across normalized read paths', async () => {
    Trader.exchangeMarkets = undefined;
    mock.onGet(base + '/currencies/pairs').reply(200, [{
      ...market,
      digitsPrice: '8',
      digitsAmount: '8',
      minBaseAmount: '0.00000001',
      minQuoteAmount: '0.5',
    }]);

    const markets = await trader.getMarkets();

    expect(markets.ADM_USDT).toMatchObject({ coin1Decimals: 8, coin2Decimals: 8, minTrade: 0.5 });

    mock.onGet(base + '/wallets/balances').reply(200, {
      balances: [{ currencyCode: 'ADM', amount: '10.5' }],
      balancesBlockedInOrder: [{ currencyCode: 'ADM', amount: '1.5' }],
    });
    expect((await trader.getBalances())[0]).toMatchObject({ free: 10.5, freezed: 1.5, total: 12 });

    mock.onGet(base + '/uta/accounts').reply(200, [{
      id,
      accountType: 'UnifiedTradingMain',
      currencyCode: 'USDT',
      balance: '4.5',
      usedMargin: '1.25',
      blockedCopyTradingBalance: '0',
    }]);
    expect((await trader.getAccounts())[0]).toMatchObject({ balance: 4.5, usedMargin: 1.25, blockedCopyTradingBalance: 0 });

    mock.onGet(detailUrl).reply(200, order({
      price: '0.02',
      initialAmount: '60',
      amountExecuted: '30',
      remainingAmount: '30',
      quoteAmount: '1.2',
      status: 'PartiallyCompleted',
    }));
    expect(await trader.getOrderDetails(id)).toMatchObject({ price: 0.02, amount: 60, amountExecuted: 30, volume: 1.2 });

    mock.onGet(base + '/tickers?currencyPairCode=ADM_USDT').reply(200, [{
      currencyPairCode: 'ADM_USDT',
      price: '0.02',
      volume24h: '10',
      askPrice: '0.021',
      bidPrice: '0.019',
      high24h: '0.022',
      low24h: '0.018',
    }]);
    expect(await trader.getRates('ADM/USDT')).toMatchObject({ last: 0.02, volumeInCoin2: 10 });

    mock.onGet(base + '/orderbook?currencyPairCode=ADM_USDT').reply(200, [{ isBid: true, price: '0.019', amount: '12.5' }]);
    expect((await trader.getOrderBook('ADM/USDT')).bids[0]).toMatchObject({ price: 0.019, amount: 12.5 });

    mock.onGet(new RegExp('/deals\\?')).reply(200, [{
      id: 'deal',
      currencyPairCode: 'ADM_USDT',
      isBuy: true,
      volume: '12.5',
      price: '0.02',
      dealDateUtc: '2026-09-07T10:00:00Z',
    }]);
    expect((await trader.getTradesHistory('ADM/USDT'))[0]).toMatchObject({ coin1Amount: 12.5, coin2Amount: 0.25 });

    const since = Date.parse('2026-09-01T00:00:00Z');
    mock.onGet(new RegExp('/ohlc\\?')).reply(200, [{
      date: '2026-09-01T00:00:00Z',
      open: '0.02',
      close: '0.021',
      max: '0.022',
      min: '0.019',
      volume: '100',
      volumeBase: '2.1',
    }]);
    expect((await trader.getCandlesHistory('ADM/USDT', '1d', since, 1))[0]).toMatchObject({ open: 0.02, baseVolume: 100 });

    mock.onGet(base + '/currencies/user/commissions').reply(200, {
      userNoTradeCommissions: false,
      commissions: [
        { currencyCode: 'ADM', percent: '0.2', minimum: '0', commissionTypeCode: '3' },
        { currencyCode: 'ADM', percent: '0.4', minimum: '0', commissionTypeCode: '4' },
      ],
    });
    expect(await trader.getFees('ADM/USDT')).toEqual([{ pair: 'ADM_USDT', makerRate: 0.002, takerRate: 0.004 }]);
  });

  test('accepts numeric strings in detailed currency and network metadata', async () => {
    const stringCurrency = currency('ADM', {
      digits: '8',
      currencyChains: [{ ...currency('ADM').currencyChains[0], chainId: '350' }],
    });
    const stringFees = [{
      ...networkFees[0],
      chainCommissions: [{
        ...networkFees[0].chainCommissions[0],
        chainId: '350',
        minimalWithdrawal: '15',
        depositFee: '0',
      }],
    }];

    mock.onGet(metadataBase + '/currencies').reply(200, [stringCurrency]);
    mock.onGet(metadataBase + '/currency-pairs/network-commissions').reply(200, stringFees);

    expect(await trader.getCurrencies('ADM')).toMatchObject({
      decimals: 8,
      networks: { ADM: { decimals: 8, minWithdrawal: 15, withdrawalFee: 15 } },
    });
  });

  test('normalizes Azbit buy/sell percentages as maker/taker rates', async () => {
    mock.onGet(base + '/currencies/user/commissions').reply(200, { userNoTradeCommissions: false, commissions: [
      { currencyCode: 'ADM', percent: 0.2, minimum: 0, commissionCurrencyCode: null, commissionTypeCode: '3' },
      { currencyCode: 'ADM', percent: 0.2, minimum: 0, commissionCurrencyCode: null, commissionTypeCode: '4' },
    ] });

    expect(await trader.getFees('ADM/USDT')).toEqual([{ pair: 'ADM_USDT', makerRate: 0.002, takerRate: 0.002 }]);
    expect(await trader.getFees('ADM')).toEqual([{ pair: 'ADM_USDT', makerRate: 0.002, takerRate: 0.002 }]);
  });

  test('preserves asymmetric buy/maker and sell/taker rates', async () => {
    mock.onGet(base + '/currencies/user/commissions').reply(200, { userNoTradeCommissions: false, commissions: [
      { currencyCode: 'ADM', percent: 0.2, minimum: 0, commissionCurrencyCode: null, commissionTypeCode: '3' },
      { currencyCode: 'ADM', percent: 0.4, minimum: 0, commissionCurrencyCode: null, commissionTypeCode: '4' },
    ] });

    expect(await trader.getFees('ADM/USDT')).toEqual([{ pair: 'ADM_USDT', makerRate: 0.002, takerRate: 0.004 }]);
  });

  test('honors an account-wide trading fee exemption even when the schedule is null', async () => {
    mock.onGet(base + '/currencies/user/commissions').reply(200, { userNoTradeCommissions: true, commissions: null });

    expect(await trader.getFees('ADM/USDT')).toEqual([{ pair: 'ADM_USDT', makerRate: 0, takerRate: 0 }]);
  });

  test('treats an omitted commission schedule as a final empty schedule instead of an API failure', async () => {
    mock.onGet(base + '/currencies/user/commissions')
        .replyOnce(200, { userNoTradeCommissions: true })
        .onGet(base + '/currencies/user/commissions').reply(200, { userNoTradeCommissions: false });

    expect(await trader.getFees('ADM/USDT')).toEqual([{ pair: 'ADM_USDT', makerRate: 0, takerRate: 0 }]);
    expect(await trader.getFees('ADM/USDT')).toEqual([]);
  });
});

describe('Azbit order reconciliation', () => {
  /** @type {Array<[OrderStatus, AzbitOrder]>} */
  const orderStateCases = [
    ['new', {}],
    ['part_filled', { status: 'PartiallyCompleted', amountExecuted: 30, remainingAmount: 30 }],
    ['filled', { status: 'Completed', amountExecuted: 60, remainingAmount: 0 }],
    ['cancelled', { status: 'Canceled', isCanceled: true }],
    ['cancelled', { status: 'Canceled', isCanceled: true, amountExecuted: 30, remainingAmount: 30 }],
  ];
  test.each(orderStateCases)('normalizes %s using explicit cumulative execution and ignores stale deprecated amount', async (status, patch) => {
    mock.onGet(detailUrl).reply(200, order(patch));
    const result = await trader.getOrderDetails(id, 'ADM/USDT');
    statusEvidence.push({ raw: order(patch), normalized: result });
    expect(result.status).toBe(status);
    expect(result.amountExecuted).toBe(patch.amountExecuted || 0);
    expect(result.timestamp).toBe(Date.parse('2026-09-07T10:00:00Z'));
    expect(result.type).toBe('limit');
  });
  test('supports historical execution field when explicit field is omitted', async () => {
    const data = order({ amount: 30, remainingAmount: 30, status: 'PartiallyCompleted' });
    delete data.amountExecuted;
    mock.onGet(detailUrl).reply(200, data);
    expect((await trader.getOrderDetails(id)).amountExecuted).toBe(30);
  });
  test('uses actual executions for price improvement instead of limit price', async () => {
    mock.onGet(detailUrl).reply(200, order({ amountExecuted: 60, remainingAmount: 0, status: 'Completed',
      deals: [{ currencyPairCode: 'ADM_USDT', volume: 60, price: 0.019 }] }));
    expect((await trader.getOrderDetails(id)).volumeExecuted).toBeCloseTo(1.14);
  });
  test('unknown only for invalid IDs or explicit not-found, never generic 400/auth failures', async () => {
    const invalid = await trader.getOrderDetails('bad');
    statusEvidence.push({ input: 'bad', raw: 'No HTTP request', normalized: invalid });
    expect(invalid.status).toBe('unknown');
    mock.onGet(detailUrl).replyOnce(404, { status: 404 }).onGet(detailUrl).replyOnce(400, 'Try again later').onGet(detailUrl).reply(403, 'Denied');
    expect((await trader.getOrderDetails(id)).status).toBe('unknown');
    expect(await trader.getOrderDetails(id)).toBeUndefined();
    expect(await trader.getOrderDetails(id)).toBeUndefined();
  });
  test.each([{ status: 'FutureStatus' }, { amountExecuted: 70 }, { remainingAmount: 1 }, { status: 'Completed' },
    { date: 'bad' }, { price: null }, { price: '' }, { price: 'Infinity' }, { isBid: null },
    { currencyPairCode: 'BTC_USDT' }, { id: 'another-id' }, { deals: null }])('rejects inconsistent details %p', async (patch) => {
    mock.onGet(detailUrl).reply(200, order(patch));
    expect(await trader.getOrderDetails(id, 'ADM/USDT')).toBeUndefined();
  });
  test('active rows have readable/plain symbols', async () => {
    mock.onGet(activeUrl).reply(200, [order()]);

    expect((await trader.getOpenOrders('ADM/USDT'))[0]).toMatchObject({
      symbol: 'ADM/USDT',
      symbolPlain: 'ADM_USDT',
      status: 'new',
      amountLeft: 60,
    });
  });

  test('rejects the whole active-order response when it contains a terminal order', async () => {
    mock.onGet(activeUrl).reply(200, [order({
      status: 'Completed',
      amountExecuted: 60,
      remainingAmount: 0,
    })]);

    expect(await trader.getOpenOrders('ADM/USDT')).toBeUndefined();
  });

  test('rejects the whole active-order response when an order ID is duplicated', async () => {
    mock.onGet(activeUrl).reply(200, [order(), order({ id: id.toUpperCase() })]);

    expect(await trader.getOpenOrders('ADM/USDT')).toBeUndefined();
  });

  test('returns an empty active list without secondary history or detail requests', async () => {
    mock.onGet(activeUrl).reply(200, []);
    const requestCountBefore = mock.history.get.length;

    expect(await trader.getOpenOrders('ADM/USDT')).toEqual([]);
    expect(mock.history.get).toHaveLength(requestCountBefore + 1);
    expect(mock.history.get.at(-1).url).toBe(activeUrl);
  });

  test('malformed list and unsupported pair never become an empty list', async () => {
    mock.onGet(activeUrl).reply(200, {});
    expect(await trader.getOpenOrders('ADM/USDT')).toBeUndefined();
    expect(await trader.getOpenOrders('BOGUS/USDT')).toBeUndefined();
  });

  test('cancellation uses one DELETE, remembers terminal IDs and differentiates final/transient failures', async () => {
    const ids = Array.from({ length: 5 }, (_, index) => id.slice(0, -1) + index);
    const detailsBefore = mock.history.get.length;

    mock.onDelete(base + `/v200/orders/${ids[0]}`).reply(200, { succeeded: true });
    mock.onDelete(base + `/v200/orders/${ids[1]}`).reply(200, { succeeded: false, logicError: 'OrderNotFound' });
    mock.onDelete(base + `/v200/orders/${ids[2]}`).reply(403, 'Denied');
    mock.onDelete(base + `/v200/orders/${ids[3]}`).reply(503);
    mock.onDelete(base + `/v200/orders/${ids[4]}`).reply(200, {});

    expect(await trader.cancelOrder(ids[0])).toBe(true);
    expect(await trader.cancelOrder(ids[0])).toBe(false);
    expect(await trader.cancelOrder(ids[1])).toBe(false);
    expect(await trader.cancelOrder(ids[2])).toBeUndefined();
    expect(await trader.cancelOrder(ids[3])).toBeUndefined();
    expect(await trader.cancelOrder(ids[4])).toBeUndefined();
    expect(await trader.cancelOrder('bad')).toBe(false);
    expect(mock.history.delete).toHaveLength(5);
    expect(mock.history.get).toHaveLength(detailsBefore);
  });
  test('bulk cancellation uses its pair-scoped endpoint and only accepts its empty response contract', async () => {
    mock.onDelete(base + '/orders?currencyPairCode=ADM_USDT').replyOnce(200, '').onDelete().reply(200, { unexpected: true });
    expect(await trader.cancelAllOrders('ADM/USDT')).toBe(true);
    expect(await trader.cancelAllOrders('ADM/USDT')).toBeUndefined();
    expect(await trader.cancelAllOrders()).toBeUndefined();
  });
});

describe('Azbit order validation and market data', () => {
  test.each([
    ['buy', 'ADM/USDT', 0.02, 30, 0], ['wat', 'ADM/USDT', 0.02, 30, 1], ['buy', 'BOGUS/USDT', 0.02, 30, 1],
    ['buy', 'ADM/USDT', 0, 30, 1], ['buy', 'ADM/USDT', Infinity, 30, 1], ['buy', 'ADM/USDT', -1, 30, 1],
    ['buy', 'ADM/USDT', 0.02, null, 1], ['buy', 'ADM/USDT', 0.02, NaN, 1], ['buy', 'ADM/USDT', 0.02, -1, 1],
    ['buy', 'ADM/USDT', 0.02, 1, 1], ['buy', 'ADM/USDT', 1e-10, 30, 1],
  ])('invalid order is rejected locally: %p %p %p %p %p', async (...args) => {
    const result = await trader.placeOrder(...args);
    expect(result.orderId).toBe(false);
    expect(result.message).toMatch(/^Unable to place an order on Azbit exchange\./);
    expect(mock.history.post).toHaveLength(0);
  });
  test.each([
    [['buy', 'BOGUS/USDT', 0.02, 30, 1], 'I don\'t have info about market BOGUS/USDT'],
    [['wat', 'ADM/USDT', 0.02, 30, 1], 'Unsupported order side "wat"; expected "buy" or "sell"'],
    [['buy', 'ADM/USDT', 0.02, 30, 0], 'Unsupported limit flag 0; Azbit supports limit orders only'],
    [['buy', 'ADM/USDT', Infinity, 30, 1], 'Invalid order price Infinity for ADM/USDT'],
    [['buy', 'ADM/USDT', 1e-10, 30, 1], 'order price is 0; expected a positive value'],
    [['buy', 'ADM/USDT', 0.02, null, 1], 'Invalid order volume undefined for ADM/USDT'],
    [['buy', 'ADM/USDT', 0.02, NaN, 1], 'Invalid order amount NaN for ADM/USDT'],
    [['buy', 'ADM/USDT', 0.02, 1, 1], 'Order volume 0.02 USDT is less than minimum 0.5 USDT'],
  ])('returns a specific local placement error for %p', async (args, expected) => {
    const result = await trader.placeOrder(...args);
    expect(result).toMatchObject({ orderId: false, message: expect.stringContaining(expected) });
    expect(mock.history.post).toHaveLength(0);
  });
  test('preserves final exchange rejection details but leaves temporary failures retryable', async () => {
    const url = base + '/v200/orders';
    mock.onPost(url).replyOnce(400, { Message: 'Insufficient funds' })
        .onPost(url).replyOnce(200, { succeeded: false, errorsString: 'Trading disabled' })
        .onPost(url).replyOnce(200, { succeeded: true })
        .onPost(url).replyOnce(503, '');
    expect(await trader.placeOrder('buy', 'ADM/USDT', 0.02, 30)).toMatchObject({
      orderId: false,
      message: expect.stringContaining('HTTP 400 — Insufficient funds'),
    });
    expect(await trader.placeOrder('buy', 'ADM/USDT', 0.02, 30)).toMatchObject({
      orderId: false,
      message: expect.stringContaining('HTTP 200 — Trading disabled'),
    });
    expect(await trader.placeOrder('buy', 'ADM/USDT', 0.02, 30)).toMatchObject({
      orderId: false,
      message: expect.stringContaining('Invalid creation acknowledgement'),
    });
    expect(await trader.placeOrder('buy', 'ADM/USDT', 0.02, 30)).toBeUndefined();
  });
  test('quote-only size uses truncated price and base precision', async () => {
    mock.onPost().reply((request) => {
      const body = JSON.parse(request.data);
      expect(body.price).toBe(0.02);
      expect(body.amount).toBe(30);
      return [200, { succeeded: true, data: { id } }];
    });
    expect((await trader.placeOrder('sell', 'ADM/USDT', 0.020000009, undefined, 1, 0.6)).orderId).toBe(id);
  });
  test('accepts the null quote amount every market-making module passes', async () => {
    mock.onPost().reply((request) => {
      expect(JSON.parse(request.data)).toMatchObject({ amount: 30, price: 0.02 });
      return [200, { succeeded: true, data: { id } }];
    });
    expect((await trader.placeOrder('buy', 'ADM/USDT', 0.02, 30, 1, null)).orderId).toBe(id);
    expect((await trader.placeOrder('sell', 'ADM/USDT', 0.02, 30, 1, undefined)).orderId).toBe(id);
  });

  test('rejects market orders before sending a request', async () => {
    expect(await trader.placeOrder('buy', 'ADM/USDT', null, 50, 0)).toMatchObject({
      orderId: false,
      message: expect.stringContaining('Unsupported limit flag 0; Azbit supports limit orders only'),
    });
    expect(mock.history.post).toHaveLength(0);
  });
  test('nice chart 30-day 5m window is served instead of rejected', async () => {
    const now = Math.floor(Date.now() / 300000) * 300000;
    mock.onGet(new RegExp('/ohlc\\?')).reply(200, [{
      date: new Date(now - 300000).toISOString(),
      open: 1,
      close: 1,
      max: 1,
      min: 1,
      volume: 1,
      volumeBase: 1,
    }]);
    const candles = await trader.getCandlesHistory('ADM/USDT', '5m', Date.now() - 30 * 86400000, 8640, true);
    expect(candles).toHaveLength(1);
  });
  test('recomputes notional instead of trusting a conflicting quote amount', async () => {
    expect(await trader.placeOrder('buy', 'ADM/USDT', 0.02, 1, 1, 100)).toMatchObject({
      orderId: false,
      message: expect.stringContaining('Order volume 0.02 USDT is less than minimum 0.5 USDT'),
    });
    expect(mock.history.post).toHaveLength(0);
  });
  test('preserves live ticker quote turnover despite incorrect schema prose', async () => {
    mock.onGet(base + '/tickers?currencyPairCode=ADM_USDT').reply(200, [{ currencyPairCode: 'ADM_USDT', price: 0.02, volume24h: 2,
      bidPrice: 0.019, askPrice: 0.021, high24h: 0.023, low24h: 0.018 }]);
    expect(await trader.getRates('ADM/USDT')).toMatchObject({ volume: 100, volumeInCoin2: 2 });
  });
  test('book validates levels and sorts both sides', async () => {
    mock.onGet(base + '/orderbook?currencyPairCode=ADM_USDT').reply(200, [
      { isBid: false, price: 3, amount: 2 }, { isBid: false, price: 2, amount: 4 },
      { isBid: true, price: 1, amount: 3 }, { isBid: true, price: 1.5, amount: 4 },
    ]);
    const book = await trader.getOrderBook('ADM/USDT', 1);
    expect(book.asks[0].price).toBe(2);
    expect(book.bids[0].price).toBe(1.5);
  });
  test('trades accept already-UTC timestamps and sort ascending', async () => {
    mock.onGet(new RegExp('/deals\\?')).reply(200, [
      { id: 'a', currencyPairCode: 'ADM_USDT', isBuy: true, volume: 30, price: 0.02, dealDateUtc: '2026-09-07T10:01:00Z' },
      { id: 'b', currencyPairCode: 'ADM_USDT', isBuy: false, volume: 30, price: 0.02, dealDateUtc: '2026-09-07T10:00:00' },
    ]);
    expect((await trader.getTradesHistory('ADM/USDT')).map((x) => x.tradeId)).toEqual(['b', 'a']);
  });
  test('candles use server since, corrected OHLC bounds, actual volumes and exclusive tsClose', async () => {
    const since = Date.parse('2026-09-01T00:00:00Z');
    mock.onGet(new RegExp('/ohlc\\?')).reply((request) => {
      expect(new URL(request.url).searchParams.get('start')).toBe(new Date(since).toISOString());
      return [200, [{ date: '2026-09-01T00:00:00', open: 0.018, max: 0.017, min: 0.015, close: 0.016, volume: 100, volumeBase: 1.6 }]];
    });
    const candles = await trader.getCandlesHistory('ADM/USDT', '1d', since, 2);
    expect(candles[0]).toMatchObject({ tsOpen: since, tsClose: since + 86400000, high: 0.018, low: 0.015,
      baseVolume: 100, quoteVolumeCalc: 1.6, vwp: 0.016, source: 'native' });
  });
  test('excludeLastPartialCandle keeps the most recent closed candle and excludes the current one', async () => {
    const now = Math.floor(Date.now() / 60000) * 60000;
    const candle = (t) => ({ date: new Date(t).toISOString(), open: 1, close: 1, max: 1, min: 1, volume: 1, volumeBase: 1 });
    mock.onGet(new RegExp('/ohlc\\?')).reply(200, [candle(now - 60000), candle(now)]);
    expect((await trader.getCandlesHistory('ADM/USDT', '1m', undefined, 1))[0].tsOpen).toBe(now - 60000);
    expect((await trader.getCandlesHistory('ADM/USDT', '1m', undefined, 1, false))[0].tsOpen).toBe(now);
  });
  test.each([
    ['2m', undefined, 1],
    ['constructor', undefined, 1],
    ['1m', -1, 1],
    ['1m', '2026-09-01', 1],
    ['1m', undefined, 0],
    ['1m', undefined, 10001],
  ])('invalid candles reject locally %p %p %p', async (frame, since, limit) => {
    mock.resetHistory();
    expect(await trader.getCandlesHistory('ADM/USDT', frame, since, limit)).toBeUndefined();
    expect(mock.history.get).toHaveLength(0);
  });
  test('deposit address preserves memo and resolves numeric chain IDs', async () => {
    mock.onGet(metadataBase + '/currencies').reply(200, [currency('USDT')]);
    mock.onGet(metadataBase + '/currency-pairs/network-commissions').reply(200, [networkFees[1]]);
    mock.onGet(base + '/currencies/chains').reply(200, [{ code: 240, name: 'TRX' }]);
    mock.onGet(base + '/deposit-address/USDT').reply(200, [{ chain: 240, address: 'test-address', addressMemo: '123' }]);

    expect(await trader.getDepositAddress('usdt')).toEqual([{ network: 'TRC20', address: 'test-address', memo: '123' }]);
  });

  test('deposit address preserves punctuation and uppercases the currency code', async () => {
    const specialCurrency = currency('USDT.z');
    const specialFees = {
      ...networkFees[1],
      currencyCode: 'USDT.z',
    };

    mock.onGet(metadataBase + '/currencies').reply(200, [specialCurrency]);
    mock.onGet(metadataBase + '/currency-pairs/network-commissions').reply(200, [specialFees]);
    mock.onGet(base + '/currencies/chains').reply(200, [{ code: 140, name: 'ETH' }]);
    mock.onGet(base + '/deposit-address/USDT.Z').reply(200, [{
      chain: 140,
      address: 'test-address',
    }]);

    expect((await trader.getCurrencies('usdt.z')).id).toBe('USDT.Z');
    expect(await trader.getDepositAddress('usdt.z')).toEqual([{
      network: 'ERC20',
      address: 'test-address',
      memo: undefined,
    }]);
  });
});

describe('shared precision and timestamp helpers', () => {
  test.each([[1.999, 2, 1.99], [1e-8, 8, 1e-8], [1e-9, 8, 0], [1.23e20, 0, 1.23e20], [0.6, 8, 0.6], [1.999999999, 8, 1.99999999]])('truncates %p to %p decimals', (value, decimals, expected) => {
    expect(utils.truncateDecimals(value, decimals)).toBe(expected);
  });
  test.each(['2026-09-07T10:00:00Z', '2026-09-07T10:00:00', '2026-09-07T13:00:00+03:00',
    '2026-09-07T13:00:00+0300', '2026-09-07T10:00:00.0000000Z'])('normalizes timestamp %p', (value) => {
    expect(utils.parseUtcTimestamp(value)).toBe(Date.parse('2026-09-07T10:00:00Z'));
  });
});

describe('Azbit percentage withdrawal fee presentation', () => {
  test('shows a percentage together with the fee currency without assuming its calculation base', () => {
    const result = supportedNetworksString({
      name: 'BMINU',
      symbol: 'BMINU',
      networks: {
        BEP20: {
          symbol: 'BMINU',
          status: 'ONLINE',
          withdrawalFee: '22.5%',
          withdrawalFeeCurrency: 'BMINU',
          minWithdrawal: 0,
        },
      },
    });

    expect(result).toContain('Withdrawal fee — 22.5% (fee currency — BMINU)');
    expect(result).not.toContain('22.5% BMINU');
  });
});

describe('regressions discovered in live payloads', () => {
  test('cancelled remainder is zero while executed quantity excludes cancelled size', async () => {
    mock.onGet(detailUrl).reply(200, order({ status: 'Canceled', isCanceled: true, amount: 60, amountExecuted: 30, remainingAmount: 0 }));
    const result = await trader.getOrderDetails(id, 'ADM/USDT');
    expect(result).toMatchObject({ status: 'cancelled', amountExecuted: 30, volumeExecuted: 0.6 });
    expect(await trader.cancelOrder(id)).toBe(false);
    expect(mock.history.delete).toHaveLength(0);
  });
  test('cancelled legacy amount alone is not fill evidence', async () => {
    const data = order({ status: 'Canceled', isCanceled: true, amount: 60, remainingAmount: 0 });
    delete data.amountExecuted;
    mock.onGet(detailUrl).reply(200, data);
    expect(await trader.getOrderDetails(id)).toEqual({
      orderId: id,
      pairPlain: 'ADM_USDT',
      pairReadable: 'ADM/USDT',
      status: 'unknown',
    });
    expect(await trader.cancelOrder(id)).toBe(false);
    expect(mock.history.delete).toHaveLength(0);
  });
  test('market cache preserves native mixed case and punctuation in asset codes', async () => {
    Trader.exchangeMarkets = undefined;
    mock.onGet(base + '/currencies/pairs').reply(200, [market, { ...market, code: 'elizaOS_USDT' }, { ...market, code: 'HDP-B_USDT' }, { ...market, code: 'USDT.z_BNB' }]);
    await trader.getMarkets();
    expect(trader.marketInfo('ELIZAOS/USDT').pairPlain).toBe('elizaOS_USDT');
    expect(trader.marketInfo('HDP-B/USDT').pairPlain).toBe('HDP-B_USDT');
    expect(trader.marketInfo('USDT.Z/BNB').pairPlain).toBe('USDT.z_BNB');
  });
  test('zero-open candle is recovered from its first actual public trade', async () => {
    const since = Date.parse('2026-09-01T00:00:00Z');
    mock.onGet(new RegExp('/ohlc\\?')).reply(200, [{ date: '2026-09-01T00:00:00', open: 0, max: 0.022, min: 0.02, close: 0.021, volume: 100, volumeBase: 2.1 }]);
    mock.onGet(new RegExp('/deals\\?')).reply((request) => {
      const query = new URL(request.url).searchParams;
      expect(query.get('sinceDate')).toBe('2026-09-01T00:00:00.000Z');
      expect(query.get('endDate')).toBe('2026-09-01T00:00:59.999Z');
      return [200, [
        { currencyPairCode: 'ADM_USDT', price: 0.021, dealDateUtc: '2026-09-01T00:00:02Z' },
        { currencyPairCode: 'ADM_USDT', price: 0.022, dealDateUtc: '2026-09-01T00:00:01Z' },
      ]];
    });
    expect((await trader.getCandlesHistory('ADM/USDT', '1m', since, 1))[0]).toMatchObject({ open: 0.022, low: 0.02 });
  });

  test('zero-open recovery probes past an exactly full final bounded page', async () => {
    const since = Date.parse('2026-09-01T00:00:00Z');

    mock.onGet(new RegExp('/ohlc\\?')).reply(200, [{
      date: '2026-09-01T00:00:00Z',
      open: 0,
      max: 0.05,
      min: 0.01,
      close: 0.03,
      volume: 4000,
      volumeBase: 120,
    }]);
    mock.onGet(new RegExp('/deals\\?')).reply((request) => {
      const page = Number(new URL(request.url).searchParams.get('pageNumber'));

      if (page === 21) return [200, []];

      const time = new Date(since + (20 - page) * 1000).toISOString();
      return [200, Array.from({ length: 200 }, () => ({
        currencyPairCode: 'ADM_USDT',
        price: 0.02 + page / 1000,
        dealDateUtc: time,
      }))];
    });

    expect((await trader.getCandlesHistory('ADM/USDT', '1m', since, 1))[0].open).toBe(0.04);
    expect(mock.history.get.filter((request) => request.url.includes('/deals?'))).toHaveLength(21);
  });
  test('zero-open recovery failure never invents a price', async () => {
    mock.onGet(new RegExp('/ohlc\\?')).reply(200, [{ date: '2026-09-01T00:00:00', open: 0, max: 1, min: 1, close: 1, volume: 1, volumeBase: 1 }]);
    mock.onGet(new RegExp('/deals\\?')).reply(200, []);
    expect(await trader.getCandlesHistory('ADM/USDT', '1m', Date.parse('2026-09-01T00:00:00Z'), 1)).toBeUndefined();
  });
  /** @type {unknown[]} */
  const invalidTimestamps = [null, {}, '2026-09-07T10:00:00ZZ', 'not-a-date'];
  test.each(invalidTimestamps)('invalid timestamp %p throws instead of emitting NaN', (value) => {
    expect(() => utils.parseUtcTimestamp(/** @type {string} */ (value))).toThrow();
  });
});
