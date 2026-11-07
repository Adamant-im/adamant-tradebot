'use strict';

/**
 * Pure market-making health evaluation (no I/O).
 *
 * The first 10 minutes after `mm_generalRestartTs` (or `mm_generalInitTs` if
 * restart is unset) are a grace period: always `working`. After that, the
 * observation window is a rolling astronomical hour (`now - 1h`), or the time
 * since grace ended if that is shorter. More than 10 minutes of MM runtime is
 * already enough to judge an incomplete hour.
 *
 * Samples taken during grace are excluded so empty caches at startup do not
 * trip degraded. Missing fields (failed or stale peeks) are ignored:
 * only received numbers are evaluated. At least one change in `last`, `bid`,
 * or `ask` among received ticker values means the ticker is not frozen.
 * Repeating an expired REST cache is not a ticker observation (see peek TTL).
 *
 * @module helpers/mmHealthEval
 */

const GRACE_MS = 10 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * @typedef {'no_open_orders' | 'empty_base' | 'empty_quote' | 'frozen_ticker'} MmDegradedReason
 * @typedef {'working' | 'degraded' | 'stopped'} MmHealthState
 *
 * @typedef {Object} MmHealthSample
 * @property {number} ts
 * @property {number} [orderCount]
 * @property {number} [baseTotal]
 * @property {number} [quoteTotal]
 * @property {number} [last]
 * @property {number} [bid]
 * @property {number} [ask]
 *
 * @typedef {Object} MmHealthEvalInput
 * @property {boolean} mmActive
 * @property {number} [mmGeneralInitTs]
 * @property {number} [mmGeneralRestartTs]
 * @property {MmHealthSample[]} samples
 * @property {number} now
 * @property {number} [graceMs]
 * @property {number} [maxWindowMs]
 *
 * @typedef {Object} MmHealthEvalResult
 * @property {MmHealthState} mmState
 * @property {MmDegradedReason[]} reasons
 * @property {number} windowMs
 * @property {boolean} inGrace
 * @property {{ last: { n: number, min?: number, max?: number }, bid: { n: number, min?: number, max?: number }, ask: { n: number, min?: number, max?: number } }} [ticker]
 */

/**
 * Finite numbers only — missing/failed peeks are not observations.
 *
 * @param {MmHealthSample[]} window
 * @param {'orderCount' | 'baseTotal' | 'quoteTotal' | 'last' | 'bid' | 'ask'} key
 * @returns {number[]}
 */
function receivedAmounts(window, key) {
  const values = [];
  for (const sample of window) {
    const value = sample[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

/**
 * True when every value is Object.is-equal to the first.
 * Fewer than two observations cannot prove that a series never changed.
 *
 * @param {number[]} values
 * @returns {boolean}
 */
function neverChanged(values) {
  if (values.length < 2) {
    return false;
  }
  const first = values[0];
  return values.every((value) => Object.is(value, first));
}

/**
 * @param {number[]} values
 * @returns {{ n: number, min?: number, max?: number }}
 */
function seriesObserve(values) {
  if (values.length === 0) {
    return { n: 0 };
  }
  return {
    n: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * @param {MmHealthEvalInput} input
 * @returns {MmHealthEvalResult}
 */
function evaluateMmHealth(input) {
  const graceMs = input.graceMs ?? GRACE_MS;
  const maxWindowMs = input.maxWindowMs ?? WINDOW_MS;
  const now = input.now;
  const samples = Array.isArray(input.samples) ? input.samples : [];

  if (!input.mmActive) {
    return {
      mmState: 'stopped',
      reasons: [],
      windowMs: 0,
      inGrace: false,
    };
  }

  const initTs = typeof input.mmGeneralInitTs === 'number' && input.mmGeneralInitTs > 0 ?
    input.mmGeneralInitTs :
    now;
  const restartTs = typeof input.mmGeneralRestartTs === 'number' && input.mmGeneralRestartTs > 0 ?
    input.mmGeneralRestartTs :
    initTs;
  const elapsed = Math.max(0, now - restartTs);

  if (elapsed <= graceMs) {
    return {
      mmState: 'working',
      reasons: [],
      windowMs: elapsed,
      inGrace: true,
    };
  }

  const graceEnd = restartTs + graceMs;
  const windowStart = Math.max(graceEnd, now - maxWindowMs);
  const windowMs = Math.max(0, now - windowStart);
  const window = samples.filter((sample) => sample.ts >= windowStart && sample.ts <= now);

  // Post-grace samples have not arrived yet (30s sampler) — do not false-trip.
  if (window.length === 0) {
    return {
      mmState: 'working',
      reasons: [],
      windowMs,
      inGrace: false,
    };
  }

  /** @type {MmDegradedReason[]} */
  const reasons = [];

  const orderCounts = receivedAmounts(window, 'orderCount');
  if (orderCounts.length > 0 && !orderCounts.some((count) => count > 0)) {
    reasons.push('no_open_orders');
  }

  const bases = receivedAmounts(window, 'baseTotal');
  const quotes = receivedAmounts(window, 'quoteTotal');
  if (bases.length > 0 && !bases.some((amount) => amount > 0)) {
    reasons.push('empty_base');
  }
  if (quotes.length > 0 && !quotes.some((amount) => amount > 0)) {
    reasons.push('empty_quote');
  }

  const lasts = receivedAmounts(window, 'last');
  const bids = receivedAmounts(window, 'bid');
  const asks = receivedAmounts(window, 'ask');
  if (neverChanged(lasts) && neverChanged(bids) && neverChanged(asks)) {
    reasons.push('frozen_ticker');
  }

  return {
    mmState: reasons.length ? 'degraded' : 'working',
    reasons,
    windowMs,
    inGrace: false,
    ticker: {
      last: seriesObserve(lasts),
      bid: seriesObserve(bids),
      ask: seriesObserve(asks),
    },
  };
}

module.exports = {
  GRACE_MS,
  WINDOW_MS,
  evaluateMmHealth,
};
