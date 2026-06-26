// @ts-nocheck — delegates to commandTxs; typed at HTTP boundary via Zod + WebUiTradeParams.
'use strict';

/**
 * @module api/services/params
 * @typedef {import('types/webui-api/params.d.js').WebUiTradeParams} WebUiTradeParams
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 */

const equal = require('fast-deep-equal');

const config = require('../../modules/configReader');
const { commands } = require('../../modules/commandTxs');
const { BadRequestError } = require('../lib/errors');

const { saveConfig, amount, interval, buypercent, enable } = commands;

/**
 * Reads current MM trade parameters and maps them to camelCase JSON for WebUI.
 *
 * @returns {WebUiTradeParams}
 */
function getCurrentParams() {
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  let denominator = 1000;

  if (tradeParams.mm_intervalUnitUI === 'min') {
    denominator *= 60;
  } else if (tradeParams.mm_intervalUnitUI === 'hour') {
    denominator *= 60 * 60;
  }

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
    orderbookBuilding: {
      enabled: tradeParams.mm_isOrderBookActive,
      maxOrders: tradeParams.mm_orderBookOrdersCount,
    },
    liquiditySpread: {
      enabled: tradeParams.mm_isLiquidityActive,
      spread: tradeParams.mm_liquiditySpreadPercent,
      baseAmount: tradeParams.mm_liquiditySellAmount,
      quoteAmount: tradeParams.mm_liquidityBuyQuoteAmount,
      trend: tradeParams.mm_liquidityTrend,
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
    },
    priceMaker: {
      enabled: tradeParams.mm_isPriceMakerActive,
      initiator: tradeParams.mm_priceMakerInitiator,
    },
    cleaner: {
      enabled: tradeParams.mm_isCleanerActive,
      policy: tradeParams.mm_cleanerPolicy,
    },
    fundBalancer: {
      enabled: config.apikey2 ? tradeParams.mm_isFundBalancerActive : false,
    },
    orderbookAntiGap: {
      enabled: tradeParams.mm_isAntigapActive,
    },
  };
}

/**
 * Applies WebUI params by delegating to existing `commandTxs` enable/amount helpers.
 * Keeps trade-param file format unchanged while exposing camelCase JSON to clients.
 *
 * @param {WebUiTradeParams} params Validated request body
 * @returns {Promise<void>}
 */
async function setParams(params) {
  if (equal(getCurrentParams(), params)) {
    throw new BadRequestError('Parameters are equal');
  }

  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  const { coin1, coin2 } = config;

  amount([`${params.amount.from}-${params.amount.to}`]);
  interval([`${params.interval.from}-${params.interval.to}`, params.interval.type]);
  tradeParams.mm_intervalUnitUI = params.interval.type;
  buypercent([String(params.buyPercent)]);
  await enable(['ob', String(params.orderbookBuilding.maxOrders)]);
  tradeParams.mm_isOrderBookActive = params.orderbookBuilding.enabled;
  await enable([
    'liq',
    `${params.liquiditySpread.spread}%`,
    String(params.liquiditySpread.baseAmount),
    coin1,
    String(params.liquiditySpread.quoteAmount),
    coin2,
    params.liquiditySpread.trend,
  ]);
  tradeParams.mm_isLiquidityActive = params.liquiditySpread.enabled;
  await enable(['cl', params.cleaner.policy]);
  tradeParams.mm_isCleanerActive = params.cleaner.enabled;

  await enable(['fb']);
  tradeParams.mm_isFundBalancerActive = params.fundBalancer.enabled;

  await enable(['ag']);
  tradeParams.mm_isAntigapActive = params.orderbookAntiGap.enabled;

  // Disabling price watcher with placeholder source — skip PW enable flow.
  if (
    !params.priceWatching.enabled &&
    ((!params.priceWatching.currency && params.priceWatching.source === '#') ||
      (params.priceWatching.currency && params.priceWatching.currency === '#'))
  ) {
    saveConfig(true, 'WebUI-setParams()');
    return;
  }

  /** @type {CommandReply} */
  let pwEnableMsg = {};

  if (params.priceWatching.currency) {
    pwEnableMsg = await enable([
      'pw',
      `${params.priceWatching.priceFrom}-${params.priceWatching.priceTo}`,
      params.priceWatching.currency,
      '-y',
    ], true);
  } else {
    pwEnableMsg = await enable([
      'pw',
      params.priceWatching.source,
      `${params.priceWatching.deviation}%`,
      params.priceWatching.policy,
      '-y',
    ], true);
  }

  if (!pwEnableMsg.isError) {
    tradeParams.mm_isPriceWatcherActive = params.priceWatching.enabled;
  } else {
    const errorField = `priceWatching.${pwEnableMsg.errorField}`;
    throw new BadRequestError({ fields: { [errorField]: pwEnableMsg.msgSendBack } });
  }

  saveConfig(true, 'WebUI-setParams()');
}

/**
 * Updates only the MM policy/strategy field.
 *
 * @param {string} strategy One of `helpers/const.MM_POLICIES`
 */
function setStrategy(strategy) {
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  tradeParams.mm_Policy = strategy;
  saveConfig(true, 'WebUI-setStrategy()');
}

module.exports = {
  getCurrentParams,
  setParams,
  setStrategy,
};
