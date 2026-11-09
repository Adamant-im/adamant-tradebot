'use strict';

/**
 * @module api/services/params
 * @typedef {import('types/webui-api/params.d.js').WebUiTradeParams} WebUiTradeParams
 * @typedef {import('types/webui-api/params.d.js').WebUiLadderParams} WebUiLadderParams
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/bot/configReader.d.js').BotNiceChartConfig} BotNiceChartConfig
 * @typedef {import('types/bot/configReader.d.js').BotSniperBotWatcherConfig} BotSniperBotWatcherConfig
 */

const equal = require('fast-deep-equal');
const fs = require('fs');
const path = require('path');

const config = require('../../modules/configReader');
const { commands } = require('../../modules/commandTxs');
const { BadRequestError } = require('../lib/errors');
const { updateConfigNestedKeys } = require('../../modules/mm/config-util');
const log = require('../../helpers/log');
const utils = require('../../helpers/utils');
const { isPriceSupportActive } = require('../../helpers/priceSupport');
const { markMmGeneralInit } = require('../../helpers/mmHealthState');

/** Runtime default from `trade/features/mm_ladder.js` when trade-params store `default`. */
const DEFAULT_LADDER_RECHECK_MS = 15000;

const { saveConfig, amount, interval, buypercent, enable } = commands;

/** Monotonic revision for params snapshots (REST PUT + WS `params:updated`). */
let paramsRevision = 0;

/** Meta for the last revision bump (echo attribution). */
let lastUpdateMeta = {
  origin: /** @type {'webui' | 'bot'} */ ('bot'),
  requestId: /** @type {string | null} */ (null),
};

/**
 * Reads current MM trade parameters and maps them to camelCase JSON for WebUI.
 *
 * @returns {WebUiTradeParams}
 */
function getCurrentParams() {
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  const coin1 = config.coin1;
  let denominator = 1000;

  if (tradeParams.mm_intervalUnitUI === 'min') {
    denominator *= 60;
  } else if (tradeParams.mm_intervalUnitUI === 'hour') {
    denominator *= 60 * 60;
  }

  const niceChart = config.nice_chart;
  const sniperBotWatcher = config.sniper_bot_watcher;

  return {
    mm: {
      isActive: tradeParams.mm_isActive,
      strategy: tradeParams.mm_Policy,
    },
    amount: {
      from: tradeParams.mm_minAmount,
      to: tradeParams.mm_maxAmount,
    },
    interval: {
      type: tradeParams.mm_intervalUnitUI,
      from: tradeParams.mm_minInterval / denominator,
      to: tradeParams.mm_maxInterval / denominator,
    },
    buyPercent: tradeParams.mm_buyPercent * 100,
    trader: {
      enabled: Boolean(tradeParams.mm_isTraderActive),
      obLimitPercent: Number(tradeParams.mm_traderObLimitPercent) || 0,
    },
    orderbookBuilding: {
      enabled: tradeParams.mm_isOrderBookActive,
      maxOrders: tradeParams.mm_orderBookOrdersCount,
      maxOrderPercent: tradeParams.mm_orderBookMaxOrderPercent ?? 100,
    },
    liquiditySpread: {
      enabled: tradeParams.mm_isLiquidityActive,
      spread: tradeParams.mm_liquiditySpreadPercent,
      spreadMin: tradeParams.mm_liquiditySpreadPercentMin || 0,
      baseAmount: tradeParams.mm_liquiditySellAmount,
      quoteAmount: tradeParams.mm_liquidityBuyQuoteAmount,
      trend: tradeParams.mm_liquidityTrend,
      support: Boolean(tradeParams.mm_liquiditySpreadSupport),
    },
    priceWatching: {
      type: tradeParams.mm_priceWatcherMidPriceInSourceCoin ? 'price' : 'source',
      enabled: tradeParams.mm_isPriceWatcherActive,
      source: tradeParams.mm_priceWatcherMidPriceInSourceCoin ? '' : tradeParams.mm_priceWatcherSource,
      priceFrom: tradeParams.mm_priceWatcherLowPriceInSourceCoin || null,
      priceTo: tradeParams.mm_priceWatcherHighPriceInSourceCoin || null,
      currency: tradeParams.mm_priceWatcherMidPriceInSourceCoin ? tradeParams.mm_priceWatcherSource : '',
      deviation: tradeParams.mm_priceWatcherDeviationPercent,
      policy: tradeParams.mm_priceWatcherSourcePolicy,
      lowPrice: tradeParams.mm_priceWatcherLowPriceInSourceCoin,
      highPrice: tradeParams.mm_priceWatcherHighPriceInSourceCoin,
      action: tradeParams.mm_priceWatcherAction || 'prevent',
    },
    priceMaker: {
      enabled: tradeParams.mm_isPriceMakerActive,
      initiator: tradeParams.mm_priceMakerInitiator || '',
    },
    cleaner: {
      enabled: tradeParams.mm_isCleanerActive,
      policy: tradeParams.mm_cleanerPolicy,
    },
    fundBalancer: {
      enabled: Boolean(tradeParams.mm_isFundBalancerActive),
    },
    orderbookAntiGap: {
      enabled: tradeParams.mm_isAntigapActive,
      maxOrderPercent: tradeParams.mm_antigapMaxOrderPercent ?? 100,
    },
    supportPrice: {
      enabled: isPriceSupportActive(tradeParams),
      price: tradeParams.mm_priceSupportLowPrice || 0,
    },
    balanceWatcher: {
      enabled: Boolean(tradeParams.mm_isBalanceWatcherActive),
    },
    ladder: readLadder(tradeParams, ''),
    ladder2: readLadder(tradeParams, '2'),
    quoteHunter: {
      enabled: Boolean(tradeParams.mm_isQuoteHunterActive),
      policy: tradeParams.mm_quoteHunterPolicy || 'dump',
      maxOrderDumpPercent: tradeParams.mm_quoteHunterMaxOrderDumpPercent || 2,
      max1hDumpPercent: tradeParams.mm_quoteHunterMax1hDumpPercent || 1,
      max24hDumpPercent: tradeParams.mm_quoteHunterMax24hDumpPercent || 3,
    },
    volatilityChart: {
      enabled: Boolean(tradeParams.mm_isVolatilityActive),
      rate: tradeParams.mm_volatilityRate || 'normal',
    },
    volumeVolatility: {
      enabled: Boolean(tradeParams.mm_isVolumeVolatilityActive),
    },
    priceMakerVolume: {
      enabled: Boolean(tradeParams.mm_isPriceChangeVolumeActive),
    },
    balanceEqualizer: {
      enabled: Boolean(tradeParams.mm_isBalanceEqualizerActive),
      strategy: tradeParams.mm_balanceEqualizerStrategy || 'market',
      maxSlippagePercent: tradeParams.mm_balanceEqualizerMaxSlippagePercent || 1,
    },
    spreadMaintainer: {
      enabled: Boolean(tradeParams.mm_isSpreadMaintainerActive),
    },
    orderNotifier: {
      enabled: Boolean(tradeParams.mm_isOrderNotifierActive),
      amount: tradeParams.mm_orderNotifierAmount || 0,
      amountPriority: tradeParams.mm_orderNotifierAmountPriority || 0,
      amountCoin: tradeParams.mm_orderNotifierAmountCoin || coin1,
    },
    niceChart: {
      enabled: niceChart.enabled !== false,
      failedRequestsBeforeFallback: niceChart.failedRequestsBeforeFallback ?? 3,
    },
    sniperBotWatcher: {
      enabled: sniperBotWatcher.sbwEnabled !== false,
      safeModeThreshold: sniperBotWatcher.safeModeThreshold ?? 3,
      resetThreshold: sniperBotWatcher.resetThreshold ?? 10,
    },
    twap: {
      enabled: Boolean(tradeParams.t_isTwapActive),
    },
  };
}

