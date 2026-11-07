'use strict';

/* global jest, describe, test, expect, beforeAll, afterAll */

const fs = require('fs');
const path = require('path');
const { createSigner } = require('fast-jwt');
const { signHs256 } = require('../../helpers/jwt');

const { getBotCapabilities, listInstalledMmModules } = require('../../api/lib/capabilities');
const { resolvePair } = require('../../api/services/market');
const { BadRequestError } = require('../../api/lib/errors');

jest.mock('../../modules/commandTxs', () => ({
  commands: {
    saveConfig: jest.fn(),
    amount: jest.fn(),
    interval: jest.fn(),
    buypercent: jest.fn(),
    enable: jest.fn(async () => ({ isError: false })),
    start: jest.fn(() => ({ msgSendBack: 'started' })),
    stop: jest.fn(() => ({ msgSendBack: 'stopped' })),
  },
}));

jest.mock('../../api/services/params', () => {
  const getCurrentParams = () => ({
    mm: { isActive: false, strategy: 'optimal' },
  });
  return {
    getCurrentParams,
    getParamsUpdatePayload: () => ({
      params: getCurrentParams(),
      revision: 0,
      origin: 'bot',
      requestId: null,
    }),
    bumpParamsRevision: (origin = 'bot', requestId = null) => ({
      params: getCurrentParams(),
      revision: 1,
      origin,
      requestId,
    }),
    setParams: jest.fn(async () => ({
      params: getCurrentParams(),
      revision: 1,
      origin: 'webui',
      requestId: null,
    })),
    setStrategy: jest.fn(() => ({
      params: getCurrentParams(),
      revision: 1,
      origin: 'webui',
      requestId: null,
    })),
  };
});

jest.mock('../../api/services/commands', () => {
  const handlers = [
    'runClear', 'runPlaceOrder', 'runFill', 'runMake', 'runStopMakingPrice', 'runBalances', 'runStats',
    'runOrders', 'runRates', 'runPair', 'runCalc', 'runDeposit', 'runShow', 'runInfo', 'runTransfer',
    'runWithdraw', 'runCancel', 'runOrder', 'runConvert', 'runAccount', 'runVolume', 'runEnable',
    'runDisable', 'runTwap',
  ];
  const service = {
    runStart: jest.fn(async () => ({ message: 'started' })),
    runStop: jest.fn(async () => ({ message: 'stopped' })),
  };

  for (const name of handlers) {
    service[name] = jest.fn(async () => ({ message: name }));
  }

  return service;
});

jest.mock('../../api/services/messages', () => ({
  listMessages: jest.fn(async () => ([])),
  createMessage: jest.fn(async (login, payload) => ({ user: login, ...payload, createdAt: Date.now() })),
  appendNotifyMessage: jest.fn(async () => undefined),
}));

jest.mock('../../api/services/logs', () => ({
  buildLogsGzip: jest.fn(() => ({
    buffer: Buffer.from('gzip'),
    filename: 'bot-logs-test.txt.gz',
    lineCount: 1,
  })),
  DEFAULT_TAIL: 1000,
  MAX_TAIL: 20000,
}));

jest.mock('../../modules/eventEmitter', () => ({
  emitter: { on: jest.fn() },
  events: { 'parameters:update': 'parameters:update' },
}));

jest.mock('../../trade/settings/tradeParams_binance', () => ({
  mm_isActive: false,
  mm_isTraderActive: false,
  mm_isOrderBookActive: false,
  mm_isLiquidityActive: false,
  mm_isPriceWatcherActive: false,
  mm_emergencyStopTs: 0,
  mm_emergencyStopSource: '',
  mm_emergencyStopReason: '',
  mm_intervalUnitUI: 'sec',
}), { virtual: true });

