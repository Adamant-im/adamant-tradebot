'use strict';

/**
 * Peeks REST caches (no extra exchange calls) and records MM health samples.
 * Lives in helpers/ so it is not listed as a `trade/features/mm_*.js` capability.
 *
 * @module helpers/mmRuntimeHealth
 */

const config = require('../modules/configReader');
const log = require('./log');
const { rescheduleIteration } = require('./moduleIteration');
const tradeParams = require('../trade/settings/tradeParams_' + config.exchange);
const orderUtils = require('../trade/orderUtils');
const { recordSample } = require('./mmHealthState');

const SAMPLE_MS = 30 * 1000;

const moduleName = 'mmRuntimeHealth';

/** Last cache timestamps already recorded — same fill must not count twice. */
let lastOrdersTs = 0;
let lastRatesTs = 0;
let lastBalancesTs = 0;

/**
 * Spot/trade total for a coin from a cached balances array.
 *
 * @param {object[] | undefined} balances
 * @param {string} code
 * @returns {number | undefined}
 */
function pickSpotTotal(balances, code) {
  if (!Array.isArray(balances) || !code) {
    return undefined;
  }

  const upper = String(code).toUpperCase();
  const matches = balances.filter((item) => String(item?.code || '').toUpperCase() === upper);
  const item = matches.find((row) => !row.accountType || row.accountType === 'spot' || row.accountType === 'trade') ||
    matches[0];

  if (!item || typeof item.total !== 'number' || !Number.isFinite(item.total)) {
    return undefined;
  }

  return item.total;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function finiteNum(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

module.exports = {
  run() {
    this.iteration();
  },

  iteration() {
    try {
      if (tradeParams.mm_isActive) {
        this.capture();
      }
    } catch (error) {
      log.error(`${moduleName}: capture failed: ${error}`);
    } finally {
      rescheduleIteration(() => this.iteration(), SAMPLE_MS);
    }
  },

  /**
   * Records one peek-only snapshot of open orders, pair balances, and ticker.
   */
  capture() {
    const pair = config.pair || config.defaultPair;
    // Sample interval, not REST TTL (1s): a leftover cache after a failed
    // getRates must not be copied every 30s as a "frozen" ticker.
    const peek = orderUtils.peekCachedMarket(pair, SAMPLE_MS);
    const rates = peek.rates && peek.ratesTs !== lastRatesTs ? peek.rates : {};
    if (peek.ratesTs && peek.ratesTs !== lastRatesTs) {
      lastRatesTs = peek.ratesTs;
    }
    const orderCount = Array.isArray(peek.orders) && peek.ordersTs !== lastOrdersTs ?
      peek.orders.length :
      undefined;
    if (peek.ordersTs && peek.ordersTs !== lastOrdersTs) {
      lastOrdersTs = peek.ordersTs;
    }
    const balances = peek.balances && peek.balancesTs !== lastBalancesTs ? peek.balances : undefined;
    if (peek.balancesTs && peek.balancesTs !== lastBalancesTs) {
      lastBalancesTs = peek.balancesTs;
    }
    const baseTotal = pickSpotTotal(balances, config.coin1);
    const quoteTotal = pickSpotTotal(balances, config.coin2);
    const last = finiteNum(rates.last);
    const bid = finiteNum(rates.bid);
    const ask = finiteNum(rates.ask);

    if (
      orderCount === undefined &&
      baseTotal === undefined &&
      quoteTotal === undefined &&
      last === undefined &&
      bid === undefined &&
      ask === undefined
    ) {
      return;
    }

    recordSample({
      ts: Date.now(),
      orderCount,
      baseTotal,
      quoteTotal,
      last,
      bid,
      ask,
    });
  },
};