/**
 * Envelope for WS / PUT responses: params snapshot + echo attribution.
 *
 * @param {{ origin?: 'webui' | 'bot', requestId?: string | null }} [meta]
 * @returns {{ params: WebUiTradeParams, revision: number, origin: 'webui' | 'bot', requestId: string | null }}
 */
function getParamsUpdatePayload(meta) {
  return {
    params: getCurrentParams(),
    revision: paramsRevision,
    origin: meta?.origin ?? lastUpdateMeta.origin,
    requestId: meta?.requestId !== undefined ? meta.requestId : lastUpdateMeta.requestId,
  };
}

/**
 * Bumps the params revision and records who caused the change.
 *
 * @param {'webui' | 'bot'} origin
 * @param {string | null} [requestId]
 * @returns {ReturnType<typeof getParamsUpdatePayload>}
 */
function bumpParamsRevision(origin, requestId = null) {
  paramsRevision += 1;
  lastUpdateMeta = { origin, requestId };
  return getParamsUpdatePayload();
}

/**
 * Maps a command reply error into `{ fields: { [path]: message } }`.
 *
 * @param {{ msgSendBack?: string, errorField?: string }} reply
 * @param {string} field Default WebUiTradeParams path (e.g. `amount`, `priceWatching`)
 */
function throwFieldError(reply, field) {
  let path = field;
  if (reply.errorField) {
    const errField = String(reply.errorField);
    path = errField.includes('.') || field === errField ?
      errField :
      `${field}.${errField}`;
  }

  throw new BadRequestError({
    fields: { [path]: reply.msgSendBack || 'Invalid parameter' },
  });
}

/**
 * PUT `/params` mutates the in-memory trade-params singleton. On a later slice
 * failure the HTTP 400 must not leave MM (or other fields) half-applied.
 *
 * @param {Record<string, unknown>} tradeParams
 * @param {Record<string, unknown>} snapshot
 */
function restoreTradeParams(tradeParams, snapshot) {
  for (const key of Object.keys(tradeParams)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
      delete tradeParams[key];
    }
  }
  Object.assign(tradeParams, snapshot);
}

/**
 * Some command helpers still return plain `msgSendBack` without `isError`.
 * Detect common validation failure prefixes so WebUI does not treat them as success.
 *
 * @param {string | undefined} msg
 * @returns {boolean}
 */
