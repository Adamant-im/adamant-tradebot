'use strict';

/* global jest, describe, test, expect, beforeAll, afterAll */

const fs = require('fs');
const path = require('path');
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

jest.mock('../../api/services/params', () => ({
  getCurrentParams: () => ({
    mm: { isActive: false, strategy: 'optimal' },
  }),
  setParams: jest.fn(),
  setStrategy: jest.fn(),
}));

jest.mock('../../api/services/commands', () => ({
  runStart: jest.fn(async () => ({ message: 'started' })),
  runStop: jest.fn(async () => ({ message: 'stopped' })),
}));

jest.mock('../../api/services/messages', () => ({
  listMessages: jest.fn(async () => ([])),
  createMessage: jest.fn(async (login, payload) => ({ user: login, ...payload, createdAt: Date.now() })),
}));

jest.mock('../../modules/eventEmitter', () => ({
  emitter: { on: jest.fn() },
  events: { 'parameters:update': 'parameters:update' },
}));

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
  exchange: 'Binance',
  exchangeName: 'Binance',
  version: '23.0.0-test',
  projectBranch: 'test',
  perpetual: false,
  apikey2: false,
  nice_chart: { enabled: true },
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

describe('WebUI API v1', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  beforeAll(async () => {
    const { buildApp } = require('../../api/server');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  test('health endpoint is public', async () => {
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

  function authHeader(login = 'operator') {
    const token = signHs256({ login }, 'test-secret');
    return { authorization: `Bearer ${token}` };
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
    const token = signHs256({ login: 'operator', enabled: false }, 'test-secret');
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

    const stop = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/stop',
      headers: auth,
    });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ message: 'stopped' });
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
      payload: { message: 'hello', isSelfWritten: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().message).toMatchObject({
      user: 'operator',
      message: 'hello',
      isSelfWritten: true,
    });
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
  test('lists installed mm modules from trade directory', () => {
    const modules = listInstalledMmModules();
    expect(modules).toContain('mm_trader');
    expect(fs.existsSync(path.join(__dirname, '../../trade/mm_trader.js'))).toBe(true);
  });

  test('maps installed modules to capability descriptors', () => {
    const capabilities = getBotCapabilities({ getRates: true });
    const trader = capabilities.modules.find((item) => item.id === 'trader');
    expect(trader).toMatchObject({
      file: 'mm_trader',
      featureKey: 't',
      installed: true,
    });
  });
});

describe('market helpers', () => {
  test('resolvePair validates pair format', () => {
    expect(resolvePair()).toBe('ETH/USDT');
    expect(() => resolvePair('INVALID')).toThrow(BadRequestError);
  });
});
