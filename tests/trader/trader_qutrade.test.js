// @ts-check
'use strict';

/**
 * @typedef {import('../../types/qutrade/api.d.js').QutradeOrder} QutradeOrder
 * @typedef {import('../../types/qutrade/api.d.js').QutradeMarket} QutradeMarket
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const MockAdapter = require('axios-mock-adapter');
jest.mock('../../modules/configReader', () => require('./stubConfigReader').forExchange('qutrade', 'Qutrade'));
jest.mock('../../helpers/log', () => require('./stubConfigReader').silentLog);
jest.mock('../../modules/DB', () => ({ ordersDb: { findOne: jest.fn() } }));
jest.mock('../../trade/orderUtils', () => ({}));
jest.mock('../../trade/settings/tradeParams_qutrade', () => ({}), { virtual: true });
jest.mock('../../helpers/orderSubmissionJournal', () => ({ appendSubmissionEvent: jest.fn() }));
const { silentLog } = require('./stubConfigReader');
const { appendSubmissionEvent } = require('../../helpers/orderSubmissionJournal');
const Api = require('../../trade/api/qutrade_api');
const Trader = require('../../trade/trader/trader_qutrade');
const { market, order, success } = require('./trader_qutrade.mock');
let key;
let secret;
let publicKey;
const log = { ...silentLog, warn: jest.fn(), error: jest.fn() };
const evidence = [];
afterAll(() => {
  if (process.env.QUTRADE_MOCK_EVIDENCE_PATH) {
    fs.writeFileSync(process.env.QUTRADE_MOCK_EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  }
});

let mock;
let trader;
let api;

/** @template T @param {Promise<T>} promise Scheduled operation @returns {Promise<T>} Flush shared limiter without real sleeps */
async function run(promise) {
  const settled = promise.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
  await jest.runAllTimersAsync();
  const result = await settled;
  if (result.error) throw result.error;
  return result.value;
}

/** @param {string} endpoint Endpoint @param {unknown} payload Success payload @returns {void} Register POST */
function post(endpoint, payload) {
  mock.onPost(`https://qutrade.io/api/v2/${endpoint}`).reply(200, success(payload));
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1794386000000 });
  jest.clearAllMocks();

  const keys = crypto.generateKeyPairSync('ed25519');
  publicKey = keys.publicKey;
  key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  secret = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');

  mock = new MockAdapter(Api.axios, { onNoMatch: 'throwException' });
  mock.onGet(/\/spot_markets/).reply(200, success({ CHESS_USDT: market }));
  post('open_orders', [order()]);
  Trader.exchangeMarkets = undefined;
  Trader.exchangeCurrencies = undefined;
  trader = Trader(key, secret, '', log, false, false);
  api = Api();
  api.setConfig('https://qutrade.io/api/v2', key, secret, '', log);
});
afterEach(() => {
  mock.restore();
  jest.useRealTimers();
});