function looksLikeCommandError(msg) {
  const text = String(msg || '').replace(/[*_]/g, '').trim();
  return /^(Wrong|Unable|Set |Unknown|Incorrect|The feature|It seems|Depth|Trading pair|I don't|Specify |Not enough|Are you sure|Failed |Support price)/i.test(text);
}

/**
 * Runs a sync command helper and fails the request on `isError` / error-like replies.
 *
 * @param {() => CommandReply | undefined} fn
 * @param {string} field
 */
function runSyncCommand(fn, field) {
  const reply = fn();
  if (reply?.isError || looksLikeCommandError(reply?.msgSendBack)) {
    throwFieldError(reply || { msgSendBack: 'Command failed' }, field);
  }
  return reply;
}

/**
 * Runs `enable(..., null, true)` and fails the request on `isError` / error-like replies.
 *
 * @param {string[]} argv
 * @param {string} field
 * @returns {Promise<CommandReply | undefined>}
 */
async function runEnable(argv, field) {
  const reply = await enable(argv, null, true);
  if (reply?.isError || looksLikeCommandError(reply?.msgSendBack)) {
    throwFieldError(reply || { msgSendBack: 'Command failed' }, field);
  }
  return reply;
}

/**
 * TWAP-style recheck string (`15sec`) from trade-params, using the runtime default
 * when the store says `default` / false.
 *
 * @param {Record<string, unknown>} tradeParams
 * @param {''|'2'} suffix
 * @returns {string}
 */
function readRecheckInterval(tradeParams, suffix) {
  const smart = tradeParams[`mm_ladderRecheckIntervalSmart${suffix}`];
  if (typeof smart === 'string') {
    const trimmed = smart.trim();
    if (trimmed && trimmed !== 'default') {
      return trimmed.replace(/\s+/g, '');
    }
  }
  const ms = Number(tradeParams[`mm_ladderRecheckIntervalMs${suffix}`]);
  if (Number.isFinite(ms) && ms > 0) {
    return `${Math.round(ms / 1000)}sec`;
  }
  return `${Math.round(DEFAULT_LADDER_RECHECK_MS / 1000)}sec`;
}

/**
 * Normalizes a WebUI recheck value to a smart-time string the bot can parse.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeRecheckSmart(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return `${Math.round(DEFAULT_LADDER_RECHECK_MS / 1000)}sec`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return `${Math.round(raw)}sec`;
  }
  return String(raw).trim().replace(/\s+/g, '');
}

/**
 * Writes recheck interval to trade-params. Throws on an unparseable string.
 *
 * @param {Record<string, unknown>} tradeParams
 * @param {''|'2'} suffix
 * @param {unknown} raw
 * @returns {string}
 */
function applyRecheckInterval(tradeParams, suffix, raw) {
  const smart = normalizeRecheckSmart(raw);
  const parsed = utils.parseSmartTime(smart);
  if (!parsed.isTime) {
    const field = suffix ? 'ladder2.recheckInterval' : 'ladder.recheckInterval';
    throwFieldError({ msgSendBack: `Invalid recheck interval: ${smart}` }, field);
  }
  tradeParams[`mm_ladderRecheckIntervalMs${suffix}`] = parsed.msecs;
  tradeParams[`mm_ladderRecheckIntervalSmart${suffix}`] = smart;
  return smart;
}

/**
 * Quote-price decimal places from the exchange market (fallback 8).
 *
 * @returns {number}
 */
function quotePriceDecimals() {
  try {
    const orderUtils = require('../../trade/orderUtils');
    const market = orderUtils.parseMarket(config.defaultPair || config.pair, undefined, true);
    const decimals = Number(market ? market.coin2Decimals : undefined);
    return Number.isFinite(decimals) && decimals >= 0 ? decimals : 8;
  } catch {
    return 8;
  }
}

/**
 * Rounds a quote price to `coin2Decimals` so IEEE-754 noise is not stored or sent to WebUI.
 *
 * @param {unknown} value
 * @returns {number}
 */
function roundQuotePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return +n.toFixed(quotePriceDecimals());
}

/**
 * @param {Record<string, unknown>} tradeParams
 * @param {''|'2'} [suffix]
 * @returns {WebUiLadderParams}
 */
function readLadder(tradeParams, suffix = '') {
  const midRaw = String(tradeParams[`mm_ladderMidPriceType${suffix}`] || '').toLowerCase();
  return {
    enabled: Boolean(tradeParams[`mm_isLadderActive${suffix}`]),
    amount: Number(tradeParams[`mm_ladderAmount${suffix}`]) || 0,
    amountCoin: String(tradeParams[`mm_ladderAmountCoin${suffix}`] || config.coin2),
    count: Number(tradeParams[`mm_ladderCount${suffix}`]) || 10,
    stepPercent: Number(tradeParams[`mm_ladderPriceStepPercent${suffix}`]) || 1,
    midPrice: roundQuotePrice(tradeParams[`mm_ladderMidPrice${suffix}`]),
    midPriceType: /** @type {'auto' | 'manual'} */ (midRaw === 'manual' ? 'manual' : 'auto'),
    amountGain: Number(tradeParams[`mm_ladderAmountGain${suffix}`]) || 0,
    sellAmountAdjPercent: Number(tradeParams[`mm_ladderSellAmountAdjPercent${suffix}`]) || 0,
    buyAmountAdjPercent: Number(tradeParams[`mm_ladderBuyAmountAdjPercent${suffix}`]) || 0,
    sellPriceAdjPercent: Number(tradeParams[`mm_ladderSellPriceAdjPercent${suffix}`]) || 0,
    buyPriceAdjPercent: Number(tradeParams[`mm_ladderBuyPriceAdjPercent${suffix}`]) || 0,
    autoAmountAdj: Boolean(tradeParams[`mm_ladderAutoAmountAdj${suffix}`]),
    recheckInterval: readRecheckInterval(tradeParams, suffix),
    stopLd2Trigger: suffix ? 0 : Number(tradeParams.mm_ladderStopLd2AtFilledPercent) || 0,
    paused: Boolean(tradeParams[`mm_isLadderPaused${suffix}`]),
    pauseReason: String(tradeParams[`mm_ladderPauseReason${suffix}`] || ''),
    pauseTs: Number(tradeParams[`mm_ladderPauseTs${suffix}`]) || 0,
  };
}

