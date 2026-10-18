'use strict';

// Offline regression checks. Run: node --test tests/trader/qutrade_reliability.node.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');

function load(relative, dependencies, additions = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), {
    module,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Buffer, URLSearchParams, setTimeout, ...additions,
  }, { filename: relative });
  return module.exports;
}

function clientHarness(transport) {
  let clock = 10000;
  const calls = [];
  class ClockDate extends Date {
    static now() { return clock; }
  }
  const factory = load('trade/api/qutrade_api.js', {
    crypto,
    axios: async (request) => {
      calls.push({ request, time: clock });
      // Model response latency so pacing is checked from completion, not submission.
      clock += 300;
      return transport(request, calls.length);
    },
  }, {
    Date: ClockDate,
    setTimeout: (callback, delay) => { clock += delay; queueMicrotask(callback); },
  });
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 1)]),
    format: 'der', type: 'pkcs8',
  });
  const key = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const create = () => {
    const client = factory();
    client.setConfig('https://qutrade.invalid/api/v2', key, '01'.repeat(32), '', {});
    return client;
  };
  return { create, calls, privateKey };
}

const success = (payload) => ({ data: { result: 'success', payload } });

test('separate connector instances share completion-based pacing and increasing signed tonces', async () => {
  const h = clientHarness(() => success([]));
  await Promise.all([h.create().cancelOrders([1]), h.create().cancelOrders([2])]);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].time - h.calls[0].time >= 1800);
  const first = Number(new URLSearchParams(h.calls[0].request.data).get('tonce'));
  const second = Number(new URLSearchParams(h.calls[1].request.data).get('tonce'));
  assert.ok(second > first);
  for (const { request } of h.calls) {
    assert.ok(crypto.verify(null, Buffer.from('/cancel_orders' + request.data),
        crypto.createPublicKey(h.privateKey), Buffer.from(request.headers['API-SIGN'], 'hex')));
  }
});

test('identical concurrent public reads are coalesced across instances', async () => {
  const h = clientHarness(() => success({ FBC_USDT: {} }));
  await Promise.all([h.create().markets(), h.create().markets()]);
  assert.equal(h.calls.length, 1);
});

test('429 honors Retry-After across instances, does not retry, and hides request secrets', async () => {
  const h = clientHarness((request, count) => {
    if (count === 1) {
      throw {
        response: { status: 429, headers: { 'retry-after': '5' }, data: { message: 'Too Many Requests' } },
        config: { headers: { 'API-KEY': 'DO-NOT-LOG-THIS' } },
      };
    }
    return success([]);
  });
  await assert.rejects(h.create().cancelOrders([1]), (error) => {
    assert.equal(error.status, 429);
    assert.doesNotMatch(error.message, /DO-NOT-LOG-THIS/);
    return true;
  });
  await h.create().balances();
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].time - h.calls[0].time >= 5300);
});

test('an ambiguous create-order timeout is never retried automatically', async () => {
  const h = clientHarness(() => { throw { code: 'ETIMEDOUT' }; });
  await assert.rejects(h.create().createOrder({ pair: 'FBC_USDT' }));
  assert.equal(h.calls.length, 1);
});

function traderHarness(overrides = {}) {
  const api = { setConfig() {}, ...overrides };
  const factory = load('trade/trader_qutrade.js', {
    './api/qutrade_api': () => api,
    '../helpers/utils': { getModuleName: () => 'trader_qutrade', getPrecision: () => 0.1 },
    '../modules/configReader': { coin1: 'FBC', coin2: 'USDT' },
  });
  return factory('', '', '', { warn() {}, log() {} }, false, false);
}

test('malformed open-order responses are not converted to an empty order list', async () => {
  const trader = traderHarness({ openOrders: async () => ({ payload: null }) });
  assert.equal(await trader.getOpenOrders('FBC/USDT'), undefined);
});

test('malformed order IDs are rejected instead of falsely hiding real orders', async () => {
  const trader = traderHarness({ openOrders: async () => ({ payload: [{ pair: 'FBC_USDT', side: 'buy' }] }) });
  assert.equal(await trader.getOpenOrders('FBC/USDT'), undefined);
});

test('only an explicit empty array confirms that no open orders exist', async () => {
  const trader = traderHarness({ openOrders: async () => ({ payload: [] }) });
  assert.equal((await trader.getOpenOrders('FBC/USDT')).length, 0);
});

test('a cancellation for a different order does not confirm the requested cancellation', async () => {
  const trader = traderHarness({ cancelOrders: async () => ({ payload: [{ order_id: 999, status: 'canceled' }] }) });
  assert.equal(await trader.cancelOrder('123', 'buy', 'FBC/USDT'), undefined);
});

test('the requested order with canceled status confirms cancellation', async () => {
  const trader = traderHarness({ cancelOrders: async () => ({ payload: [{ order_id: 123, status: 'canceled' }] }) });
  assert.equal(await trader.cancelOrder('123', 'buy', 'FBC/USDT'), true);
});

test('partial batch cancellation is not reported as complete success', async () => {
  const trader = traderHarness({
    cancelOrders: async () => ({ payload: [{ order_id: 123, status: 'canceled' }] }),
  });
  trader.getOpenOrders = async () => [{ orderId: '123', side: 'buy' }, { orderId: '456', side: 'sell' }];
  assert.equal(await trader.cancelAllOrders('FBC/USDT'), undefined);
});