describe('Qutrade REST transport', () => {
  test('signs exact sorted encoded form bytes including spaces and comma-separated IDs', async () => {
    post('create_order', order());
    await run(api.createOrder('CHESS_USDT', 'buy', 'limit', '2', undefined, '0.06', 'grid + one'));
    const request = mock.history.post[0];
    expect(request.data).toContain('label=grid+%2B+one');
    expect(
      crypto.verify(
        null,
        Buffer.from('/create_order' + request.data),
        publicKey,
        Buffer.from(String(request.headers['API-SIGN']), 'hex'),
      ),
    ).toBe(true);
    post('cancel_orders', []);
    await run(api.cancelOrders(['1', '2']));
    expect(mock.history.post[1].data).toContain('order_id=1%2C2');
  });
  test('coalesces identical public reads across instances and sends no credentials', async () => {
    const second = Api();
    await run(Promise.all([api.markets(), second.markets()]));
    expect(mock.history.get).toHaveLength(1);
    expect(mock.history.get[0].headers['API-KEY']).toBeUndefined();
  });
  test('shares monotonically increasing tonces and completion-based endpoint pacing', async () => {
    const times = [];
    mock.onPost(/\/balances/).reply(() => {
      times.push(Date.now());
      return [200, success({})];
    });
    const second = Api();
    second.setConfig('https://qutrade.io/api/v2', key, secret, '', log);
    await run(Promise.all([api.balances(), second.balances()]));
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1100);
    const tonces = mock.history.post.map((r) => Number(new URLSearchParams(r.data).get('tonce')));
    expect(tonces[1]).toBeGreaterThan(tonces[0]);
  });
  test('does not block other endpoints while a second open-order request waits', async () => {
    const started = {};
    mock.onPost('https://qutrade.io/api/v2/open_orders').reply(() => {
      (started.open ||= []).push(Date.now());
      return [200, success([])];
    });
    mock.onGet(/\/depth/).reply(() => {
      started.depth = Date.now();
      return [200, success({})];
    });
    mock.onPost(/\/create_order/).reply(() => {
      started.create = Date.now();
      return [200, success(order())];
    });

    await run(Promise.all([
      api.openOrders('CHESS_USDT'), api.openOrders('CHESS_USDT'), api.orderBook('CHESS_USDT'),
      api.createOrder('CHESS_USDT', 'buy', 'limit', '2', undefined, '0.06', 'test'),
    ]));

    expect(started.open[1] - started.open[0]).toBeGreaterThanOrEqual(1100);
    expect(started.depth).toBeLessThan(started.open[1]);
    expect(started.create).toBeLessThan(started.open[1]);
    const tonces = mock.history.post.map(({ data }) => Number(new URLSearchParams(data).get('tonce')));
    expect(tonces).toEqual([...new Set(tonces)].sort((a, b) => a - b));
  });

  test.each([401, 403, 408, 429, 500, 503])(
    'rejects HTTP %i even with contradictory success/not-found body',
    async (status) => {
      mock
        .onPost(/\/cancel_orders/)
        .reply(status, { result: 'success', code: 400, details: 'Order not found', payload: [] });
      await expect(run(api.cancelOrders(['1']))).rejects.toHaveProperty('status', status);
    },
  );
  test('resolves definitive business refusal but never retries it', async () => {
    mock
      .onPost(/\/create_order/)
      .reply(400, { result: 'error', code: 400, message: 'Bad Request', details: 'Insufficient balance' });
    expect(await run(api.createOrder('CHESS_USDT', 'buy', 'limit', '2', undefined, '0.06', 'test'))).toHaveProperty(
      'result',
      'error',
    );
    expect(mock.history.post).toHaveLength(1);
  });
  test('honors Retry-After without retrying the original mutation', async () => {
    const times = [];
    mock.onPost(/\/cancel_orders/).reply(() => {
      times.push(Date.now());
      return [429, 'CDN throttle', { 'retry-after': '5' }];
    });
    await expect(run(api.cancelOrders(['1']))).rejects.toHaveProperty('uncertain', false);
    mock.onPost(/\/balances/).reply(() => {
      times.push(Date.now());
      return [200, success({})];
    });
    await run(api.balances());
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(5000);
    expect(mock.history.post).toHaveLength(2);
  });
  test('does not leak Axios configuration on timeout or resend a placement', async () => {
    mock.onPost(/\/create_order/).timeout();
    await expect(
      run(api.createOrder('CHESS_USDT', 'buy', 'limit', '2', undefined, '0.06', 'test')),
    ).rejects.toMatchObject({ uncertain: true });
    expect(mock.history.post).toHaveLength(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(key);
  });
  test('preserves huge order IDs before JSON number rounding', async () => {
    mock
      .onPost('https://qutrade.io/api/v2/open_orders')
      .reply(200, '{"result":"success","payload":[{"order_id":9007199254740993123}]}');
    const result = await run(api.openOrders('CHESS_USDT'));
    expect(String(result.payload[0].order_id)).toBe('9007199254740993123');
  });
  test('rejects invalid key material without HTTP', async () => {
    api.setConfig(undefined, key, 'invalid', '', log);
    await expect(run(api.balances())).rejects.toThrow('secret');
    expect(mock.history.post).toHaveLength(0);
  });
});