/**
 * Range PW (`type: 'price'`) stores a currency ticker in `mm_priceWatcherSource`.
 * Source-follow stores `PAIR@Exchange`. `type` wins over leftover fields when
 * the operator switches modes in WebUI without clearing the other branch.
 *
 * @param {WebUiTradeParams['priceWatching']} pw
 * @returns {boolean}
 */
function isRangePriceWatching(pw) {
  if (!pw) {
    return false;
  }
  if (pw.type === 'price') {
    return true;
  }
  if (pw.type === 'source') {
    return false;
  }
  return Boolean(pw.currency);
}

/**
 * WebUI may send the exchange name only (`MEXC`). `/enable pw` and the watcher
 * itself require `PAIR@Exchange`.
 *
 * @param {unknown} source
 * @returns {string}
 */
function pairAtExchangeSource(source) {
  const raw = String(source || '').trim();
  if (!raw || raw.startsWith('#')) {
    return raw;
  }
  if (raw.includes('@')) {
    return raw;
  }
  const pair = config.pair || config.defaultPair;
  if (!pair) {
    return raw;
  }
  return `${pair}@${raw}`;
}

/**
 * Writes Price watching fields to trade-params. Used after a successful
 * `/enable pw`, and for a disabled module that should still round-trip GET.
 *
 * @param {Record<string, unknown>} tradeParams
 * @param {WebUiTradeParams['priceWatching']} pw
 */
function persistPriceWatchingFields(tradeParams, pw) {
  tradeParams.mm_priceWatcherAction = pw.action;
  if (isRangePriceWatching(pw)) {
    tradeParams.mm_priceWatcherSource = pw.currency;
    tradeParams.mm_priceWatcherLowPriceInSourceCoin = pw.priceFrom;
    tradeParams.mm_priceWatcherHighPriceInSourceCoin = pw.priceTo;
    const from = Number(pw.priceFrom) || 0;
    const to = Number(pw.priceTo) || 0;
    tradeParams.mm_priceWatcherMidPriceInSourceCoin = from && to ? (from + to) / 2 : from || to;
  } else {
    tradeParams.mm_priceWatcherSource = pairAtExchangeSource(pw.source);
    tradeParams.mm_priceWatcherDeviationPercent = pw.deviation;
    tradeParams.mm_priceWatcherSourcePolicy = pw.policy;
    tradeParams.mm_priceWatcherMidPriceInSourceCoin = 0;
  }
}

/**
 * `highPrice` / `lowPrice` are GET mirrors of the range; a PUT can carry a stale tick.
 * GET also omits defaults (`policy`, empty `currency`) that Zod fills on PUT — compare
 * the enable-relevant fields only so an unrelated save does not re-run `/enable pw`.
 *
 * @param {WebUiTradeParams['priceWatching'] | undefined} pw
 */
function withoutRuntimePriceWatching(pw) {
  if (!pw) {
    return pw;
  }
  return {
    type: pw.type === 'price' ? 'price' : 'source',
    enabled: Boolean(pw.enabled),
    source: String(pw.source ?? ''),
    priceFrom: pw.priceFrom ?? null,
    priceTo: pw.priceTo ?? null,
    currency: pw.currency ?? '',
    deviation: Number(pw.deviation) || 0,
    policy: pw.policy || 'smart',
    action: pw.action === 'fill' ? 'fill' : 'prevent',
  };
}

/**
 * Decimal range token for `/enable pw` so `0.0001374` is never serialized as `1.374e-4`
 * (hyphen in scientific notation breaks `parseRangeOrValue`).
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatRangeBound(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return '0';
  }
  return n.toFixed(16).replace(/\.?0+$/, '');
}

/**
 * Auto mid-price is computed by the bot. WebUI does not treat it as a user
 * field, but a PUT can still carry a stale tick — drop it before `equal()`.
 *
 * @param {import('types/webui-api/params.d.js').WebUiLadderParams | undefined} ladder
 */
function withoutAutoMid(ladder) {
  if (!ladder) {
    return ladder;
  }
  if (ladder.midPriceType === 'manual') {
    return ladder;
  }
  const rest = { ...ladder };
  delete rest.midPrice;
  return rest;
}

/**
 * Pause flags are runtime-only; a PUT must not retrigger `/enable ld` because they drifted.
 *
 * @param {import('types/webui-api/params.d.js').WebUiLadderParams | undefined} ladder
 */
function withoutRuntimeLadder(ladder) {
  if (!ladder) {
    return ladder;
  }
  const rest = { ...withoutAutoMid(ladder) };
  delete rest.paused;
  delete rest.pauseReason;
  delete rest.pauseTs;
  return rest;
}