jest.mock('../../modules/configReader', () => ({
  private_webui_secret_key: 'test-secret',
  private_webui: 0,
  private_webui_bind_host: '127.0.0.1',
  private_webui_allowed_ips: [],
  public_webui: '',
  public_webui_license_token: '',
  fileWithPath: '/tmp/adamant-tradebot-test-config.jsonc',
  pair: 'ETH/USDT',
  coin1: 'ETH',
  coin2: 'USDT',
  exchange: 'binance',
  exchangeName: 'Binance',
  version: '23.0.0-test',
  projectBranch: 'test',
  perpetual: false,
  apikey2: false,
  nice_chart: { enabled: true },
  api: {
    port: 0,
    health: false,
    debug: true,
    debug_token: 'debug-token-must-not-leak-0123456789',
  },
  db: {
    name: 'test',
    url: 'mongodb://127.0.0.1:27017/test',
    options: {},
  },
}));

jest.mock('../../modules/DB', () => ({
  ready: Promise.resolve({}),
  ordersDb: {
    find: jest.fn(async () => []),
  },
}));

jest.mock('../../trade/orderCollector', () => ({
  orderPurposes: {
    ob: 'Order book',
    t: 'Trader',
  },
}));

jest.mock('../../api/traderConnector', () => ({
  getTraderConnector: () => ({
    features: () => ({
      getRates: true,
      getOrderBook: true,
      getTradesHistory: true,
      getCandlesHistory: true,
    }),
    getRates: async () => ({
      ask: 100,
      bid: 99,
      last: 99.5,
      high: 101,
      low: 98,
      volume: 10,
      volumeInCoin2: 1000,
    }),
    getOrderBook: async () => ({
      asks: [{ price: 100, amount: 1, count: 1, side: 'sell' }],
      bids: [{ price: 99, amount: 2, count: 1, side: 'buy' }],
    }),
    getTradesHistory: async () => ([{
      coin1Amount: 1,
      price: 100,
      coin2Amount: 100,
      date: 1700000000000,
      side: 'buy',
      tradeId: '1',
    }]),
    getCandlesHistory: async () => ([{
      tsOpen: 1700000000000,
      tsClose: 1700000060000,
      date: '2023-11-14T22:13:20.000Z',
      open: 99,
      high: 101,
      low: 98,
      close: 100,
      baseVolume: 12,
      quoteVolumeCalc: 1200,
      trades: 5,
      source: 'native',
    }]),
    getBalances: async () => ({ ETH: 1, USDT: 1000 }),
    getOpenOrders: async () => ([]),
  }),
}));

jest.mock('../../trade/orderUtils', () => ({
  parseMarket: () => ({
    pair: 'ETH/USDT',
    coin1: 'ETH',
    coin2: 'USDT',
    coin1Decimals: 8,
    coin2Decimals: 8,
  }),
  getRatesCached: jest.fn(async () => ({
    ask: 100,
    bid: 99,
    last: 99.5,
    high: 101,
    low: 98,
    volume: 10,
    volumeInCoin2: 1000,
  })),
  getOrderBookCached: jest.fn(async () => ({
    asks: [{ price: 100, amount: 1, count: 1, side: 'sell' }],
    bids: [{ price: 99, amount: 2, count: 1, side: 'buy' }],
  })),
  getBalancesCached: jest.fn(async () => ({ ETH: 1, USDT: 1000 })),
  getOpenOrdersCached: jest.fn(async () => []),
}));

/**
 * `METHOD /path` of every route a `read-only` WebUI token may call: monitoring snapshots only.
 * Adding a route here opens it to viewer tokens, so keep it a deliberate change.
 */
const READ_ONLY_ROUTES = [
  'GET /api/v1/status',
  'GET /api/v1/bot',
  'GET /api/v1/market/ticker',
  'GET /api/v1/market/orderbook',
  'GET /api/v1/market/trades',
  'GET /api/v1/market/ohlc',
  'GET /api/v1/account/balances',
  'GET /api/v1/account/orders',
  'GET /api/v1/params',
  'GET /api/v1/commands/balances',
  'GET /api/v1/commands/stats',
  'GET /api/v1/commands/orders',
  'GET /api/v1/commands/rates',
  'GET /api/v1/commands/pair',
  'GET /api/v1/commands/calc',
  'GET /api/v1/commands/info',
  'GET /api/v1/commands/order',
  'GET /api/v1/commands/account',
].sort();

