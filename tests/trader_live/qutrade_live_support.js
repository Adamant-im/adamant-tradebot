// @ts-check
'use strict';

/**
 * @typedef {import('../../types/qutrade/api.d.js').QutradeLogger} QutradeLogger
 * @typedef {import('../../trade/trader/trader_qutrade').QutradeMarketInfo} QutradeMarketInfo
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { findNamedConfigPath } = require('../../modules/configPaths');

/**
 * Build a standalone, journaled CHESS/USDT harness without booting the trading daemon
 * @param {'live'|'liveTester'} mode Report category
 * @returns Shared connector, assertions, evidence, timing and cleanup helpers
 */
function createHarness(mode) {
  const root = path.resolve(__dirname, '../..');
  const configName = process.argv[2];
  assert.match(configName || '', /^[a-zA-Z0-9_-]+$/, 'Supply the config name');
  const configPath = findNamedConfigPath(configName, root);
  assert(configPath, 'Config not found');
  const config = JSON.parse(require('jsonminify')(fs.readFileSync(configPath, 'utf8')));
  assert.equal(config.exchange.toLowerCase(), 'qutrade');
  assert.equal(config.pair, 'CHESS/USDT');
  const pair = 'CHESS/USDT';
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(root, '.ai-tasks/test-results');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `qutrade-${mode}-${runId}.json`);
  const reportFile = path.join(directory, `${runId.slice(0, 10)} (TestQutrade-${mode}) ${runId}.md`);
  const report = {
    runId,
    mode,
    pair,
    checks: [],
    warnings: [],
    requests: [],
    orders: [],
    timings: [],
    diagnostics: [],
  };
  const tradeEnabled = process.argv.includes('--trade');
  /** @param {string} message Safe connector log @returns {void} */
  const sink = (message) => {
    report.diagnostics.push({ at: Date.now(), message });
  };
  /** @type {QutradeLogger} */
  const log = { log: sink, info: sink, warn: sink, error: sink };
  require.cache[require.resolve('../../modules/configReader')] = /** @type {NodeModule} */ ({
    exports: { ...config, exchange: 'qutrade', coin1: 'CHESS', coin2: 'USDT', fileWithPath: configPath },
  });
  require.cache[require.resolve('../../helpers/log')] = /** @type {NodeModule} */ ({ exports: log });
  const Api = require('../../trade/api/qutrade_api');
  const Trader = require('../../trade/trader/trader_qutrade');
  const trader = Trader(config.apikey, config.apisecret, '', log, false, false);
  const raw = Api();
  raw.setConfig('https://qutrade.io/api/v2', config.apikey, config.apisecret, '', log);
  const API_DELAY = Number(process.env.QUTRADE_API_DELAY_MS ?? trader.features().apiProcessingDelayMs);
  assert(Number.isInteger(API_DELAY) && API_DELAY >= 0 && API_DELAY <= 10000);

  /** @returns {void} Atomically persist evidence; intent is saved before submission */
  function save() {
    fs.writeFileSync(file + '.tmp', JSON.stringify({ ...report, API_DELAY }, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }

  /** @param {string} endpoint Path @param {any} data Raw response @returns {any} Bounded, credential-free evidence */
  function sample(endpoint, data) {
    if (endpoint === '/spot_markets' || endpoint === '/cryptocurrencies') {
      const payload = data?.payload;
      return {
        ...data,
        payload:
          payload &&
          Object.fromEntries(
            Object.entries(payload).filter(([key]) => ['CHESS_USDT', 'CHESS', 'USDT', 'DOGE_BTC'].includes(key)),
          ),
      };
    }
    if (endpoint === '/deposit_addresses' && data?.payload && typeof data.payload === 'object') {
      return {
        ...data,
        payload: Object.fromEntries(
          Object.entries(data.payload).map(([coin, rows]) => [
            coin,
            Array.isArray(rows)
              ? rows.map((row) => ({ chain: row.chain, address: '[redacted]', hasMemo: Boolean(row.memo) }))
              : rows,
          ]),
        ),
      };
    }
    if (endpoint === '/depth' && data?.payload?.CHESS_USDT) {
      const book = data.payload.CHESS_USDT;
      return {
        ...data,
        payload: { CHESS_USDT: { ...book, bids: book.bids.slice(0, 3), asks: book.asks.slice(0, 3) } },
      };
    }
    if (['/candles_history', '/trading_history'].includes(endpoint) && Array.isArray(data?.payload)) {
      return { ...data, count: data.payload.length, payload: data.payload.slice(0, 3) };
    }
    return data;
  }

  const requestInterceptor = Api.axios.interceptors.request.use((request) => {
    const endpoint = new URL(request.url).pathname.replace('/api/v2', '');
    const params = new URLSearchParams(request.data);
    if (endpoint === '/create_order') {
      assert(tradeEnabled, 'Pass --trade for real order operations');
      assert.equal(params.get('pair'), 'CHESS_USDT');
      assert(params.get('label'), 'Durable label required');
      const price = Number(params.get('requested_price'));
      const base = Number(params.get('requested_base_amount'));
      const quote = Number(params.get('requested_quote_amount'));
      assert(base <= 8 && quote <= 1, 'Live amount cap');
      if (price) assert(price * base <= 1, 'Live limit notional cap');
      report.orders.push({
        label: params.get('label'),
        pair,
        submittedAt: Date.now(),
        id: undefined,
        side: params.get('side'),
        type: params.get('type'),
        base,
        quote,
        price,
        state: 'submitting',
      });
      save();
    }
    // No signed body, key, signature, request config or raw Axios errors are persisted.
    report.requests.push({ endpoint, startedAt: Date.now() });
    return request;
  });
  const responseInterceptor = Api.axios.interceptors.response.use(
    (response) => {
      const endpoint = new URL(response.config.url).pathname.replace('/api/v2', '');
      const entry = report.requests.findLast((item) => item.endpoint === endpoint && !item.finishedAt);
      if (entry)
        Object.assign(entry, {
          finishedAt: Date.now(),
          httpStatus: response.status,
          raw: sample(endpoint, response.data),
        });
      if (endpoint === '/create_order' && response.data?.payload?.order_id) {
        const label = new URLSearchParams(response.config.data).get('label');
        const row = report.orders.find((item) => item.label === label);
        if (row) Object.assign(row, { id: String(response.data.payload.order_id), state: 'acknowledged' });
      }
      save();
      return response;
    },
    (error) => {
      const endpoint = new URL(error.config?.url || 'https://qutrade.io/unknown').pathname.replace('/api/v2', '');
      const entry = report.requests.findLast((item) => item.endpoint === endpoint && !item.finishedAt);
      if (entry)
        Object.assign(entry, {
          finishedAt: Date.now(),
          httpStatus: error.response?.status,
          raw: sample(endpoint, error.response?.data),
          transportCode: error.code,
        });
      save();
      throw error;
    },
  );

  /** @param {string} name Check name @param {() => Promise<any>} work Assertions @returns {Promise<any>} Check output */
  async function check(name, work) {
    try {
      const result = await work();
      report.checks.push({ name, passed: true, normalized: result });
      console.log(`PASS ${name}`);
      save();
      return result;
    } catch (error) {
      report.checks.push({ name, passed: false, error: String(error) });
      console.log(`FAIL ${name}: ${error}`);
      save();
      throw error;
    }
  }

  /** @param {number} [ms=API_DELAY] Added consistency sleep @returns {Promise<void>} Sleep */
  async function pause(ms = API_DELAY) {
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Place with durable response capture; require a returned exchange ID
   * @param {'buy'|'sell'} side Direction
   * @param {number} price Limit price or undefined for market
   * @param {number} amount Base quantity or undefined for quote sizing
   * @param {0|1} [limit=1] Order type
   * @param {number} [quote] Quote quantity
   * @returns {Promise<string>} Tracked order ID
   */
  async function place(side, price, amount, limit = 1, quote) {
    const result = await trader.placeOrder(side, pair, price, amount, limit, quote);
    assert(result?.orderId, result?.message || 'Placement failed');
    const row = report.orders.find((item) => item.label === result.clientOrderId);
    assert(row, 'Intent not journaled');
    row.id = result.orderId;
    row.state = 'acknowledged';
    save();
    return String(result.orderId);
  }

  /**
   * @param {string} id Tracked ID
   * @param {string} status Expected state
   * @param {boolean} [fresh=false] Use an empty cache for independent exchange verification
   * @returns {Promise<any>} Normalized details
   */
  async function details(id, status, fresh = false) {
    const reader = fresh ? Trader(config.apikey, config.apisecret, '', log, false, false) : trader;
    const result = await reader.getOrderDetails(id, pair);
    assert.equal(result?.status, status, `Order ${id} expected ${status}; got ${JSON.stringify(result)}`);
    return result;
  }

  /** @returns {Promise<void>} Cancel only this run's IDs/labels and prove no leaked orders */
  async function cleanup() {
    const open = await trader.getOpenOrders(pair);
    assert(Array.isArray(open), 'Cleanup cannot verify open orders');
    const rawOpen = await raw.openOrders('CHESS_USDT');
    assert.equal(rawOpen.result, 'success');
    for (const row of report.orders) {
      const matched = rawOpen.payload.find((item) => item.label === row.label);
      if (!row.id && matched) row.id = String(matched.order_id);
      if (row.id && open.some((item) => item.orderId === row.id)) {
        const cancelled = await trader.cancelOrder(row.id, row.side, pair);
        assert.notEqual(cancelled, undefined, `Unable to clean up ${row.id}`);
      }
    }
    await pause();
    const remaining = await trader.getOpenOrders(pair);
    assert(Array.isArray(remaining), 'Final list unavailable');
    assert(
      !remaining.some((item) => report.orders.some((row) => row.id === item.orderId)),
      'Live test leaked an open order',
    );
    const untracked = remaining.filter((item) => !report.orders.some((row) => row.id === item.orderId));
    assert.equal(untracked.length, 0, 'Unexpected/untracked CHESS order appeared during this isolated test');
    save();
  }

  /**
   * Preserve failures and finish independent cases only after verifying cleanup
   * @param {string} name Check name
   * @param {() => Promise<any>} work Live mutation and assertions
   * @returns {Promise<void>} Continue only when the scoped account is clean
   */
  async function checkTrade(name, work) {
    try {
      await check(name, work);
    } catch {
      await cleanup();
    }
  }

  /** @returns {Promise<void>} Always cleanup, persist report and print its location */
  async function finish() {
    try {
      await cleanup();
      report.checks.push({
        name: 'Final cleanup: no open or untracked CHESS/USDT orders',
        passed: true,
        normalized: [],
      });
    } catch (error) {
      report.checks.push({ name: 'Final cleanup', passed: false, error: String(error) });
      console.error(String(error));
    }
    Api.axios.interceptors.request.eject(requestInterceptor);
    Api.axios.interceptors.response.eject(responseInterceptor);
    save();
    const failed = report.checks.filter((item) => !item.passed).length;
    const summary = `${report.checks.length - failed}/${report.checks.length} checks passed; ${failed} failed`;
    const body = [
      `# Qutrade ${mode} connector validation`,
      '',
      `Run: ${runId}`,
      '',
      `Pair: ${pair}; extra API consistency sleep: ${API_DELAY} ms`,
      '',
      summary,
      '',
      '## Checks',
      '',
      ...report.checks.map(
        (item) => `- ${item.passed ? 'PASS' : 'FAIL'}: ${item.name}${item.error ? ` — ${item.error}` : ''}`,
      ),
      '',
      '## Limitations and warnings',
      '',
      ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ['- None recorded']),
      '',
      '## Timing evidence',
      '',
      '```json',
      JSON.stringify(report.timings, null, 2),
      '```',
      '',
      '## Raw responses and normalized results',
      '',
      '```json',
      JSON.stringify(report, null, 2),
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(reportFile, body);
    console.log(summary);
    console.log(reportFile);
    process.exitCode = failed ? 1 : 0;
  }

  return { trader, raw, pair, check, checkTrade, pause, place, details, finish, report, save, API_DELAY, tradeEnabled, assert };
}

module.exports = { createHarness };