/**
 * Writes one ladder's settings. `/enable ld` runs only when the ladder is on
 * (disabled ladders still persist field values so WebUI matches the bot).
 *
 * @param {Record<string, unknown>} tradeParams
 * @param {import('types/webui-api/params.d.js').WebUiLadderParams | undefined} ladder
 * @param {''|'2'} suffix
 * @param {string} coin2
 */
async function applyLadder(tradeParams, ladder, suffix, coin2) {
  if (!ladder) {
    return;
  }

  tradeParams[`mm_ladderAmount${suffix}`] = ladder.amount;
  tradeParams[`mm_ladderAmountCoin${suffix}`] = ladder.amountCoin;
  tradeParams[`mm_ladderCount${suffix}`] = ladder.count;
  tradeParams[`mm_ladderPriceStepPercent${suffix}`] = ladder.stepPercent;
  if (ladder.midPriceType === 'manual') {
    tradeParams[`mm_ladderMidPrice${suffix}`] = roundQuotePrice(ladder.midPrice);
    tradeParams[`mm_ladderMidPriceType${suffix}`] = 'manual';
  } else if (String(tradeParams[`mm_ladderMidPriceType${suffix}`] || '').toLowerCase() === 'manual') {
    tradeParams[`mm_ladderMidPriceType${suffix}`] = 'auto';
  }
  tradeParams[`mm_ladderAmountGain${suffix}`] = ladder.amountGain;
  tradeParams[`mm_ladderSellAmountAdjPercent${suffix}`] = ladder.sellAmountAdjPercent;
  tradeParams[`mm_ladderBuyAmountAdjPercent${suffix}`] = ladder.buyAmountAdjPercent;
  tradeParams[`mm_ladderSellPriceAdjPercent${suffix}`] = ladder.sellPriceAdjPercent;
  tradeParams[`mm_ladderBuyPriceAdjPercent${suffix}`] = ladder.buyPriceAdjPercent;
  tradeParams[`mm_ladderAutoAmountAdj${suffix}`] = ladder.autoAmountAdj;
  const recheckSmart = applyRecheckInterval(tradeParams, suffix, ladder.recheckInterval);
  if (!suffix) {
    const stopPct = Number(ladder.stopLd2Trigger) || 0;
    tradeParams.mm_ladderStopLd2AtFilledPercent = stopPct;
    tradeParams.mm_ladderStopLd2At = stopPct > 0;
    tradeParams.mm_ladderStopLd2AtOrderCount = 0;
  }

  if (ladder.enabled) {
    const cmd = suffix ? `ld${suffix}` : 'ld';
    const field = suffix ? 'ladder2' : 'ladder';
    const ldArgv = [
      cmd,
      String(ladder.amount),
      ladder.amountCoin,
      String(ladder.count),
      `step=${ladder.stepPercent}%`,
    ];
    if (ladder.midPriceType === 'manual' && ladder.midPrice > 0) {
      ldArgv.push(`mid=${roundQuotePrice(ladder.midPrice)}`, coin2);
    }
    if (ladder.amountGain > 0) {
      ldArgv.push(`gain=${ladder.amountGain}`);
    }
    if (ladder.sellAmountAdjPercent) {
      ldArgv.push(`sa=${ladder.sellAmountAdjPercent}%`);
    }
    if (ladder.buyAmountAdjPercent) {
      ldArgv.push(`ba=${ladder.buyAmountAdjPercent}%`);
    }
    if (ladder.sellPriceAdjPercent) {
      ldArgv.push(`spa=${ladder.sellPriceAdjPercent}%`);
    }
    if (ladder.buyPriceAdjPercent) {
      ldArgv.push(`bpa=${ladder.buyPriceAdjPercent}%`);
    }
    if (ladder.autoAmountAdj) {
      ldArgv.push('aa');
    }
    ldArgv.push(`recheck=${recheckSmart}`);
    if (!suffix) {
      const stopPct = Number(ladder.stopLd2Trigger) || 0;
      if (stopPct > 0) {
        ldArgv.push(`stopLd2At=${stopPct}%`);
      }
    }
    ldArgv.push('-y');
    await runEnable(ldArgv, field);
  }

  tradeParams[`mm_isLadderActive${suffix}`] = ladder.enabled;
}

/**
 * Absolute path to the bot's `config.jsonc` (or custom MM_CONFIG_PATH).
 *
 * @returns {string}
 */
function resolveBotConfigPath() {
  if (process.env.MM_CONFIG_PATH) {
    return path.resolve(process.env.MM_CONFIG_PATH);
  }

  // `config.configFile` is relative to `modules/` (e.g. `../config.jsonc`)
  return path.resolve(__dirname, '../../modules', config.configFile || '../config.jsonc');
}

/**
 * Applies Nice Chart / Sniper Bot Watcher settings to the live `config` object
 * (takes effect immediately — modules read this object) and persists the
 * top-level keys into `config.jsonc` for the next process start.
 *
 * @param {WebUiTradeParams} params
 */