describe('Qutrade normalized reads', () => {
  test('uses native market keys, real steps, shared initialization and compact pair lookup', async () => {
    const second = Trader(key, secret, '', log, false, false);
    await run(Promise.all([trader.getMarkets(), second.getMarkets()]));
    expect(mock.history.get).toHaveLength(1);
    expect(trader.marketInfo('CHESSUSDT')).toMatchObject({
      pairPlain: 'CHESS_USDT',
      coin1Precision: 0.001,
      coin2Precision: 0.00001,
    });
  });
  test('keeps base trading metadata when a BTC market reports no quote step', async () => {
    mock.onGet(/\/spot_markets/).reply(200, success({
      CHESS_USDT: market,
      DOGE_BTC: { ...market, quote_step_amount: '0', quote_decimal_amount: 13 },
    }));
    const all = await run(trader.getMarkets());
    expect(all.DOGE_BTC).toMatchObject({ coin1Precision: 0.001, quoteAmountDecimals: 13 });
    expect(all.DOGE_BTC.quoteAmountPrecision).toBeUndefined();
    const rejected = await run(trader.placeOrder('buy', 'DOGE/BTC', undefined, undefined, 0, 1));
    expect(rejected.message).toContain('no usable quote amount step');
    expect(mock.history.post).toHaveLength(0);
  });

  test('does not freeze the ticker at market-cache initialization', async () => {
    await run(trader.getMarkets());
    mock.onGet(/\/spot_markets/).reply(200, success({ CHESS_USDT: { ...market, last: '0.07' } }));
    expect(await run(trader.getRates('CHESS/USDT'))).toHaveProperty('last', 0.07);
  });
  test('normalizes live balance shape and includes all unavailable funds', async () => {
    post('balances', { CHESS: { total: '10', available: '6' }, ZERO: { total: '0', available: '0' } });
    expect(await run(trader.getBalances())).toEqual([{ code: 'CHESS', total: 10, free: 6, freezed: 4 }]);
    expect(await run(trader.getBalances(false))).toHaveLength(2);
    expect(await trader.getBalances(true, 'funding')).toBeUndefined();
  });
  test.each([null, [], { CHESS: { total: '2', available: '3' } }, { CHESS: { total: '2', available: null } }])(
    'rejects invalid balances %j',
    async (data) => {
      post('balances', data);
      expect(await run(trader.getBalances())).toBeUndefined();
    },
  );
  test('normalizes currency networks and leaves undocumented precision absent', async () => {
    mock
      .onGet(/\/cryptocurrencies/)
      .reply(
        200,
        success({
          USDT: {
            name: 'Tether',
            status: 'active',
            deposits_can: true,
            withdrawals_can: true,
            chains: [
              {
                chain: 'ETH',
                deposit_can: true,
                withdraw_can: true,
                deposit_min: '1',
                withdraw_min: '10',
                withdraw_fee: '3',
                deposit_confirmations: 12,
              },
            ],
          },
        }),
      );
    const c = await run(trader.getCurrencies('USDT'));
    expect(c.networks.ERC20).toMatchObject({ minDeposit: 1, minWithdrawal: 10, withdrawalFee: 3 });
    expect(c.precision).toBeUndefined();
  });
  test('normalizes existing deposit addresses and includes the destination memo', async () => {
    post('deposit_addresses', {
      USDT: [
        { chain: 'TRX', address: 'test-tron-address', memo: '42' },
        { chain: 'ETH', address: 'test-eth-address' },
      ],
    });
    expect(await run(trader.getDepositAddress('usdt'))).toEqual([
      { network: 'TRC20', address: 'test-tron-address', memo: '42' },
      { network: 'ERC20', address: 'test-eth-address', memo: undefined },
    ]);
    expect(mock.history.post[0].data).toContain('currency=USDT');
  });
  test('distinguishes empty generated addresses, malformed results and wrong currencies', async () => {
    post('deposit_addresses', {});
    expect(await run(trader.getDepositAddress('USDT'))).toEqual([]);
    post('deposit_addresses', { BTC: [] });
    expect(await run(trader.getDepositAddress('USDT'))).toBeUndefined();
    post('deposit_addresses', { USDT: [{ chain: 'TRX', address: null }] });
    expect(await run(trader.getDepositAddress('USDT'))).toBeUndefined();
  });
  test('sorts public trades and validates IDs and amounts', async () => {
    mock.onGet(/\/trading_history/).reply(
      200,
      success([
        { id: 2, price: '0.06', base_amount: '2', quote_amount: '0.12', side: 'buy', timestamp: 1794385427 },
        { id: 1, price: '0.06', base_amount: '2', quote_amount: '0.12', side: 'sell', timestamp: 1794385426 },
      ]),
    );
    expect((await run(trader.getTradesHistory('CHESS/USDT'))).map((t) => t.tradeId)).toEqual(['1', '2']);
  });
  test('sorts order book and rejects invalid levels', async () => {
    mock.onGet(/\/depth/).reply(
      200,
      success({
        CHESS_USDT: {
          bids: [
            ['0.05', '2'],
            ['0.06', '3'],
          ],
          asks: [
            ['0.08', '3'],
            ['0.07', '2'],
          ],
        },
      }),
    );
    const book = await run(trader.getOrderBook('CHESS/USDT'));
    expect(book.bids[0].price).toBe(0.06);
    expect(book.asks[0].price).toBe(0.07);
    mock.onGet(/\/depth/).reply(200, success({ CHESS_USDT: { bids: [[null, '2']], asks: [] } }));
    expect(await run(trader.getOrderBook('CHESS/USDT'))).toBeUndefined();
  });
  test('uses candle server-side seconds and calendar-month boundaries', async () => {
    const since = Date.UTC(2026, 9, 1);
    mock
      .onGet(/\/candles_history/)
      .reply(
        200,
        success([
          {
            open: '0.06',
            high: '0.07',
            low: '0.05',
            close: '0.065',
            base_volume: '2',
            quote_volume: '0.12',
            timestamp: since / 1000,
          },
        ]),
      );
    const candles = await run(trader.getCandlesHistory('CHESS/USDT', '1M', since, 5, false));
    expect(candles[0]).toMatchObject({ tsOpen: since, tsClose: Date.UTC(2026, 10, 1), source: 'native' });
    expect(mock.history.get.at(-1).url).toContain(`min_timestamp=${since / 1000}`);
    expect(await trader.getCandlesHistory('CHESS/USDT', '1m')).toBeUndefined();
  });
  test('advertises unsupported account/fee/volume routes honestly', async () => {
    expect(await trader.getAccounts()).toBeUndefined();
    expect(await trader.getVolume()).toBeUndefined();
    expect(await trader.getFees()).toBeUndefined();
    expect(trader.features()).toMatchObject({
      getAccounts: false,
      getTradingFees: false,
      getAccountTradeVolume: false,
      socketSupport: false,
    });
  });
});

