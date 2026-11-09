'use strict';

/**
 * In-memory MM health samples and `/status` payload. No exchange I/O.
 *
 * @module helpers/mmHealthState
 */

const config = require('../modules/configReader');
const tradeParams = require('../trade/settings/tradeParams_' + config.exchange);
const { evaluateMmHealth, WINDOW_MS, GRACE_MS } = require('./mmHealthEval');

/** @type {import('./mmHealthEval').MmHealthSample[]} */
const samples = [];

const RETAIN_MS = WINDOW_MS + GRACE_MS;

/** Emergency stop sources reported in `GET /status` → `safety.emergencyStop.source` */
const EMERGENCY_STOP_SOURCES = new Set(['inactivity', 'emptyOrderList', 'balanceLoss', 'sniperBot', 'other']);

/** Stored when a caller gives no operator-safe reason */
const DEFAULT_EMERGENCY_STOP_REASON = 'Market-making was stopped as a safety measure';

/** Reason that `/disable ld pause` stores (`modules/commands/features.js`); any other reason means a bot-initiated safety pause */
const LADDER_USER_PAUSE_REASON = 'User command';

const MAX_SAFETY_REASON_LENGTH = 200;

/**
 * @param {unknown} value
 * @returns {number} `value` when it is a positive number, otherwise `0`
 */
function positiveNumber(value) {
  return typeof value === 'number' && value > 0 ? value : 0;
}

/**
 * Normalizes a safety reason: one line, at most 200 characters, without quotes or backslashes.
 * `utils.saveConfig()` writes trade params as a single-quoted JS literal, so an apostrophe would break the file.
 *
 * @param {unknown} text Raw reason
 * @returns {string}
 */