function applyRuntimeConfigModules(params) {
  if (!params.niceChart || !params.sniperBotWatcher) {
    return;
  }

  const prevNice = JSON.stringify(config.nice_chart || {});
  const prevSbw = JSON.stringify(config.sniper_bot_watcher || {});

  if (!config.nice_chart || typeof config.nice_chart !== 'object') {
    config.nice_chart = /** @type {BotNiceChartConfig} */ ({
      enabled: true,
      failedRequestsBeforeFallback: 3,
    });
  }
  config.nice_chart.enabled = params.niceChart.enabled;
  config.nice_chart.failedRequestsBeforeFallback = params.niceChart.failedRequestsBeforeFallback;

  if (!config.sniper_bot_watcher || typeof config.sniper_bot_watcher !== 'object') {
    config.sniper_bot_watcher = /** @type {BotSniperBotWatcherConfig} */ ({
      sbwEnabled: true,
      safeModeThreshold: 3,
      resetThreshold: 10,
    });
  }
  config.sniper_bot_watcher.sbwEnabled = params.sniperBotWatcher.enabled;
  config.sniper_bot_watcher.safeModeThreshold = params.sniperBotWatcher.safeModeThreshold;
  config.sniper_bot_watcher.resetThreshold = params.sniperBotWatcher.resetThreshold;

  const niceChanged = prevNice !== JSON.stringify(config.nice_chart);
  const sbwChanged = prevSbw !== JSON.stringify(config.sniper_bot_watcher);
  if (!niceChanged && !sbwChanged) {
    return;
  }

  const configPath = resolveBotConfigPath();
  try {
    /** @type {Record<string, unknown>} */
    const patches = {};
    if (niceChanged) {
      patches['nice_chart.enabled'] = config.nice_chart.enabled;
      patches['nice_chart.failedRequestsBeforeFallback'] = config.nice_chart.failedRequestsBeforeFallback;
    }
    if (sbwChanged) {
      patches['sniper_bot_watcher.sbwEnabled'] = config.sniper_bot_watcher.sbwEnabled;
      patches['sniper_bot_watcher.safeModeThreshold'] = config.sniper_bot_watcher.safeModeThreshold;
      patches['sniper_bot_watcher.resetThreshold'] = config.sniper_bot_watcher.resetThreshold;
    }
    updateConfigNestedKeys(configPath, patches);
    if (niceChanged) {
      log.log(
          `Config nice_chart updated by WebUI-setParams() and saved: ${JSON.stringify({
            enabled: config.nice_chart.enabled,
            failedRequestsBeforeFallback: config.nice_chart.failedRequestsBeforeFallback,
          })}`,
      );
    }
    if (sbwChanged) {
      log.log(
          `Config sniper_bot_watcher updated by WebUI-setParams() and saved: ${JSON.stringify({
            sbwEnabled: config.sniper_bot_watcher.sbwEnabled,
            safeModeThreshold: config.sniper_bot_watcher.safeModeThreshold,
            resetThreshold: config.sniper_bot_watcher.resetThreshold,
          })}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BadRequestError(
        `Failed to persist Nice Chart / Sniper Bot Watcher settings to ${configPath}: ${message}`,
    );
  }
}

/**
 * Whether one top-level WebUI params slice differs from the live snapshot.
 *
 * @param {WebUiTradeParams} previous
 * @param {WebUiTradeParams} next
 * @param {keyof WebUiTradeParams} key
 */
function sliceChanged(previous, next, key) {
  return !equal(previous[key], next[key]);
}

/**
 * Applies WebUI params by delegating to existing `commandTxs` helpers with CLI-equivalent argv.
 * PUT sends the full snapshot — `/enable` runs only for slices that actually changed,
 * otherwise unrelated modules would re-init (timestamps, computed mid-price, order reset).
 *
 * @param {WebUiTradeParams} params Validated request body
 * @param {{ requestId?: string | null }} [options]
 * @returns {Promise<ReturnType<typeof getParamsUpdatePayload>>}
 */
async function setParams(params, options = {}) {
  const previous = getCurrentParams();
  if (equal(previous, params)) {
    throw new BadRequestError('Parameters are equal');
  }

  const changed = (/** @type {keyof WebUiTradeParams} */ key) => {
    if (key === 'priceWatching') {
      return !equal(withoutRuntimePriceWatching(previous.priceWatching), withoutRuntimePriceWatching(params.priceWatching));
    }
    return sliceChanged(previous, params, key);
  };
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  const persistedSnapshot = { ...tradeParams };
  const { coin1, coin2 } = config;

  try {
    if (changed('amount')) {
      runSyncCommand(
          () => amount([`${params.amount.from}-${params.amount.to}`, coin1]),
          'amount',
      );
    }
    if (changed('interval')) {
      runSyncCommand(
          () => interval([`${params.interval.from}-${params.interval.to}`, params.interval.type]),
          'interval',
      );
      tradeParams.mm_intervalUnitUI = params.interval.type;
    }
    if (changed('buyPercent')) {
      runSyncCommand(
          () => buypercent([String(params.buyPercent)]),
          'buyPercent',
      );
    }

    if (changed('trader')) {
    // WebUI does not set executeInOrderBook amount limit; Nice Chart default applies.
      if (params.trader.enabled) {
        const traderArgv = [
          't',
          params.mm.strategy,
          `${params.amount.from}-${params.amount.to}`,
          coin1,
          `${params.interval.from}-${params.interval.to}`,
          params.interval.type,
        ];
        await runEnable(traderArgv, 'trader');
      }
      tradeParams.mm_isTraderActive = params.trader.enabled;
    }

    if (changed('orderbookBuilding')) {
      if (params.orderbookBuilding.enabled) {
        await runEnable([
          'ob',
          String(params.orderbookBuilding.maxOrders),
          `${params.orderbookBuilding.maxOrderPercent}%`,
        ], 'orderbookBuilding');
      }
      tradeParams.mm_orderBookOrdersCount = params.orderbookBuilding.maxOrders;
      tradeParams.mm_orderBookMaxOrderPercent = params.orderbookBuilding.maxOrderPercent;
      tradeParams.mm_isOrderBookActive = params.orderbookBuilding.enabled;
    }

    if (changed('liquiditySpread')) {
      const hasLiquiditySafe = fs.existsSync(path.join(__dirname, '../../trade/features/mm_liquidity_safe.js'));
      const hasLiquiditySs = fs.existsSync(path.join(__dirname, '../../trade/features/mm_liquidity_ss.js'));
      const spreadMin = hasLiquiditySafe ? params.liquiditySpread.spreadMin : 0;
      const spreadSupport = hasLiquiditySs && params.liquiditySpread.support;
      const depth =
      spreadMin > 0 ?
        `${spreadMin}-${params.liquiditySpread.spread}%` :
        `${params.liquiditySpread.spread}%`;
      if (params.liquiditySpread.enabled) {
        const liqArgv = [
          'liq',
          depth,
          String(params.liquiditySpread.baseAmount),
          coin1,
          String(params.liquiditySpread.quoteAmount),
          coin2,
          params.liquiditySpread.trend,
        ];
        if (spreadSupport) {
          liqArgv.push('ss');
        }
        liqArgv.push('-y');
        await runEnable(liqArgv, 'liquiditySpread');
      }
      tradeParams.mm_liquiditySpreadPercent = params.liquiditySpread.spread;
      tradeParams.mm_liquiditySpreadPercentMin = spreadMin || 0;
      tradeParams.mm_liquiditySellAmount = params.liquiditySpread.baseAmount;
      tradeParams.mm_liquidityBuyQuoteAmount = params.liquiditySpread.quoteAmount;
      tradeParams.mm_liquidityTrend = params.liquiditySpread.trend;
      tradeParams.mm_liquiditySpreadSupport = Boolean(spreadSupport);
      tradeParams.mm_isLiquidityActive = params.liquiditySpread.enabled;
    }

    if (changed('cleaner')) {
      if (params.cleaner.enabled) {
        await runEnable(['cl', params.cleaner.policy], 'cleaner');
      }
      tradeParams.mm_cleanerPolicy = params.cleaner.policy;
      tradeParams.mm_isCleanerActive = params.cleaner.enabled;
    }

    if (changed('fundBalancer')) {
      if (params.fundBalancer.enabled) {
        if (!config.apikey2) {
          throwFieldError(
              { msgSendBack: 'Fund balancer requires a second API key (apikey2).' },
              'fundBalancer',
          );
        }
        await runEnable(['fb'], 'fundBalancer');
      }
      tradeParams.mm_isFundBalancerActive = params.fundBalancer.enabled;
    }

    if (changed('orderbookAntiGap')) {
      if (params.orderbookAntiGap.enabled) {
        await runEnable(['ag', `${params.orderbookAntiGap.maxOrderPercent}%`], 'orderbookAntiGap');
      }
      tradeParams.mm_antigapMaxOrderPercent = params.orderbookAntiGap.maxOrderPercent;
      tradeParams.mm_isAntigapActive = params.orderbookAntiGap.enabled;
    }

    if (changed('supportPrice')) {
      tradeParams.mm_priceSupportLowPrice = params.supportPrice.price;
      const active = Boolean(params.supportPrice.enabled && params.supportPrice.price > 0);
      if (active) {
        await runEnable(['sp', String(params.supportPrice.price), coin2, '-y'], 'supportPrice');
      }
      tradeParams.mm_isPriceSupportActive = active;
    }

    if (changed('balanceWatcher')) {
      if (params.balanceWatcher.enabled && !tradeParams.mm_isBalanceWatcherActive) {
        await runEnable(['bw'], 'balanceWatcher');
      }
      tradeParams.mm_isBalanceWatcherActive = params.balanceWatcher.enabled;
    }

    if (!equal(withoutRuntimeLadder(previous.ladder), withoutRuntimeLadder(params.ladder))) {
      await applyLadder(tradeParams, params.ladder, '', coin2);
    }
    if (!equal(withoutRuntimeLadder(previous.ladder2), withoutRuntimeLadder(params.ladder2))) {
      await applyLadder(tradeParams, params.ladder2, '2', coin2);
    }

    if (changed('quoteHunter')) {
      tradeParams.mm_quoteHunterPolicy = params.quoteHunter.policy;
      tradeParams.mm_quoteHunterMaxOrderDumpPercent = params.quoteHunter.maxOrderDumpPercent;
      tradeParams.mm_quoteHunterMax1hDumpPercent = params.quoteHunter.max1hDumpPercent;
      tradeParams.mm_quoteHunterMax24hDumpPercent = params.quoteHunter.max24hDumpPercent;
      if (params.quoteHunter.enabled) {
        await runEnable([
          'qh',
          `${params.quoteHunter.maxOrderDumpPercent}%`,
          `${params.quoteHunter.max1hDumpPercent}%`,
          `${params.quoteHunter.max24hDumpPercent}%`,
          params.quoteHunter.policy,
        ], 'quoteHunter');
      }
      tradeParams.mm_isQuoteHunterActive = params.quoteHunter.enabled;
    }

    if (changed('volatilityChart')) {
      tradeParams.mm_volatilityRate = params.volatilityChart.rate;
      if (params.volatilityChart.enabled) {
        await runEnable(['vc', params.volatilityChart.rate], 'volatilityChart');
      }
      tradeParams.mm_isVolatilityActive = params.volatilityChart.enabled;
    }

    if (changed('volumeVolatility')) {
      if (params.volumeVolatility.enabled) {
        await runEnable(['vv'], 'volumeVolatility');
      }
      tradeParams.mm_isVolumeVolatilityActive = params.volumeVolatility.enabled;
    }

    if (changed('priceMakerVolume')) {
      if (params.priceMakerVolume.enabled) {
        await runEnable(['pmv'], 'priceMakerVolume');
      }
      tradeParams.mm_isPriceChangeVolumeActive = params.priceMakerVolume.enabled;
    }

    if (changed('balanceEqualizer')) {
      tradeParams.mm_balanceEqualizerStrategy = params.balanceEqualizer.strategy;
      tradeParams.mm_balanceEqualizerMaxSlippagePercent = params.balanceEqualizer.maxSlippagePercent;
      if (params.balanceEqualizer.enabled) {
        const beArgv = ['be', params.balanceEqualizer.strategy];
        if (params.balanceEqualizer.strategy === 'market') {
          beArgv.push(`${params.balanceEqualizer.maxSlippagePercent}%`);
        }
        await runEnable(beArgv, 'balanceEqualizer');
      }
      tradeParams.mm_isBalanceEqualizerActive = params.balanceEqualizer.enabled;
    }

    if (changed('spreadMaintainer')) {
      if (params.spreadMaintainer.enabled) {
        await runEnable(['sm'], 'spreadMaintainer');
      }
      tradeParams.mm_isSpreadMaintainerActive = params.spreadMaintainer.enabled;
    }

    if (changed('orderNotifier')) {
      const amountCoin = String(params.orderNotifier.amountCoin || coin1).trim().toUpperCase() || coin1;
      if (params.orderNotifier.enabled) {
        const onArgv = ['on', String(params.orderNotifier.amount), amountCoin];
        if (params.orderNotifier.amountPriority > 0) {
          onArgv.push(`priority=${params.orderNotifier.amountPriority}`);
        }
        await runEnable(onArgv, 'orderNotifier');
      } else {
        tradeParams.mm_orderNotifierAmount = params.orderNotifier.amount;
        tradeParams.mm_orderNotifierAmountPriority = params.orderNotifier.amountPriority;
        tradeParams.mm_orderNotifierAmountCoin = amountCoin;
      }
      tradeParams.mm_isOrderNotifierActive = params.orderNotifier.enabled;
    }

    if (changed('niceChart') || changed('sniperBotWatcher')) {
      applyRuntimeConfigModules(params);
    }

    if (changed('priceWatching')) {
      const pw = params.priceWatching;
      const isPlaceholderOff =
      !pw.enabled &&
      ((!pw.currency && pw.source === '#') || pw.currency === '#');

      if (isPlaceholderOff) {
        tradeParams.mm_isPriceWatcherActive = false;
        tradeParams.mm_priceWatcherAction = pw.action;
      } else if (pw.enabled) {
        if (isRangePriceWatching(pw)) {
          await runEnable([
            'pw',
            `${formatRangeBound(pw.priceFrom)}-${formatRangeBound(pw.priceTo)}`,
            pw.currency,
            pw.action,
            '-y',
          ], 'priceWatching');
        } else {
          await runEnable([
            'pw',
            pairAtExchangeSource(pw.source),
            `${pw.deviation}%`,
            pw.policy,
            pw.action,
            '-y',
          ], 'priceWatching');
        }
        persistPriceWatchingFields(tradeParams, pw);
        tradeParams.mm_isPriceWatcherActive = true;
      } else {
        persistPriceWatchingFields(tradeParams, pw);
        tradeParams.mm_isPriceWatcherActive = false;
      }
    }

    // Apply MM last so a rejected `/enable` (e.g. PW vs support price) cannot
    // start the engine and auto-stop before this PUT returns 400.
    if (changed('mm')) {
      const nextActive = Boolean(params.mm.isActive);
      if (nextActive && !tradeParams.mm_isActive) {
        markMmGeneralInit();
      }
      tradeParams.mm_Policy = params.mm.strategy;
      tradeParams.mm_isActive = nextActive;
    }

    const payload = bumpParamsRevision('webui', options.requestId || null);
    saveConfig(true, 'WebUI-setParams()');
    return payload;
  } catch (error) {
    restoreTradeParams(tradeParams, persistedSnapshot);
    throw error;
  }
}

/**
 * Updates only the MM policy/strategy field.
 *
 * @param {string} strategy One of `helpers/const.MM_POLICIES`
 * @param {{ requestId?: string | null }} [options]
 * @returns {ReturnType<typeof getParamsUpdatePayload>}
 */
function setStrategy(strategy, options = {}) {
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  tradeParams.mm_Policy = strategy;
  const payload = bumpParamsRevision('webui', options.requestId || null);
  saveConfig(true, 'WebUI-setStrategy()');
  return payload;
}

module.exports = {
  getCurrentParams,
  getParamsUpdatePayload,
  bumpParamsRevision,
  setParams,
  setStrategy,
};