describe('WebUI API v1', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  /** @type {Array<{ method: string | string[], url: string, config?: { minRole?: string } }>} */
  const registeredRoutes = [];

  beforeAll(async () => {
    const { buildApp } = require('../../api/server');
    app = buildApp();
    app.addHook('onRoute', (route) => {
      registeredRoutes.push(route);
    });
    await app.ready();
  });

  /**
   * Authenticated `/api/v1` routes as `METHOD /path`. Skips HEAD mirrors of GET routes,
   * the CORS preflight route, and the public health check.
   *
   * @returns {Array<{ key: string, method: string, url: string, minRole?: string }>}
   */
  function protectedRoutes() {
    return registeredRoutes
        .filter((route) => !['HEAD', 'OPTIONS'].includes(String(route.method)) && route.url !== '/api/v1/health')
        .map((route) => ({
          key: `${route.method} ${route.url}`,
          method: String(route.method),
          url: route.url,
          minRole: route.config?.minRole,
        }));
  }

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  test('health endpoint is public and liveness-only', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      transport: 'directHttp',
    });
  });

  test('status endpoint requires JWT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
    });

    expect(response.statusCode).toBe(401);
  });

  test('status endpoint returns MM quality', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mmActive: false,
      mmState: 'stopped',
    });
  });

  function authHeader(login = 'operator', role) {
    const payload = { login };
    if (role) {
      payload.role = role;
    }
    const token = signHs256(payload, 'test-secret', { expiresIn: '1h' });
    return { authorization: `Bearer ${token}` };
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  test('protected routes return 401 without JWT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('protected routes reject invalid JWT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: 'Bearer invalid' },
    });

    expect(response.statusCode).toBe(401);
  });

  test('protected routes reject JWT for disabled accounts', async () => {
    const token = signHs256({ login: 'operator', enabled: false }, 'test-secret', { expiresIn: '1h' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('protected routes reject JWT without exp', async () => {
    const token = signHs256({ login: 'operator' }, 'test-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('protected routes reject expired JWT', async () => {
    const token = signHs256({ login: 'operator', exp: nowSec() - 60 }, 'test-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('protected routes reject JWT that is not active yet', async () => {
    const token = signHs256({ login: 'operator', nbf: nowSec() + 600, exp: nowSec() + 1200 }, 'test-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  test('protected routes reject JWT whose exp exceeds private_webui_jwt_max_ttl', async () => {
    const token = signHs256({ login: 'operator' }, 'test-secret', { expiresIn: '7d' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('protected routes reject JWT signed with an algorithm other than HS256', async () => {
    const token = createSigner({ key: 'test-secret', algorithm: 'HS512', expiresIn: '1h' })({ login: 'operator' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('bot info returns capabilities and direct transport', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.transport).toBe('directHttp');
    expect(body.pair).toBe('ETH/USDT');
    expect(body.capabilities.modules.length).toBeGreaterThan(0);
    expect(body.capabilities.modules.some((item) => item.file === 'mm_trader')).toBe(true);
    expect(body.capabilities.features.length).toBeGreaterThan(0);
    expect(body.capabilities.features.find((item) => item.featureKey === 't')).toMatchObject({
      moduleAvailable: true,
    });
  });

  test('noCache=false keeps REST cache; noCache=true bypasses it', async () => {
    const auth = authHeader();
    const orderUtils = require('../../trade/orderUtils');

    await app.inject({
      method: 'GET',
      url: '/api/v1/market/ticker?noCache=false',
      headers: auth,
    });
    expect(orderUtils.getRatesCached).toHaveBeenLastCalledWith('ETH/USDT', 'webui-api', false);

    await app.inject({
      method: 'GET',
      url: '/api/v1/market/ticker?noCache=true',
      headers: auth,
    });
    expect(orderUtils.getRatesCached).toHaveBeenLastCalledWith('ETH/USDT', 'webui-api', true);

    await app.inject({
      method: 'GET',
      url: '/api/v1/account/balances?noCache=false',
      headers: auth,
    });
    expect(orderUtils.getBalancesCached).toHaveBeenLastCalledWith(true, 'webui-api', false);

    await app.inject({
      method: 'GET',
      url: '/api/v1/account/balances?noCache=true',
      headers: auth,
    });
    expect(orderUtils.getBalancesCached).toHaveBeenLastCalledWith(true, 'webui-api', true);
  });

  test('market endpoints return structured payloads', async () => {
    const auth = authHeader();

    const ticker = await app.inject({
      method: 'GET',
      url: '/api/v1/market/ticker',
      headers: auth,
    });
    expect(ticker.statusCode).toBe(200);
    expect(ticker.json().ticker.last).toBe(99.5);

    const orderbook = await app.inject({
      method: 'GET',
      url: '/api/v1/market/orderbook',
      headers: auth,
    });
    expect(orderbook.statusCode).toBe(200);
    expect(orderbook.json().bids).toHaveLength(1);

    const trades = await app.inject({
      method: 'GET',
      url: '/api/v1/market/trades',
      headers: auth,
    });
    expect(trades.statusCode).toBe(200);
    expect(trades.json().trades).toHaveLength(1);

    const ohlc = await app.inject({
      method: 'GET',
      url: '/api/v1/market/ohlc?timeframe=1m',
      headers: auth,
    });
    expect(ohlc.statusCode).toBe(200);
    expect(ohlc.json().candles).toHaveLength(1);

    const ohlcMissingTimeframe = await app.inject({
      method: 'GET',
      url: '/api/v1/market/ohlc',
      headers: auth,
    });
    expect(ohlcMissingTimeframe.statusCode).toBe(400);
  });

  test('account endpoints return balances and orders', async () => {
    const auth = authHeader();

    const balances = await app.inject({
      method: 'GET',
      url: '/api/v1/account/balances',
      headers: auth,
    });
    expect(balances.statusCode).toBe(200);
    expect(balances.json().balances).toEqual({ ETH: 1, USDT: 1000 });

    const orders = await app.inject({
      method: 'GET',
      url: '/api/v1/account/orders',
      headers: auth,
    });
    expect(orders.statusCode).toBe(200);
    expect(orders.json().orders).toEqual([]);
  });

  test('commands start and stop return message payloads', async () => {
    const auth = authHeader();

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/start',
      headers: auth,
      payload: { strategy: 'optimal' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ message: 'started' });

    const startEmpty = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/start',
      headers: auth,
    });
    expect(startEmpty.statusCode).toBe(200);
    expect(startEmpty.json()).toEqual({ message: 'started' });

    const stop = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/stop',
      headers: auth,
    });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ message: 'stopped' });
  });

  test('read-only JWT can read but not write', async () => {
    const readAuth = authHeader('viewer', 'read-only');

    const bot = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: readAuth,
    });
    expect(bot.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/stop',
      headers: readAuth,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('Read-only access');
  });

  test('manager JWT can run write commands', async () => {
    const managerAuth = authHeader('manager', 'manager');

    const stop = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/stop',
      headers: managerAuth,
    });
    expect(stop.statusCode).toBe(200);
  });

  test('every protected route declares its minimum role', () => {
    const routes = protectedRoutes();

    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((route) => !route.minRole).map((route) => route.key)).toEqual([]);
  });

  test('read-only access is limited to the monitoring allowlist', () => {
    const readOnlyRoutes = protectedRoutes()
        .filter((route) => route.minRole === 'read-only')
        .map((route) => route.key)
        .sort();

    expect(readOnlyRoutes).toEqual(READ_ONLY_ROUTES);
    expect(readOnlyRoutes.every((key) => key.startsWith('GET '))).toBe(true);
  });

  test('read-only JWT is denied on every route outside the allowlist, whatever the method', async () => {
    const commandsService = require('../../api/services/commands');
    const readAuth = authHeader('viewer', 'read-only');
    const deniedRoutes = protectedRoutes().filter((route) => !READ_ONLY_ROUTES.includes(route.key));

    expect(deniedRoutes.map((route) => route.key)).toEqual(expect.arrayContaining([
      'POST /api/v1/commands/transfer',
      'POST /api/v1/commands/withdraw',
      'GET /api/v1/commands/deposit',
      'GET /api/v1/commands/show',
      'GET /api/v1/config',
    ]));

    Object.values(commandsService).forEach((handler) => handler.mockClear());

    for (const route of deniedRoutes) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: readAuth,
      });

      expect({ route: route.key, statusCode: response.statusCode }).toEqual({ route: route.key, statusCode: 403 });
    }

    for (const handler of Object.values(commandsService)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  test('read-only JWT passes authorization on every monitoring read', async () => {
    const readAuth = authHeader('viewer', 'read-only');

    for (const key of READ_ONLY_ROUTES) {
      const [method, url] = key.split(' ');
      const response = await app.inject({
        method,
        url,
        headers: readAuth,
      });

      // Some routes need query params (400) — only authorization matters here
      expect({ route: key, denied: [401, 403].includes(response.statusCode) }).toEqual({ route: key, denied: false });
    }
  });

  test('transfer is POST-only, validates the body, and requires manager', async () => {
    const commandsService = require('../../api/services/commands');
    const body = {
      amount: 1,
      coin: 'USDT',
      from: 'trade',
      to: 'main',
    };

    const legacyGet = await app.inject({
      method: 'GET',
      url: '/api/v1/commands/transfer?amount=1&coin=USDT&from=trade&to=main',
      headers: authHeader('manager', 'manager'),
    });
    expect(legacyGet.statusCode).toBe(404);

    commandsService.runTransfer.mockClear();

    const viewer = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/transfer',
      headers: authHeader('viewer', 'read-only'),
      payload: body,
    });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json().error).toBe('Read-only access');
    expect(commandsService.runTransfer).not.toHaveBeenCalled();

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/transfer',
      headers: authHeader('manager', 'manager'),
      payload: { ...body, amount: 0 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(commandsService.runTransfer).not.toHaveBeenCalled();

    const manager = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/transfer',
      headers: authHeader('manager', 'manager'),
      payload: body,
    });
    expect(manager.statusCode).toBe(200);
    expect(commandsService.runTransfer).toHaveBeenLastCalledWith('manager', body);

    const legacy = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/transfer',
      headers: authHeader('operator'),
      payload: body,
    });
    expect(legacy.statusCode).toBe(200);
  });

  test('transfer rejects non-numeric amounts before the handler runs', async () => {
    const commandsService = require('../../api/services/commands');
    const body = {
      coin: 'USDT',
      from: 'trade',
      to: 'main',
    };

    commandsService.runTransfer.mockClear();

    for (const amount of [true, [7], null, {}, '', '7 USDT']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/commands/transfer',
        headers: authHeader('manager', 'manager'),
        payload: { ...body, amount },
      });

      expect({ amount, statusCode: response.statusCode }).toEqual({ amount, statusCode: 400 });
      expect(response.json().details.fields.amount).toBeDefined();
    }

    expect(commandsService.runTransfer).not.toHaveBeenCalled();

    const numericString = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/transfer',
      headers: authHeader('manager', 'manager'),
      payload: { ...body, amount: '7' },
    });
    expect(numericString.statusCode).toBe(200);
    expect(commandsService.runTransfer).toHaveBeenLastCalledWith('manager', { ...body, amount: 7 });
  });

  test('other money-moving commands reject booleans and arrays in numeric fields', async () => {
    const commandsService = require('../../api/services/commands');
    const cases = [
      ['/api/v1/commands/withdraw', 'runWithdraw', { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', coin: 'USDT', amount: true }],
      ['/api/v1/commands/convert', 'runConvert', { coinFrom: 'USDT', coinTo: 'ETH', amount: [5] }],
      ['/api/v1/commands/place-order', 'runPlaceOrder', { market: 'ETH/USDT', side: 'buy', type: 'market', quoteAmount: true }],
      ['/api/v1/commands/fill', 'runFill', {
        market: 'ETH/USDT',
        side: 'buy',
        price: { from: 90, to: 100 },
        quoteAmount: 100,
        count: [3],
      }],
      ['/api/v1/commands/twap', 'runTwap', { market: 'ETH/USDT', side: 'buy', amount: true, time: '1h', interval: '5m' }],
      ['/api/v1/commands/volume', 'runVolume', { amount: [1000] }],
    ];

    for (const [url, handler, payload] of cases) {
      commandsService[handler].mockClear();

      const response = await app.inject({
        method: 'POST',
        url,
        headers: authHeader('manager', 'manager'),
        payload,
      });

      expect({ url, statusCode: response.statusCode }).toEqual({ url, statusCode: 400 });
      expect(commandsService[handler]).not.toHaveBeenCalled();
    }
  });

  test('enable and disable reject oversized args without validating each element', async () => {
    const commandsService = require('../../api/services/commands');
    const cases = [
      ['/api/v1/commands/enable', 'runEnable'],
      ['/api/v1/commands/disable', 'runDisable'],
    ];

    for (const [url, handler] of cases) {
      commandsService[handler].mockClear();

      // Numbers fail `z.string()`, so a per-element pass would report `args.0`, `args.1`, and so on.
      const oversized = await app.inject({
        method: 'POST',
        url,
        headers: authHeader('manager', 'manager'),
        payload: { feature: 't', args: new Array(33).fill(1) },
      });

      expect({ url, statusCode: oversized.statusCode }).toEqual({ url, statusCode: 400 });
      expect(Object.keys(oversized.json().details.fields)).toEqual(['args']);
      expect(commandsService[handler]).not.toHaveBeenCalled();

      const args = new Array(32).fill('1');
      const allowed = await app.inject({
        method: 'POST',
        url,
        headers: authHeader('manager', 'manager'),
        payload: { feature: 't', args },
      });

      expect({ url, statusCode: allowed.statusCode }).toEqual({ url, statusCode: 200 });
      expect(commandsService[handler]).toHaveBeenLastCalledWith('manager', { feature: 't', args });
    }
  });

  test('config snapshot requires admin when the token carries a role', async () => {
    const manager = await app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: authHeader('manager', 'manager'),
    });
    expect(manager.statusCode).toBe(403);
    expect(manager.json().error).toBe('Admin role required');

    for (const headers of [authHeader('admin', 'admin'), authHeader('operator')]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/config',
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().config.pair).toBe('ETH/USDT');
      expect(response.json().config.api).toEqual({ port: 0, health: false, debug: true });
      expect(response.payload).not.toContain('debug-token-must-not-leak');
    }
  });

  test('JWT with an unknown role is rejected', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot',
      headers: authHeader('operator', 'superadmin'),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
  });

  test('messages list and create work with JWT', async () => {
    const auth = authHeader('operator');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/messages',
      headers: auth,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().messages).toEqual([]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth,
      payload: { message: 'hello', isSelfWritten: true, level: 'info' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().message).toMatchObject({
      user: 'operator',
      message: 'hello',
      isSelfWritten: true,
      level: 'info',
    });
  });

  test('logs export returns gzip with JWT', async () => {
    const auth = authHeader('operator');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/logs?tail=100&level=info',
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/gzip/);
    expect(response.headers['x-log-line-count']).toBe('1');
    expect(Buffer.isBuffer(response.rawPayload) || response.payload.length > 0).toBe(true);
  });

  test('read-only JWT cannot export or grep logs', async () => {
    const logsService = require('../../api/services/logs');
    logsService.buildLogsGzip.mockClear();

    for (const url of ['/api/v1/logs', '/api/v1/logs?tail=20000&grep=withdraw', '/api/v1/logs?level=error&grep=apikey']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: authHeader('viewer', 'read-only'),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('Read-only access');
      expect(response.headers['content-type']).not.toMatch(/gzip/);
    }

    expect(logsService.buildLogsGzip).not.toHaveBeenCalled();
  });

  test('read-only JWT gets safety events from /status instead of the notification feed', async () => {
    const tradeParams = require('../../trade/settings/tradeParams_binance');
    const { markEmergencyStop } = require('../../helpers/mmHealthState');
    const saved = {
      mm_isActive: tradeParams.mm_isActive,
      mm_emergencyStopTs: tradeParams.mm_emergencyStopTs,
      mm_emergencyStopSource: tradeParams.mm_emergencyStopSource,
      mm_emergencyStopReason: tradeParams.mm_emergencyStopReason,
    };

    try {
      const idle = await app.inject({
        method: 'GET',
        url: '/api/v1/status',
        headers: authHeader('viewer', 'read-only'),
      });
      expect(idle.statusCode).toBe(200);
      expect(idle.json().safety).toEqual({ emergencyStop: null, ladderPauses: [] });

      tradeParams.mm_isActive = false;
      markEmergencyStop('inactivity', 'The bot was offline for 7 hours 3 minutes');

      const stopped = await app.inject({
        method: 'GET',
        url: '/api/v1/status',
        headers: authHeader('viewer', 'read-only'),
      });
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json().safety.emergencyStop).toEqual({
        ts: expect.any(Number),
        source: 'inactivity',
        reason: 'The bot was offline for 7 hours 3 minutes',
      });
    } finally {
      Object.assign(tradeParams, saved);
    }
  });

  test('read-only JWT cannot read the notification feed', async () => {
    const messagesService = require('../../api/services/messages');
    messagesService.listMessages.mockClear();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages',
      headers: authHeader('viewer', 'read-only'),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Read-only access' });
    expect(messagesService.listMessages).not.toHaveBeenCalled();
  });

  test('manager, admin, and legacy JWTs keep access to logs and messages', async () => {
    const logsService = require('../../api/services/logs');
    const messagesService = require('../../api/services/messages');

    for (const headers of [authHeader('manager', 'manager'), authHeader('admin', 'admin'), authHeader('operator')]) {
      logsService.buildLogsGzip.mockClear();
      messagesService.listMessages.mockClear();

      const logs = await app.inject({
        method: 'GET',
        url: '/api/v1/logs?grep=withdraw',
        headers,
      });
      expect(logs.statusCode).toBe(200);
      expect(logsService.buildLogsGzip).toHaveBeenCalledWith(expect.objectContaining({ grep: 'withdraw' }));

      const messages = await app.inject({
        method: 'GET',
        url: '/api/v1/messages',
        headers,
      });
      expect(messages.statusCode).toBe(200);
      expect(messagesService.listMessages).toHaveBeenCalledTimes(1);
    }
  });

  test('params endpoint returns current trade params snapshot', async () => {
    const auth = authHeader();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/params',
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().mm.strategy).toBe('optimal');
  });
});

describe('capabilities', () => {
  test('lists installed mm modules from trade/features directory', () => {
    const modules = listInstalledMmModules();
    expect(modules).toContain('mm_trader');
    expect(fs.existsSync(path.join(__dirname, '../../trade/features/mm_trader.js'))).toBe(true);
  });

  test('maps installed modules to capability descriptors', () => {
    const capabilities = getBotCapabilities({ getRates: true });
    const trader = capabilities.modules.find((item) => item.id === 'trader');
    expect(trader).toMatchObject({
      file: 'mm_trader',
      featureKey: 't',
      installed: true,
      moduleAvailable: true,
    });
  });

  test('lists all command features with module availability', () => {
    const capabilities = getBotCapabilities({});
    expect(capabilities.features.find((item) => item.featureKey === 'ob')).toMatchObject({
      file: 'mm_orderbook_builder',
      moduleAvailable: true,
    });
    expect(capabilities.features.every((item) => typeof item.moduleAvailable === 'boolean')).toBe(true);
  });
});

describe('market helpers', () => {
  test('resolvePair validates pair format', () => {
    expect(resolvePair()).toBe('ETH/USDT');
    expect(() => resolvePair('INVALID')).toThrow(BadRequestError);
  });
});