function toSafetyReason(text) {
  return String(text ?? '')
      .replace(/['"`\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_SAFETY_REASON_LENGTH);
}

/**
 * Records an emergency stop in trade params for `GET /status`. The caller saves the params.
 *
 * @param {import('types/webui-api/bot.d.js').WebUiEmergencyStopSource} [source] What triggered the stop
 * @param {string} [reason] Operator-safe summary without balances, amounts, or order details
 * @param {number} [now]
 */
function markEmergencyStop(source, reason, now = Date.now()) {
  tradeParams.mm_emergencyStopTs = now;
  tradeParams.mm_emergencyStopSource = EMERGENCY_STOP_SOURCES.has(source) ? source : 'other';
  tradeParams.mm_emergencyStopReason = toSafetyReason(reason) || DEFAULT_EMERGENCY_STOP_REASON;
}

/**
 * Safety events for `GET /status`, readable by every WebUI role, including `read-only`.
 *
 * `emergencyStop` is set while an emergency stop is in force: market-making is off and was not started after it.
 * `ladderPauses` lists enabled ladders that the bot paused itself (not paused with `/disable ld pause`).
 * Reasons are short summaries; the full notification stays in `GET /messages`, which needs `manager`.
 *
 * @returns {import('types/webui-api/bot.d.js').WebUiSafetyState}
 */
function getSafetyState() {
  const emergencyStopTs = positiveNumber(tradeParams.mm_emergencyStopTs);
  const emergencyInForce = !tradeParams.mm_isActive &&
    emergencyStopTs > 0 &&
    emergencyStopTs >= positiveNumber(tradeParams.mm_generalInitTs);

  const emergencyStop = emergencyInForce ?
    {
      ts: emergencyStopTs,
      source: EMERGENCY_STOP_SOURCES.has(tradeParams.mm_emergencyStopSource) ? tradeParams.mm_emergencyStopSource : 'other',
      reason: toSafetyReason(tradeParams.mm_emergencyStopReason) || DEFAULT_EMERGENCY_STOP_REASON,
    } :
    null;

  const ladderPauses = /** @type {Array<1 | 2>} */ ([1, 2])
      .map((ladder) => {
        const suffix = ladder === 1 ? '' : String(ladder);
        const reason = String(tradeParams[`mm_ladderPauseReason${suffix}`] || '').trim();

        if (!tradeParams[`mm_isLadderActive${suffix}`] ||
            !tradeParams[`mm_isLadderPaused${suffix}`] ||
            reason === LADDER_USER_PAUSE_REASON) {
          return null;
        }

        return {
          ladder,
          ts: positiveNumber(tradeParams[`mm_ladderPauseTs${suffix}`]),
          reason: toSafetyReason(reason) || 'Paused as a safety measure',
        };
      })
      .filter(Boolean);

  return {
    emergencyStop,
    ladderPauses,
  };
}

/**
 * Stamps a fresh MM start: `mm_generalInitTs` and `mm_generalRestartTs` are equal.
 * Used by `/start` and WebUI PUT that turns MM on.
 *
 * @param {number} [now]
 */
function markMmGeneralInit(now = Date.now()) {
  tradeParams.mm_generalInitTs = now;
  tradeParams.mm_generalRestartTs = now;
  samples.length = 0;
}

/**
 * Process restart while MM is already on: keep `mm_generalInitTs`, bump `mm_generalRestartTs`.
 * After this, `mm_generalInitTs < mm_generalRestartTs`.
 * No-ops when MM is off. Persists trade params when a stamp is written.
 *
 * @param {number} [now]
 */
function markMmGeneralRestart(now = Date.now()) {
  if (!tradeParams.mm_isActive) {
    return;
  }

  if (!(typeof tradeParams.mm_generalInitTs === 'number' && tradeParams.mm_generalInitTs > 0)) {
    tradeParams.mm_generalInitTs = now;
  }
  tradeParams.mm_generalRestartTs = now;
  samples.length = 0;
  require('./utils').saveConfig(false, 'Bootstrap-mm_generalRestartTs');
}

/**
 * @param {import('./mmHealthEval').MmHealthSample} sample
 */
function recordSample(sample) {
  samples.push(sample);
  const cutoff = sample.ts - RETAIN_MS;
  while (samples.length > 0 && samples[0].ts < cutoff) {
    samples.shift();
  }
}

/**
 * @returns {import('./mmHealthEval').MmHealthSample[]}
 */
function getSamples() {
  return samples;
}

/**
 * Fields returned by `GET /api/v1/status`.
 *
 * @param {number} [now]
 * @returns {object}
 */
function getHealthPayload(now = Date.now()) {
  const mmActive = Boolean(tradeParams.mm_isActive);
  const mmGeneralInitTs = typeof tradeParams.mm_generalInitTs === 'number' && tradeParams.mm_generalInitTs > 0 ?
    tradeParams.mm_generalInitTs :
    0;
  const mmGeneralRestartTs = typeof tradeParams.mm_generalRestartTs === 'number' && tradeParams.mm_generalRestartTs > 0 ?
    tradeParams.mm_generalRestartTs :
    0;
  const result = evaluateMmHealth({
    mmActive,
    mmGeneralInitTs,
    mmGeneralRestartTs,
    samples,
    now,
  });

  const payload = {
    mmActive,
    mmState: result.mmState,
    mmInGrace: result.inGrace,
    mmWindowMs: result.windowMs,
    mmDegradedReasons: result.reasons,
  };

  if (result.ticker) {
    payload.mmTicker = result.ticker;
  }

  if (mmGeneralInitTs > 0) {
    payload.mmGeneralInitTs = mmGeneralInitTs;
  }
  if (mmGeneralRestartTs > 0) {
    payload.mmGeneralRestartTs = mmGeneralRestartTs;
  }

  payload.safety = getSafetyState();

  return payload;
}

module.exports = {
  LADDER_USER_PAUSE_REASON,
  markEmergencyStop,
  markMmGeneralInit,
  markMmGeneralRestart,
  recordSample,
  getSafetyState,
  getSamples,
  getHealthPayload,
};