describe('Qutrade order consistency', () => {
  test('returns only an explicit valid empty list as []', async () => {
    post('open_orders', []);
    expect(await run(trader.getOpenOrders('CHESS/USDT'))).toEqual([]);
  });
  test.each(
    [
      null,
      {},
      [null],
      [order({ pair: 'BTC_USDT' })],
      [order({ status: 'filled' })],
      [order({ filled_base_amount: '1' })],
      [order({ requested_base_amount: null })],
      [order(), order()],
      [order({ unfilled_base_amount: '3' })],
      [order({ order_id: 9007199254740992 })],
    ].map((data) => ({ data })),
  )('rejects incomplete/contradictory open snapshot $data', async ({ data }) => {
    post('open_orders', data);
    expect(await run(trader.getOpenOrders('CHESS/USDT'))).toBeUndefined();
  });
  test('does not amplify open orders into per-order requests', async () => {
    post('open_orders', [order(), order({ order_id: 3708001 })]);
    expect(await run(trader.getOpenOrders('CHESS/USDT'))).toHaveLength(2);
    expect(mock.history.post).toHaveLength(1);
  });
  test.each([
    ['opened', 'new', '0', '4', '0'],
    ['filling', 'part_filled', '2', '2', '0.12228'],
    ['filled', 'filled', '4', '0', '0.24456'],
    ['canceled', 'cancelled', '2', '2', '0.12228'],
  ])('maps %s to %s with correct partial amounts', async (state, status, filled, left, quote) => {
    const row = order({
      status: /** @type {QutradeOrder['status']} */ (state),
      filled_base_amount: filled,
      unfilled_base_amount: left,
      filled_quote_amount: quote,
    });
    post('open_orders', state === 'opened' || state === 'filling' ? [row] : []);
    post('order_history', [row]);
    const details = await run(trader.getOrderDetails('3708000', 'CHESS/USDT'));
    expect(details).toMatchObject({ status, amountExecuted: Number(filled), volumeExecuted: Number(quote) });
    evidence.push({ operation: 'getOrderDetails', wire: success([row]), normalized: details });
  });
  test('normalizes quote-sized filled market orders without inventing the requested base amount', async () => {
    post('open_orders', []);
    post('order_history', [
      order({
        type: 'market',
        status: 'filled',
        requested_price: null,
        average_price: '0.06',
        requested_base_amount: null,
        unfilled_base_amount: null,
        requested_quote_amount: '0.24',
        filled_base_amount: '4',
        filled_quote_amount: '0.24',
      }),
    ]);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toMatchObject({
      status: 'filled',
      amount: 4,
      amountExecuted: 4,
      price: 0.06,
    });
  });
  test('unknown requires exhausted history and validated pending snapshot', async () => {
    post('open_orders', []);
    post('order_history', []);
    post('pending_orders', []);
    const details = await run(trader.getOrderDetails('999', 'CHESS/USDT'));
    expect(details).toEqual({ orderId: '999', status: 'unknown' });
    evidence.push({
      operation: 'getOrderDetails',
      wire: { open: success([]), history: success([]), pending: success([]) },
      normalized: details,
    });
  });
  test('searches beyond the latest 1000 rows with inclusive boundary overlap', async () => {
    post('open_orders', []);
    const page = Array.from({ length: 1000 }, (_, i) =>
      order({
        order_id: 4000000 + i,
        status: 'canceled',
        timestamp_create: 1794385426 - i,
        timestamp_update: 1794385426,
      }),
    );
    mock.onPost(/\/order_history/).replyOnce(200, success(page));
    mock
      .onPost(/\/order_history/)
      .reply(200, success([page.at(-1), order({ status: 'canceled', timestamp_create: 1794384000 })]));
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    expect(mock.history.post[2].data).toContain('max_timestamp_create=1794384427');
  });
  test('reuses all validated terminal rows from a history page without caching absence', async () => {
    post('open_orders', []);
    post('order_history', [order({ status: 'canceled' }), order({ order_id: 3708001, status: 'canceled' })]);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    expect(await run(trader.getOrderDetails('3708001', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    expect(mock.history.post).toHaveLength(2);
    post('pending_orders', []);
    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    expect(mock.history.post).toHaveLength(8);
  });
  test('retains the entire 50-page scan and reuses it after the former expiry', async () => {
    post('open_orders', []);
    post('pending_orders', []);
    const newestTime = 1794385426;
    const rows = Array.from({ length: 49950 }, (_, i) => order({
      order_id: 4000000 + i,
      status: 'canceled',
      timestamp_create: newestTime - i,
      timestamp_update: newestTime,
    }));
    mock.onPost(/\/order_history/).reply(({ data }) => {
      const until = Number(new URLSearchParams(data).get('max_timestamp_create'));
      const start = Math.max(0, newestTime - until);
      return [200, success(rows.slice(start, start + 1000))];
    });

    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    const historyRequests = () => mock.history.post.filter((item) => item.url.endsWith('/order_history')).length;
    expect(historyRequests()).toBe(50);

    jest.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const other = Trader(key, secret, '', log, false, false);
    const countBeforeCacheHits = mock.history.post.length;
    for (const id of ['4000000', '4020000', '4049949']) {
      expect(await other.getOrderDetails(id, 'CHESS/USDT')).toHaveProperty('status', 'cancelled');
    }
    expect(mock.history.post).toHaveLength(countBeforeCacheHits);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await run(other.getOrderDetails('5000000', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    }
    expect(await run(other.cancelOrder('5000000', 'sell', 'CHESS/USDT'))).toBe(false);
    expect(historyRequests()).toBe(53);
    expect(mock.history.post.filter(({ url }) => url.endsWith('/pending_orders'))).toHaveLength(4);
  });

  test('checks fresh pending orders after a cached miss and does not cache unknown', async () => {
    post('open_orders', []);
    post('pending_orders', []);
    const newestTime = 1794385426;
    const rows = Array.from({ length: 1250 }, (_, i) => order({
      order_id: 4000000 + i,
      status: 'canceled',
      timestamp_create: newestTime - i,
      timestamp_update: newestTime,
    }));
    mock.onPost(/\/order_history/).reply(({ data }) => {
      const until = Number(new URLSearchParams(data).get('max_timestamp_create'));
      return [200, success(rows.filter((row) => row.timestamp_create <= until).slice(0, 1000))];
    });

    // The external order is already off the open list but its terminal row is published late.
    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    const late = order({
      order_id: 5000000,
      status: 'canceled',
      timestamp_create: rows[1100].timestamp_create,
      timestamp_update: newestTime + 1,
    });
    rows.splice(1100, 0, late);

    const other = Trader(key, secret, '', log, false, false);
    expect(await run(other.getOrderDetails('5000000', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');

    post('pending_orders', [{ order_id: late.order_id, pair: late.pair }]);
    expect(await run(other.getOrderDetails('5000000', 'CHESS/USDT'))).toBeUndefined();

    mock.onPost(/\/pending_orders/).reply(503);
    expect(await run(other.getOrderDetails('5000000', 'CHESS/USDT'))).toBeUndefined();
    expect(mock.history.post.filter(({ url }) => url.endsWith('/pending_orders'))).toHaveLength(4);
  });

  test('resumes beyond a gap larger than 50 pages instead of restarting the same scan', async () => {
    post('open_orders', []);
    post('pending_orders', []);
    const oldestTime = 1794000000;
    const rows = Array.from({ length: 62500 }, (_, i) => order({
      order_id: 4000000 + i,
      status: 'canceled',
      timestamp_create: oldestTime + i,
      timestamp_update: oldestTime + i,
    })).reverse();
    let available = rows.slice(-2500);
    mock.onPost(/\/order_history/).reply(({ data }) => {
      const until = Number(new URLSearchParams(data).get('max_timestamp_create'));
      const start = Math.max(0, available[0].timestamp_create - until);
      return [200, success(available.slice(start, start + 1000))];
    });
    const historyCount = () => mock.history.post.filter(({ url }) => url.endsWith('/order_history')).length;

    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    expect(historyCount()).toBe(3);
    available = rows;

    // The requested order is 55,000 rows below the new head.
    expect(await run(trader.getOrderDetails('4007499', 'CHESS/USDT'))).toBeUndefined();
    expect(historyCount()).toBe(53);
    expect(await run(trader.getOrderDetails('4007499', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    expect(historyCount() - 53).toBeLessThan(10);

    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    const completedScanCount = historyCount();
    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    expect(historyCount()).toBe(completedScanCount + 1);
  });

  test('keeps the timestamps of other open orders for targeted lookup after they close', async () => {
    const active = order({ order_id: 5000000, timestamp_create: 1794384000 });
    post('open_orders', [order(), active]);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'new');

    post('open_orders', []);
    post('order_history', [{ ...active, status: 'canceled' }]);
    expect(await run(trader.getOrderDetails('5000000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    const history = mock.history.post.filter((item) => item.url.endsWith('/order_history'));
    expect(history).toHaveLength(1);
    const bounds = new URLSearchParams(history[0].data);
    expect(bounds.get('min_timestamp_create')).toBe('1794384000');
    expect(bounds.get('max_timestamp_create')).toBe('1794384000');
  });

  test('resumes incomplete history without fetching the previously scanned middle page', async () => {
    post('open_orders', []);
    const rows = Array.from({ length: 2000 }, (_, i) => order({
      order_id: 4000000 + i,
      status: 'canceled',
      timestamp_create: 1794385426 - i,
      timestamp_update: 1794385426,
    }));
    const first = rows.slice(0, 1000);
    const second = rows.slice(999, 1999);
    const third = rows.slice(1998);
    mock.onPost(/\/order_history/).reply(({ data }) => {
      const until = Number(new URLSearchParams(data).get('max_timestamp_create'));
      if (until === 9999999999) return [200, success(first)];
      if (until === first.at(-1).timestamp_create) return [200, success(second)];
      expect(until).toBe(second.at(-1).timestamp_create);
      return [200, success(third)];
    });

    expect(await run(trader.getOrderDetails('4001000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    expect(await run(trader.getOrderDetails('4001999', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    const history = mock.history.post.filter((item) => item.url.endsWith('/order_history'));
    expect(history.map(({ data }) => Number(new URLSearchParams(data).get('max_timestamp_create')))).toEqual([
      9999999999, first.at(-1).timestamp_create, 9999999999, second.at(-1).timestamp_create,
    ]);
  });

  test('does not jump past an unscanned range when the new head no longer overlaps', async () => {
    post('open_orders', []);
    post('pending_orders', []);
    const head = Array.from({ length: 1000 }, (_, i) => order({
      order_id: 4000000 + i,
      status: 'canceled',
      timestamp_create: 1794385426 - i,
      timestamp_update: 1794385426,
    }));
    const newer = head.map((row) => ({
      ...row,
      order_id: Number(row.order_id) + 1000,
      timestamp_create: row.timestamp_create + 2000,
      timestamp_update: row.timestamp_update + 2000,
    }));
    const gapOrder = order({ order_id: 6000000, status: 'canceled', timestamp_create: 1794386000,
      timestamp_update: 1794386000 });
    let currentHead = head;
    let olderRows = [head.at(-1)];
    mock.onPost(/\/order_history/).reply(({ data }) => {
      const until = new URLSearchParams(data).get('max_timestamp_create');
      return [200, success(until === '9999999999' ? currentHead : olderRows)];
    });

    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    currentHead = newer;
    olderRows = [newer.at(-1), gapOrder, head[0]];
    expect(await run(trader.getOrderDetails('6000000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
  });

  test('invalidates a cached terminal result contradicted by a new validated open snapshot', async () => {
    post('cancel_orders', [order({ status: 'canceled' })]);
    expect(await run(trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBe(true);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');

    expect(await run(trader.getOpenOrders('CHESS/USDT'))).toHaveLength(1);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'new');
  });

  test('narrows a known open order search to its exchange creation second', async () => {
    expect(await run(trader.getOpenOrders('CHESS/USDT'))).toHaveLength(1);
    post('open_orders', []);
    post('order_history', [order({ status: 'canceled' })]);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    expect(mock.history.post.at(-1).data).toContain('min_timestamp_create=1794385426');
    expect(mock.history.post.at(-1).data).toContain('max_timestamp_create=1794385426');
  });
  test('does not share terminal evidence between credentials or pairs', async () => {
    post('open_orders', []);
    post('order_history', [order({ status: 'canceled' })]);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'cancelled');
    const otherKey = crypto.generateKeyPairSync('ed25519');
    const other = Trader(
      otherKey.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
      otherKey.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex'),
      '', log, false, false,
    );
    post('order_history', []);
    post('pending_orders', []);
    expect(await run(other.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'unknown');
    expect(await run(trader.getOrderDetails('3708000', 'BTC/USDT'))).toHaveProperty('status', 'unknown');
  });
  test('never claims unknown when history saturates a timestamp window', async () => {
    post('open_orders', []);
    post(
      'order_history',
      Array.from({ length: 1000 }, (_, i) => order({ order_id: 4000000 + i, status: 'canceled' })),
    );
    expect(await run(trader.getOrderDetails('999', 'CHESS/USDT'))).toBeUndefined();
    expect(mock.history.post).toHaveLength(3);
  });
  test.each(
    [null, [order({ pair: 'BTC_USDT' })], [order({ status: /** @type {any} */ ('surprise') })]].map((payload) => ({
      payload,
    })),
  )('does not convert malformed history into unknown $payload', async ({ payload }) => {
    post('open_orders', []);
    post('order_history', payload);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toBeUndefined();
  });
  test.each([
    ['canceled', true],
    ['already_canceled', false],
  ])('cancellation %s returns %s', async (state, expected) => {
    post('cancel_orders', [order({ status: /** @type {QutradeOrder['status']} */ (state) })]);
    expect(await run(trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBe(expected);
  });
  test.each(
    [null, [], [order({ order_id: 1, status: 'canceled' })], [order({ status: 'opened' })]].map((data) => ({ data })),
  )('unverified cancellation $data remains undefined', async ({ data }) => {
    post('cancel_orders', data);
    expect(await run(trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBeUndefined();
  });
  test('actual order collector preserves DB flags through access failure and closes after recovery', async () => {
    const collector = require('../../trade/orderCollector');
    post('open_orders', [order()]);
    mock.onPost(/\/cancel_orders/).replyOnce(403, { result: 'error', code: 400, details: 'Order not found' });
    const local = {
      _id: '3708000',
      pair: 'CHESS/USDT',
      side: 'sell',
      purpose: 'man',
      isProcessed: false,
      isClosed: false,
      isCancelled: false,
      update: jest.fn((changes) => Object.assign(local, changes)),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const rejected = await run(
      collector.clearOrderById(local, 'CHESS/USDT', 'sell', 'Qutrade auth test', undefined, undefined, trader),
    );
    expect(rejected).toMatchObject({ isCancelRequestProcessed: false, isOrderCancelled: undefined });
    expect(local).toMatchObject({ isProcessed: false, isClosed: false, isCancelled: false });
    expect(local.update).not.toHaveBeenCalled();
    post('cancel_orders', [order({ status: 'canceled' })]);
    const cancelled = await run(
      collector.clearOrderById(local, 'CHESS/USDT', 'sell', 'Qutrade recovery', undefined, undefined, trader),
    );
    expect(cancelled).toMatchObject({ isCancelRequestProcessed: true, isOrderCancelled: true });
    expect(local).toMatchObject({ isProcessed: true, isClosed: true, isCancelled: true });
  });
  test('decodes the exact live legacy+v2 cancellation body and rejects mismatched legacy IDs', async () => {
    const tail = JSON.stringify(success([order({ status: 'canceled' })]));
    mock
      .onPost(/\/cancel_orders/)
      .replyOnce(200, JSON.stringify({ list_canceled_order_id: ['3708000'], result: 'success' }) + tail);
    expect(await run(trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBe(true);
    // A later open snapshot invalidates the cached cancellation.
    await run(trader.getOpenOrders('CHESS/USDT'));
    mock.onPost(/\/cancel_orders/).reply(200, JSON.stringify({ list_canceled_order_id: ['123'], result: 'success' }) + tail);
    expect(await run(trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBeUndefined();
  });
  test('access loss on cancel cannot return false and close a tracked order', async () => {
    post('open_orders', [order()]);
    expect(await run(trader.getOrderDetails('3708000', 'CHESS/USDT'))).toHaveProperty('status', 'new');
    mock.onPost(/\/cancel_orders/).reply(401, { result: 'error', code: 400, details: 'Order not found' });
    expect(await run(trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBeUndefined();
  });
  test('simultaneous cancels of one ID send one mutation and report an already closed second call', async () => {
    const other = Trader(key, secret, '', log, false, false);
    post('cancel_orders', [order({ status: 'canceled' })]);
    const results = await run(Promise.all([
      trader.cancelOrder('3708000', 'sell', 'CHESS/USDT'),
      other.cancelOrder('3708000', 'sell', 'CHESS/USDT'),
    ]));
    expect(results).toEqual([true, false]);
    expect(mock.history.post.filter((item) => item.url.endsWith('/cancel_orders'))).toHaveLength(1);
  });

  test('bulk cancel uses pair/side filters and verifies no remaining scoped orders', async () => {
    post('cancel_all_orders', [order({ status: 'canceled' })]);
    post('open_orders', []);
    expect(await run(trader.cancelAllOrders('CHESS/USDT', 'sell'))).toBe(true);
    expect(mock.history.post[0].data).toContain('pair=CHESS_USDT');
    expect(mock.history.post[0].data).toContain('side=sell');
    post('open_orders', [order()]);
    expect(await run(trader.cancelAllOrders('CHESS/USDT'))).toBeUndefined();
  });
});

describe('Qutrade placement safety and recovery', () => {
  /** @returns {void} Echo normalized submitted intent as a valid acknowledgement */
  function placementMock(refuseOnCall = 0) {
    let calls = 0;
    mock.onPost(/\/create_order/).reply((request) => {
      if (++calls === refuseOnCall) return [400, { result: 'error', code: 400, details: 'Price outside band' }];

      const p = new URLSearchParams(request.data);
      return [
        200,
        success(
          order({
            label: p.get('label'),
            side: /** @type {any} */ (p.get('side')),
            requested_price: p.get('requested_price'),
            requested_base_amount: p.get('requested_base_amount'),
            unfilled_base_amount: p.get('requested_base_amount'),
            requested_quote_amount: String(Number(p.get('requested_base_amount')) * Number(p.get('requested_price'))),
          }),
        ),
      ];
    });
  }
  test.each([
    ['buy', 0.061149, 0.06114],
    ['sell', 0.061141, 0.06115],
  ])('rounds %s price in the safe direction', async (side, price, expected) => {
    placementMock();
    const result = await run(trader.placeOrder(/** @type {any} */ (side), 'CHESS/USDT', price, 2.1239, 1));
    expect(result.orderId).toBe('3708000');
    const p = new URLSearchParams(mock.history.post[0].data);
    expect(+p.get('requested_price')).toBe(expected);
    expect(p.get('requested_base_amount')).toBe('2.123');
    expect(appendSubmissionEvent).toHaveBeenCalledWith(
      'qutrade',
      expect.any(String),
      expect.objectContaining({ state: 'pending' }),
      undefined,
      { rotation: { maxBytes: 4 * 1024 * 1024, archives: 4 } },
    );
  });
  test.each([
    ['buy', 'CHESS/USDT', NaN, 2, 1],
    ['sell', 'CHESS/USDT', 0.06, Infinity, 1],
    ['BUY', 'CHESS/USDT', 0.06, 2, 1],
    ['buy', 'CHESS/USDT', 0.06, -1, 1],
    ['buy', 'CHESS/USDT', 0.06, 2, 2],
    ['buy', 'CHESS_USDT,BTC_USDT', 0.06, 2, 1],
    ['buy', 'CHESS/USDT', 0.06, 2, 0],
    ['buy', 'CHESS/USDT', undefined, 2, 0, 0.12],
    ['sell', 'CHESS/USDT', 0.06, 1, 1],
  ])('rejects unsafe placement %j without mutation', async (...args) => {
    expect((await run(trader.placeOrder(...args))).orderId).toBeUndefined();
    expect(mock.history.post).toHaveLength(0);
  });
  test('reuses placement metadata and invalidates it after a price refusal', async () => {
    placementMock(3);
    await run(trader.placeOrder('buy', 'CHESS/USDT', 0.06, 2, 1));
    await run(trader.placeOrder('sell', 'CHESS/USDT', 0.06, 2, 1));
    expect(mock.history.get).toHaveLength(1);

    const refused = await run(trader.placeOrder('buy', 'CHESS/USDT', 0.06, 2, 1));
    expect(refused.message).toMatch(/buy limit order on CHESS\/USDT.*2 CHESS at 0.06, label adm.*Price outside band/);
    expect(log.warn).toHaveBeenCalledWith(refused.message);
    expect(mock.history.get).toHaveLength(1);

    await run(trader.placeOrder('buy', 'CHESS/USDT', 0.06, 2, 1));
    expect(mock.history.get).toHaveLength(2);
    expect(mock.history.post.filter(({ url }) => url.endsWith('/create_order'))).toHaveLength(4);
  });

  test('returns and journals a valid ID when the acknowledgement differs only in amount', async () => {
    post('create_order', order({ requested_price: '0.06', requested_base_amount: '3' }));
    const placed = await run(trader.placeOrder('sell', 'CHESS/USDT', 0.06, 2, 1));

    expect(placed.orderId).toBe('3708000');
    expect(placed.message).toContain('mismatched base amount');
    expect(appendSubmissionEvent).toHaveBeenCalledWith('qutrade', expect.any(String),
      expect.objectContaining({ state: 'uncertain', orderId: '3708000' }), undefined, { stream: 'uncertain' });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('3708000'));
    expect(mock.history.post).toHaveLength(1);
  });

  test('journals a mismatched pair ID without booking it against the requested market', async () => {
    post('create_order', order({ pair: 'BTC_USDT', requested_price: '0.06', requested_base_amount: '2' }));
    post('open_orders', []);
    post('order_history', []);
    const placed = await run(trader.placeOrder('sell', 'CHESS/USDT', 0.06, 2, 1));

    expect(placed).toMatchObject({ isSubmissionUncertain: true });
    expect(placed.orderId).toBeUndefined();
    expect(placed.message).toContain('reported ID 3708000');
    expect(appendSubmissionEvent).toHaveBeenCalledWith('qutrade', expect.any(String),
      expect.objectContaining({ state: 'uncertain', orderId: '3708000' }), undefined, { stream: 'uncertain' });
  });

  test('does not exceed a limit quote budget after sell-price rounding', async () => {
    placementMock();
    await run(trader.placeOrder('sell', 'CHESS/USDT', 0.061141, undefined, 1, 0.2));
    const p = new URLSearchParams(mock.history.post[0].data);
    expect(+p.get('requested_base_amount') * +p.get('requested_price')).toBeLessThanOrEqual(0.2);
  });
  test('recovers a lost acknowledgement by its unique label without a second submission', async () => {
    let label;
    mock.onPost(/\/create_order/).reply((request) => {
      label = new URLSearchParams(request.data).get('label');
      return [503, 'bad gateway'];
    });
    mock
      .onPost('https://qutrade.io/api/v2/open_orders')
      .reply(() => [
        200,
        success([
          order({ label, side: 'buy', requested_price: '0.06', requested_base_amount: '2', unfilled_base_amount: '2' }),
        ]),
      ]);
    const result = await run(trader.placeOrder('buy', 'CHESS/USDT', 0.06, 2, 1));
    expect(result.orderId).toBe('3708000');
    expect(mock.history.post.filter((r) => r.url.endsWith('/create_order'))).toHaveLength(1);
  });
  test('retains the sell ID when create_order omits the label and falsely reports filled', async () => {
    post(
      'create_order',
      order({
        label: '',
        status: 'filled',
        requested_price: '0.06',
        requested_base_amount: '2',
        unfilled_base_amount: '2',
      }),
    );
    const placed = await run(trader.placeOrder('sell', 'CHESS/USDT', 0.06, 2, 1));
    expect(placed.orderId).toBe('3708000');
    expect(mock.history.post).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('verify via order reads'));
  });
  test('reports ambiguous HTTP 500 through the standard uncertainty flag and does not resubmit', async () => {
    mock.onPost(/\/create_order/).reply(500, { result: 'error', code: 500, message: 'Internal Server Error' });
    post('open_orders', []);
    post('order_history', []);
    const placed = await run(trader.placeOrder('sell', 'CHESS/USDT', 0.06, 2, 1));
    expect(placed).toMatchObject({
      isSubmissionUncertain: true,
      clientOrderId: expect.stringMatching(/^adm[a-f0-9]{22}$/),
    });
    expect(placed.orderId).toBeUndefined();
    expect(mock.history.post.filter((r) => r.url.endsWith('/create_order'))).toHaveLength(1);
  });
  test('does not reconcile an HTTP 429 placement refusal even if the body claims a server error', async () => {
    mock.onPost(/\/create_order/).reply(429, { result: 'error', code: 500, message: 'Internal Server Error' });
    const placed = await run(trader.placeOrder('buy', 'CHESS/USDT', 0.06, 2, 1));
    expect(placed.orderId).toBeUndefined();
    expect(placed.isSubmissionUncertain).toBeUndefined();
    expect(mock.history.post).toHaveLength(1);
  });

  test('rejects incompatible explicit buy amount and budget before sending an order', async () => {
    const placed = await run(trader.placeOrder('buy', 'CHESS/USDT', 0.06, 8, 1, 0.12));
    expect(placed.message).toContain('exceeds the supplied budget');
    expect(mock.history.post).toHaveLength(0);
  });

  test('does not turn an acknowledged order into unknown when reads lag', async () => {
    const other = Trader(key, secret, '', log, false, false);
    placementMock();
    await run(trader.placeOrder('sell', 'CHESS/USDT', 0.06, 2, 1));
    post('open_orders', []);
    post('order_history', []);
    expect(await run(other.getOrderDetails('3708000', 'CHESS/USDT'))).toBeUndefined();
    expect(await run(other.cancelOrder('3708000', 'sell', 'CHESS/USDT'))).toBeUndefined();
    expect(mock.history.post.some(({ url }) => url.endsWith('/pending_orders') || url.endsWith('/cancel_orders')))
      .toBe(false);
  });
});
