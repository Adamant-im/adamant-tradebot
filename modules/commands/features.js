'use strict';

/**
 * @module modules/commands/features
 * @typedef {import('types/bot/commandTxs.d.js').BotFeaturesRegistry} BotFeaturesRegistry
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/bot/featureValidateResult.d').FeatureValidateResult} FeatureValidateResult
 */

const {
  constants, utils, config, log, tradeParams, moduleName, exchangerUtils, orderUtils, traderapi,
} = require('./context');
const {
  formSendBackMessage, formSendBackAndNotify, setPendingConfirmation,
  getCoinRatesInfo, getExchangeRatesInfo, validateTraderMinAmount,
} = require('./helpers');
const { balances } = require('./account');

// Broader than orderCollector.orderPurposes because not all features have their own order purpose.
/** @type {BotFeaturesRegistry} */
const botFeatures = {
  t: {
    description: 'making trading volume',
    module: '../../trade/mm_trader',
    tradeParamActiveName: 'mm_isTraderActive',
    perpetual: true,
  },
  ob: {
    description: 'dynamic order book building',
    module: '../../trade/mm_orderbook_builder',
    tradeParamActiveName: 'mm_isOrderBookActive',
    perpetual: true,
  },
  liq: {
    description: 'liquidity and spread maintenance',
    module: '../../trade/mm_liquidity_provider',
    tradeParamActiveName: 'mm_isLiquidityActive',
    perpetual: false,
  },
  pw: {
    description: 'price watching',
    module: '../../trade/mm_price_watcher',
    tradeParamActiveName: 'mm_isPriceWatcherActive',
    perpetual: false,
  },
  bw: {
    description: 'balance watching',
    module: '../../trade/mm_balance_watcher',
    tradeParamActiveName: 'mm_isBalanceWatcherActive',
    perpetual: false,
  },
  ld: {
    description: 'ladder/grid trading',
    module: '../../trade/mm_ladder',
    tradeParamActiveName: 'mm_isLadderActive',
    perpetual: false,
  },
  ag: {
    description: 'order book anti-gap',
    module: '../../trade/mm_antigap',
    tradeParamActiveName: 'mm_isAntigapActive',
    perpetual: false,
  },
  cl: {
    description: 'order book cleaner',
    module: '../../trade/mm_cleaner',
    tradeParamActiveName: 'mm_isCleanerActive',
    perpetual: false,
  },
  sp: {
    description: 'support price',
    module: '../../trade/mm_price_watcher',
    tradeParamActiveName: 'mm_priceSupportLowPrice',
    perpetual: false,
  },
  qh: {
    description: 'quote hunter',
    module: '../../trade/mm_quote_hunter',
    tradeParamActiveName: 'mm_isQuoteHunterActive',
    perpetual: false,
  },
  vc: {
    description: 'volatility chart',
    module: '../../trade/mm_volatility_chart',
    tradeParamActiveName: 'mm_isVolatilityActive',
    perpetual: false,
    requires: 'mm_isTraderActive',
  },
  vv: {
    description: 'volume volatility',
    module: '../../trade/mm_volume_volatility',
    tradeParamActiveName: 'mm_isVolumeVolatilityActive',
    perpetual: false,
    requires: 'mm_isTraderActive',
  },
  pmv: {
    description: 'creating additional volume by Price maker and Price watcher',
    module: '../../trade/mm_price_maker',
    tradeParamActiveName: 'mm_isPriceChangeVolumeActive',
    perpetual: false,
  },
  fb: {
    description: '2-key trading fund balancer',
    module: '../../trade/mm_fund_balancer',
    tradeParamActiveName: 'mm_isFundBalancerActive',
    perpetual: false,
    requires: 'mm_isTraderActive',
  },
  be: {
    description: 'balance equalizer when third-party bots are active',
    module: '../../trade/mm_balance_equalizer',
    tradeParamActiveName: 'mm_isBalanceEqualizerActive',
    perpetual: false,
  },
  sm: {
    description: 'spread maintainer',
    module: '../../trade/mm_spread_maintainer',
    tradeParamActiveName: 'mm_isSpreadMaintainerActive',
    perpetual: false,
  },
  on: {
    description: 'order notifier',
    module: '../../trade/mm_order_notifier',
    tradeParamActiveName: 'mm_isOrderNotifierActive',
    perpetual: true,
  },
};


/**
 * Loads a feature's trade module when `botFeatures[featureKey].module` is set.
 *
 * @param {string} featureKey Feature code, e.g. `pw` or `ld`
 * @returns {any | undefined}
 */
function getFeatureModule(featureKey) {
  const modulePath = botFeatures[featureKey]?.module;

  if (!modulePath) {
    return undefined;
  }

  return utils.softRequire(modulePath, __filename);
}

/** No-op Price Watcher when `trade/mm_price_watcher.js` is omitted — PM/PW coordination from other features */
const noopPriceWatcher = {
  restorePw() {},
  savePw() {},
  getPwInfoString() {
    return '';
  },
};

/**
 * Price Watcher module for cross-feature PM/PW calls (`t`, `vc`, `sp`), or a no-op when omitted.
 *
 * @returns {ReturnType<typeof getFeatureModule> | typeof noopPriceWatcher}
 */
function getPriceWatcherModule() {
  return getFeatureModule('pw') || noopPriceWatcher;
}

/**
 * Validates whether a feature code exists and is allowed on the current exchange mode.
 *
 * @param {string} feature Feature/purpose code to enable or disable
 * @param {'enable' | 'disable'} [action='enable'] Used to compose an example command in `msgSendBack`
 * @returns {FeatureValidateResult}
 */
function validateFeature(feature, action = 'enable') {
  const featureExists = Object.keys(botFeatures).includes(feature);
  const featureDef = featureExists ? botFeatures[feature] : undefined;

  const perpetual = featureExists && featureDef.perpetual;
  const description = featureExists && featureDef.description;
  const tradeParamActiveName = featureExists && featureDef.tradeParamActiveName;
  const moduleAvailable = !featureDef?.module || Boolean(getFeatureModule(feature));

  const validated = perpetual;

  let featureDescription = Object.entries(botFeatures)
      .map(([key, value]) => `\n_${key}_ for ${value.description}`)
      .join(', ');
  featureDescription = utils.trimAny(featureDescription, ', ') + '.';

  let msgSendBack = 'Specify a feature:\n';
  msgSendBack += featureDescription;
  msgSendBack += action === 'enable' ? '\n\nExample: */enable ob 15*.' : '\n\nExample: */disable ob*.';

  if (featureExists && !moduleAvailable) {
    msgSendBack = `In this version of the bot, the ${utils.capitalize(description)} module is not included. To get it, contact the manager at https://marketmaking.app.`;
  }

  return {
    featureExists,
    validated,
    perpetual,
    tradeParamActiveName,
    description,
    moduleAvailable,
    msgSendBack,
  };
}


/**
 * Builds a warning when the configured Trader interval makes Nice Chart operate
 * in a closing-only/degraded cadence.
 *
 * @returns {string} Warning text or an empty string
 */
function getNiceChartIntervalWarning() {
  const niceChart = utils.softRequire('../../trade/mm_nice_chart');
  const niceChartEnabled = config.nice_chart?.enabled !== false;
  const minInterval = Number(tradeParams.mm_minInterval);
  const thresholdMs = (constants.NICE_CHART_BASE_TIMEFRAME_MS / 2) - constants.NICE_CHART_CLOSE_TRADE_WINDOW_MAX_MS;

  if (!niceChart || !niceChartEnabled || !Number.isFinite(minInterval) || minInterval < thresholdMs) {
    return '';
  }

  const thresholdSec = Math.round(thresholdMs / 1000);
  const baseTimeframeSec = Math.round(constants.NICE_CHART_BASE_TIMEFRAME_MS / 1000);
  const warning = `Warning: Nice Chart is degraded with mm_minInterval=${Math.round(minInterval / 1000)} sec ` +
    `(threshold is ${thresholdSec} sec for ${constants.NICE_CHART_BASE_TIMEFRAME}). ` +
    (minInterval >= constants.NICE_CHART_BASE_TIMEFRAME_MS ?
      `Closing trades are disabled when mm_minInterval is ${baseTimeframeSec} sec or more.` :
      `Trader will reserve each ${constants.NICE_CHART_BASE_TIMEFRAME} candle for one closing trade.`);

  log.warn(`commandTxs/getNiceChartIntervalWarning: ${warning}`);
  return warning;
}


/**
 * Builds a comma-separated list of enabled (or all) bot features for `/start`, `/stop`, and `/features`.
 *
 * @param {boolean} [includeDisabled=false] When `true`, lists every feature with its on/off value
 * @returns {string} Feature list or an empty string when nothing matches
 */
function composeFeatureList(includeDisabled = false) {
  const list = [];

  for (const [key, value] of Object.entries(botFeatures)) {
    for (let mIndex = 1; mIndex <= 2; mIndex++) {
      const moduleNo = mIndex === 1 ? '' : mIndex;

      let activeValue = tradeParams[`${value.tradeParamActiveName}${moduleNo}`];
      const requiredActiveValue = tradeParams[`${value.requires}${moduleNo}`];
      const featureString = `_${key}${moduleNo}_ (${value.description})`;

      if (includeDisabled) {
        if (activeValue !== undefined) {
          activeValue = activeValue ? `**${activeValue}**` : activeValue;

          list.push(`${featureString}: ${activeValue}`);
        }
      } else {
        if (activeValue && (!value.requires || requiredActiveValue)) {
          list.push(featureString);
        }
      }
    }
  }

  return list.length ? list.join(',\n') + '.' : '';
}


/**
 * Shows the bot feature list
 * @param {string[]} params Param list
 * @returns {Promise<CommandReply>}
 */
async function features(params) {
  const commandExample = `Try: */features list*`;

  // Parse command params

  const parsedParams = utils.parseCommandParams(params, 0);

  const optionParam = parsedParams?.more?.[0]; // 'list'
  const option = optionParam?.param;

  const verify = utils.verifyParam('option', option, '[list]', true);

  if (!verify.success) {
    return formSendBackMessage(`Unknown option: _${option}_. ${commandExample}.`);
  }

  let msgSendBack;

  const enabledFeatures = composeFeatureList(!!option);

  if (option) {
    // Show all available features
    msgSendBack = 'Market-making features:\n';
    msgSendBack += enabledFeatures;
  } else {
    // Show only enabled features
    if (enabledFeatures) {
      msgSendBack = 'Enabled features:\n';
      msgSendBack += enabledFeatures;
    } else {
      msgSendBack = '\nAll market-making features are currently inactive. Enable any of them using the **/enable** command.\n';
    }
  }

  if (tradeParams.mm_isActive) {
    msgSendBack += `\n\nMarket-making is **active**.`;
  } else {
    msgSendBack += `\n\nMarket-making is **disabled**, and no features are active.`;
  }

  return formSendBackMessage(msgSendBack);
}


/**
 * Enables a trading feature
 * Format: /enable {purpose} [params]
 * @see https://marketmaking.app/cex-mm/command-reference#enable-ob
 * @param {string[]} params Feature to enable and its params
 * @param {Object} tx Incoming command transaction
 * @param {boolean} [isWebApi=false] When `true`, formats the result message for the Web UI
 * @returns {Promise<CommandReply>}
 */
async function enable(params, tx, isWebApi = false) {
  let msgNotify; let msgSendBack; let infoString; let infoStringSendBack = ''; let featureString;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    let purpose = parsedParams?.more?.[0]?.param; // Feature purpose is broader than orderCollector.orderPurposes because not all features have their own order purpose

    if (parsedParams?.moduleIndex > 1) { // E.g., ld2
      purpose = parsedParams.purpose;
    }

    // Validate purpose

    const typeValidation = validateFeature(purpose, 'enable');

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${typeValidation.msgSendBack}`);
    }

    if (!typeValidation.featureExists) {
      return formSendBackMessage(typeValidation.msgSendBack);
    }

    if (typeValidation.moduleAvailable === false) {
      return formSendBackMessage(typeValidation.msgSendBack);
    }

    if (config.perpetual && !typeValidation.perpetual) {
      return formSendBackMessage(`The feature _${purpose}_ (${typeValidation.description}) is not available for perpetual contract trading.`);
    }

    const pair = config.defaultPair;
    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));
    const { coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;

    const pw = getPriceWatcherModule();

    if (purpose === 't') {
      const commandExample = `Try: */enable t optimal 1-10 ${coin1} 3-60 secs*`;

      const timeIntervalParam = parsedParams.getTimeInterval();
      const amountIntervalParam = parsedParams.getOtherInterval();
      const mmPolicyParam = parsedParams.getWhereIncluded(constants.MM_POLICIES);

      const mmPolicy = mmPolicyParam?.param;

      // Validate trading policy

      if (!/** @type {readonly string[]} */ (constants.MM_POLICIES).includes(mmPolicy)) {
        return formSendBackMessage(`Unknown volume trading policy: _${mmPolicy}_. Allowed policies: _${constants.MM_POLICIES.join(', ')}_. ${commandExample}.`);
      }

      // Validate trading time interval

      let minInterval;
      let maxInterval;
      let timeUnit;

      if (timeIntervalParam) {
        const interval = utils.parseRangeOrValue(timeIntervalParam.param);

        if (!interval.isRange) {
          return formSendBackMessage(`Unable to parse trading time interval: _${timeIntervalParam.param}_. ${commandExample}.`);
        }

        timeUnit = parsedParams.nextTo(timeIntervalParam.param)?.param;

        minInterval = interval.from;
        maxInterval = interval.to;
      }

      // Validate trading amounts

      let minAmount;
      let maxAmount;

      if (amountIntervalParam) {
        const interval = utils.parseRangeOrValue(amountIntervalParam.param);

        if (!interval.isRange) {
          return formSendBackMessage(`Unable to parse from–to trading amounts: _${amountIntervalParam.param}_. ${commandExample}.`);
        }

        const coinParam = parsedParams.nextTo(amountIntervalParam.param);

        if (coinParam?.paramUc !== coin1) {
          return formSendBackMessage(`Specify trading amounts in ${coin1}. ${commandExample}.`);
        }

        minAmount = interval.from;
        maxAmount = interval.to;

        const minAmountValidation = validateTraderMinAmount(minAmount, coin1, commandExample);
        if (minAmountValidation) {
          return minAmountValidation;
        }
      }

      // Save Trader parameters

      tradeParams.mm_minInterval = utils.getTimeInMs(minInterval, timeUnit) || tradeParams.mm_minInterval;
      tradeParams.mm_maxInterval = utils.getTimeInMs(maxInterval, timeUnit) || tradeParams.mm_maxInterval;

      tradeParams.mm_minAmount = minAmount ?? tradeParams.mm_minAmount;
      tradeParams.mm_maxAmount = maxAmount ?? tradeParams.mm_maxAmount;

      const obLimitParam = parsedParams['ob'];
      if (obLimitParam !== undefined) {
        const percentParsed = utils.parsePercent(obLimitParam, false);
        if (!percentParsed.parsed || !utils.isPositiveNumber(percentParsed.percent) || percentParsed.percent > 100) {
          return formSendBackMessage(
              `Set correct executeInOrderBook amount limit percent with _ob=50%_. ${commandExample}.`,
          );
        }
        tradeParams.mm_traderObLimitPercent = percentParsed.percent;
      }

      // If trading policy changed from depth, and the Price maker is active,
      // Restore the Price watcher parameters

      if (
        tradeParams.mm_isPriceMakerActive === true &&
        tradeParams.mm_Policy === 'depth' &&
        mmPolicy !== 'depth'
      ) {
        pw.restorePw(`User> Trading policy changed from depth to ${mmPolicy}`);
      }

      // Every successful /enable t starts a new external-fill VWAP epoch.
      // Nice Chart uses this timestamp to ignore t-fills from previous settings.
      tradeParams.mm_traderInitTs = Date.now();
      tradeParams.mm_isTraderActive = true;
      tradeParams.mm_Policy = mmPolicy;

      // Prepare informational message

      infoString = ` with the _${tradeParams.mm_Policy}_ policy`;

      const tradingVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

      infoStringSendBack = ` It trades _${tradeParams.mm_minAmount}–${tradeParams.mm_maxAmount}_ ${coin1}`;

      if (tradeParams.mm_traderObLimitPercent) {
        infoStringSendBack += ` with executeInOrderBook amount limit _${tradeParams.mm_traderObLimitPercent}%_`;
      }

      if (timeUnit) {
        infoStringSendBack += ` every _${minInterval}–${maxInterval}_ ${timeUnit}.`;
      } else {
        const minAmountInSec = Math.round(tradeParams.mm_minInterval / 1000);
        const maxAmountInSec = Math.round(tradeParams.mm_maxInterval / 1000);

        infoStringSendBack += ` every _${minAmountInSec}–${maxAmountInSec}_ secs.`;
      }

      const niceChartIntervalWarning = getNiceChartIntervalWarning();
      if (niceChartIntervalWarning) {
        infoStringSendBack += `\n\n${niceChartIntervalWarning}`;
      }

      infoStringSendBack += ` Estimated daily trading volume: ${exchangerUtils.getVolumeInfoString(tradingVolume)}.`;

      featureString = 'Volume trader';
    } else if (purpose === 'ob') {
      const commandExample = `Try: */enable ob 15 20%*`;

      let orderBookOrdersCount = +params[1];

      if (params[1] && !utils.isPositiveNumber(orderBookOrdersCount)) {
        return formSendBackMessage(`Set correct ob-order count. ${commandExample}`);
      }

      if (utils.isPositiveNumber(orderBookOrdersCount)) {
        tradeParams.mm_orderBookOrdersCount = orderBookOrdersCount;
      } else if (!tradeParams.mm_orderBookOrdersCount) {
        orderBookOrdersCount = constants.DEFAULT_ORDERBOOK_ORDERS_COUNT;
      }

      const maxOrderPercentParam = params[2];
      let maxOrderPercent;
      if (maxOrderPercentParam) {
        const percentSign = maxOrderPercentParam.slice(-1);
        maxOrderPercent = +maxOrderPercentParam.slice(0, -1);
        if (!utils.isPositiveNumber(maxOrderPercent) || percentSign !== '%') {
          return {
            msgNotify: '',
            msgSendBack: `Set correct max ob-order amount percent from the trading max order (currently _${tradeParams.mm_maxAmount.toFixed(coin1Decimals)} ${coin1}_). Example: */enable ob 15 20%*.`,
            notifyType: 'log',
          };
        }
      } else {
        maxOrderPercent = 100;
      }

      tradeParams.mm_isOrderBookActive = true;
      tradeParams.mm_orderBookMaxOrderPercent = maxOrderPercent;

      infoString = '';
      let infoStringPercent = '';
      featureString = 'Order book building';
      if (tradeParams.mm_orderBookMaxOrderPercent === 100) {
        infoStringPercent = ` and same max order amount as trading (currently _${tradeParams.mm_maxAmount.toFixed(coin1Decimals)} ${coin1}_)`;
      } else {
        const maxAgOrderAmount = tradeParams.mm_orderBookMaxOrderPercent * tradeParams.mm_maxAmount / 100;
        infoStringPercent = ` and max order amount of _${tradeParams.mm_orderBookMaxOrderPercent}%_ from trading max order, _~${maxAgOrderAmount.toFixed(coin1Decimals)} ${coin1}_ currently`;
      }
      infoString = ` with _${tradeParams.mm_orderBookOrdersCount}_ maximum number of orders${infoStringPercent}`;

    } else if (purpose === 'cl') {

      const cleanerPolicyParam = params[1];
      let cleanerPolicy;
      if (cleanerPolicyParam) {
        if (cleanerPolicyParam.toLowerCase() === 'minimumspread') cleanerPolicy = 'minimumSpread';
        if (cleanerPolicyParam.toLowerCase() === 'smallspread') cleanerPolicy = 'smallSpread';
        if (cleanerPolicyParam.toLowerCase() === 'preventcheating') cleanerPolicy = 'preventCheating';
        if (cleanerPolicyParam.toLowerCase() === 'takeall') cleanerPolicy = 'takeAll';
        if (!cleanerPolicy) {
          return {
            msgNotify: '',
            msgSendBack: 'Wrong policy option for order book cleaner. Choose between _minimumSpread_, _smallSpread_, _preventCheating_, _takeAll_.',
            notifyType: 'log',
          };
        }
      } else {
        cleanerPolicy = 'preventCheating';
      }
      tradeParams.mm_isCleanerActive = true;
      tradeParams.mm_cleanerPolicy = cleanerPolicy;
      infoString = ` with _${tradeParams.mm_cleanerPolicy}_ policy`;
      featureString = 'Order book cleaner';

    } else if (purpose === 'fb') { // end of purpose === "cl"

      tradeParams.mm_isFundBalancerActive = true;
      infoString = '';
      featureString = '2-keys fund balancer';

    } else if (purpose === 'be') {

      const beStrategyParam = params[1];
      let beStrategy;
      if (beStrategyParam) {
        if (beStrategyParam.toLowerCase() === 'bp') beStrategy = 'bp';
        if (beStrategyParam.toLowerCase() === 'market') beStrategy = 'market';
        if (!beStrategy) {
          return {
            msgNotify: '',
            msgSendBack: 'Wrong strategy option for balance equalizer. Choose between _pb_ (adjusting buyPercent), _market_ (buy/sell on market).',
            notifyType: 'log',
          };
        }
      } else {
        beStrategy = 'market';
      }

      infoString = ` with _${beStrategy}_ strategy`;

      const maxSlippagePercentParam = params[2];
      let maxSlippagePercent = tradeParams.mm_balanceEqualizerMaxSlippagePercent;

      if (beStrategy === 'market') {
        if (maxSlippagePercentParam) {
          const percentSign = maxSlippagePercentParam.slice(-1);
          maxSlippagePercent = +maxSlippagePercentParam.slice(0, -1);
          if (!utils.isPositiveNumber(maxSlippagePercent) || percentSign !== '%') {
            return {
              msgNotify: '',
              msgSendBack: 'Set the correct max slippage percent for the balance equalizer\'s market strategy. Example: */enable be market 2%*.',
              notifyType: 'log',
            };
          }
        } else {
          maxSlippagePercent = 1;
        }

        infoString += ` and ${maxSlippagePercent}% max order slippage`;
      }

      tradeParams.mm_isBalanceEqualizerActive = true;
      tradeParams.mm_balanceEqualizerStrategy = beStrategy;
      tradeParams.mm_balanceEqualizerMaxSlippagePercent = maxSlippagePercent;

      featureString = 'Balance equalizer';

    } else if (purpose === 'vc') {

      let vcRateParam = params[1]?.toLowerCase();
      if (['-y'].includes(vcRateParam)) vcRateParam = undefined;
      let vcRate;
      if (vcRateParam) {
        if (['modest', 'normal', 'dynamic'].includes(vcRateParam)) {
          vcRate = vcRateParam;
        } else {
          return {
            msgNotify: '',
            msgSendBack: `Wrong rate option '${params[1]}' for Volatility chart. Choose between _modest_, _normal_, _dynamic_.`,
            notifyType: 'log',
          };
        }
      } else {
        vcRate = 'normal';
      }

      if (tradeParams.mm_priceMakerInitiator === 'volatility chart' && vcRate !== tradeParams.mm_volatilityRate) {
        // Restart Price Maker, if mm_volatilityRate changed
        if (tradeParams.mm_isPriceMakerActive === true && tradeParams.mm_isTraderActive && tradeParams.mm_Policy === 'depth') {
          pw.restorePw('User> Price maker run by Volatility chart is stopped because of Vc\'s mm_volatilityRate changed');
        }
        tradeParams.mm_isPriceMakerActive = false;
      }
      tradeParams.mm_isVolatilityActive = true;
      tradeParams.mm_volatilityRate = vcRate;
      infoString = '';
      featureString = 'Volatility chart';
      infoString = ` with _${tradeParams.mm_volatilityRate}_ rate`;

    } else if (purpose === 'vv') {

      tradeParams.mm_isVolumeVolatilityActive = true;
      infoString = '';
      featureString = 'Volume volatility';

    } else if (purpose === 'sm') {

      tradeParams.mm_isSpreadMaintainerActive = true;
      infoString = '';
      featureString = 'Spread maintainer';

    } else if (purpose === 'ag') {

      const maxOrderPercentParam = params[1];
      let maxOrderPercent;
      if (maxOrderPercentParam) {
        const percentSign = maxOrderPercentParam.slice(-1);
        maxOrderPercent = +maxOrderPercentParam.slice(0, -1);
        if (!utils.isPositiveNumber(maxOrderPercent) || percentSign !== '%') {
          return {
            msgNotify: '',
            msgSendBack: `Set correct max ag-order amount percent from trading max order (currently _${tradeParams.mm_maxAmount.toFixed(coin1Decimals)} ${coin1}_). Example: */enable ag 20%*.`,
            notifyType: 'log',
          };
        }
      } else {
        maxOrderPercent = 100;
      }

      tradeParams.mm_isAntigapActive = true;
      tradeParams.mm_antigapMaxOrderPercent = maxOrderPercent;
      infoString = '';
      featureString = 'Order book antigap';

      if (tradeParams.mm_antigapMaxOrderPercent === 100) {
        infoString = ` with same max order amount as trading (currently _${tradeParams.mm_maxAmount.toFixed(coin1Decimals)} ${coin1}_)`;
      } else {
        const maxAgOrderAmount = tradeParams.mm_antigapMaxOrderPercent * tradeParams.mm_maxAmount / 100;
        infoString = ` with max order amount of _${tradeParams.mm_antigapMaxOrderPercent}%_ from trading max order, _~${maxAgOrderAmount.toFixed(coin1Decimals)} ${coin1}_ currently`;
      }

    } else if (purpose === 'pmv') {

      tradeParams.mm_isPriceChangeVolumeActive = true;
      infoString = '';
      featureString = 'Price maker and Price watcher volume';
      infoStringSendBack = ' I will make additional volume matching self orders, most of them are liq-orders.';
      infoStringSendBack += ' Amount of additional volume depends on liquidity set with _/enable liq_ command.';

    } else if (purpose === 'qh') {

      const DEFAULT_MAX_ORDER_PRICE_DUMP_PERCENT = 1.5; // Allow QH to dump less, than 2 percent per one qh-order
      const DEFAULT_MAX_HOUR_PRICE_DUMP_PERCENT = 1; // Allow QH to dump less, than 1 percent per hour. Price change by other means are not considered.
      const DEFAULT_MAX_DAY_PRICE_DUMP_PERCENT = 3; // Allow QH to dump less, than 3 percent per day. Price change by other means are not considered.
      const MAX_DUMP_PERCENT = 20;
      const DEFAULT_QH_POLICY = 'dump';

      /**
       * - dump: After placing taker sell-order at targetPrice, the bot places tight to targetPrice maker sell-order (ask)
       *   to make low spread. Potentially, this policy can dump a price. But with pumping Price maker, it will not.
       * - keep: After placing taker sell-order, the bot places tight to startPrice maker buy-order (bid) to make low spread.
       *   No price dumps, but with Liquidity/depth enabled, the bot will fill order book with bids, which other traders can take.
       *   To save profit, set main Liq/depth volume further from spread. e.g., `/enable liq 1.5–2% ..`
       *   when maxOrderDumpPercent set to 1.5% (default).
       * - none: Do nothing. There will be a bigger spread (hole) in the order book. If Liquidity/depth enabled, the bot will
       *   fill order book according to its settings to restore small spread.
       */
      const allowedQhPolicies = ['dump', 'keep', 'none'];

      let qhPolicy = DEFAULT_QH_POLICY;
      let maxOrderDumpPercent = DEFAULT_MAX_ORDER_PRICE_DUMP_PERCENT;
      let max1hDumpPercent = DEFAULT_MAX_HOUR_PRICE_DUMP_PERCENT;
      let max24hDumpPercent = DEFAULT_MAX_DAY_PRICE_DUMP_PERCENT;

      const maxOrderDumpPercentParam = params[1]?.toLowerCase();
      if (maxOrderDumpPercentParam) {
        if (allowedQhPolicies.includes(maxOrderDumpPercentParam)) {
          if (params[2] || params[5]) {
            return {
              msgNotify: '',
              msgSendBack: 'Quote hunter policy must be the last param. Example: */enable qh 2% 1% 3% dump* or */enable qh dump*.',
              notifyType: 'log',
            };
          }
        } else {
          // Set max allowed price dump percents
          // Per order
          let maxOrderDumpPercentSign = '%';
          maxOrderDumpPercentSign = maxOrderDumpPercentParam.slice(-1);
          maxOrderDumpPercent = +maxOrderDumpPercentParam.slice(0, -1);

          // Per 1h
          const max1hDumpPercentParam = params[2];
          let max1hDumpPercentSign = '%';
          if (max1hDumpPercentParam) {
            max1hDumpPercentSign = max1hDumpPercentParam.slice(-1);
            max1hDumpPercent = +max1hDumpPercentParam.slice(0, -1);
          }

          // Per 24h
          const max24hDumpPercentParam = params[3];
          let max24hDumpPercentSign = '%';
          if (max24hDumpPercentParam) {
            max24hDumpPercentSign = max24hDumpPercentParam.slice(-1);
            max24hDumpPercent = +max24hDumpPercentParam.slice(0, -1);
          }

          if (
            !params[2] || !params[3] ||
            !utils.isPositiveNumber(maxOrderDumpPercent) || maxOrderDumpPercentSign !== '%' ||
            !utils.isPositiveNumber(max1hDumpPercent) || max1hDumpPercentSign !== '%' ||
            !utils.isPositiveNumber(max24hDumpPercent) || max24hDumpPercentSign !== '%'
          ) {
            return {
              msgNotify: '',
              msgSendBack: 'Set correct max allowed price dump percents: per single order, per 1 hour, per 24 hours. Example: */enable qh 2% 1% 3% dump*.',
              notifyType: 'log',
            };
          }

          if (
            maxOrderDumpPercent > MAX_DUMP_PERCENT ||
            max1hDumpPercent > MAX_DUMP_PERCENT ||
            max24hDumpPercent > MAX_DUMP_PERCENT
          ) {
            return {
              msgNotify: '',
              msgSendBack: `Max allowed price dump percents should be less than ${MAX_DUMP_PERCENT}%. Example: */enable qh 2% 1% 3% dump*.`,
              notifyType: 'log',
            };
          }
        }
      }

      // Quote hunter policy
      const qhPolicyParam = params[4]?.toLowerCase() || params[1]?.toLowerCase();
      if (qhPolicyParam && allowedQhPolicies.includes(qhPolicyParam)) {
        qhPolicy = qhPolicyParam;
      }

      tradeParams.mm_isQuoteHunterActive = true;
      tradeParams.mm_quoteHunterPolicy = qhPolicy;
      tradeParams.mm_quoteHunterMaxOrderDumpPercent = maxOrderDumpPercent;
      tradeParams.mm_quoteHunterMax1hDumpPercent = max1hDumpPercent;
      tradeParams.mm_quoteHunterMax24hDumpPercent = max24hDumpPercent;
      infoString = '';
      featureString = 'Quote hunter';
      infoString = ` with _${qhPolicy}_ policy and max allowed price dump percents: _${maxOrderDumpPercent}%_ per single order,`;
      infoString += ` _${max1hDumpPercent}%_ per 1 hour, _${max24hDumpPercent}%_ per 24 hours`;

    } else if (purpose === 'liq') {
      // enable liq {DEPTH%} {BASE} {COIN1} {BASE} {COIN2} {trend} [ss]
      // OR: enable liq reset

      const maxDepth = 80;

      const hasLiquiditySafe = !!utils.softRequire('../../trade/mm_liquidity_safe');
      const hasLiquiditySs = !!utils.softRequire('../../trade/mm_liquidity_ss');

      const sampleDepth = hasLiquiditySafe ? '1-2%' : '2%';
      const sampleSs = hasLiquiditySs ? ' ss' : '';
      const sampleCommand = `Example: */enable liq ${sampleDepth} 10 ${coin1} 20 ${coin2} middle${sampleSs}*`;

      const isConfirmed = parsedParams.isConfirmed;

      // Reset sub-command: restart the current liquidity epoch, resetting VWAP stats for depth and ss

      if (parsedParams.is('reset')) {
        if (!tradeParams.mm_isLiquidityActive) {
          return formSendBackMessage(`Liquidity is not active, nothing to reset.`);
        }

        const depthResetString = tradeParams.mm_liquiditySpreadPercentMin ?
            `${tradeParams.mm_liquiditySpreadPercentMin}–${tradeParams.mm_liquiditySpreadPercent}%` :
            `${tradeParams.mm_liquiditySpreadPercent}%`;
        const ssResetInfo = tradeParams.mm_liquiditySpreadSupport && hasLiquiditySs ? ', *spread support*' : '';

        if (isConfirmed) {
          tradeParams.mm_liquidityInitTs = Date.now();
          await getFeatureModule('liq').resetLiqLimits('both sides', 'CommandTxs/ResetLiquidity');

          msgNotify = `${config.notifyName} reset Liquidity stats for ${pair} (${tradeParams.mm_liquiditySellAmount} ${coin1} asks and ${tradeParams.mm_liquidityBuyQuoteAmount} ${coin2} bids, depth ${depthResetString}${ssResetInfo}).`;
          msgSendBack = `Liquidity stats and VWAP are reset for ${pair} (_${tradeParams.mm_liquiditySellAmount} ${coin1}_ asks and _${tradeParams.mm_liquidityBuyQuoteAmount} ${coin2}_ bids, depth _${depthResetString}_${ssResetInfo}). Liquidity continues with the same parameters.`;

          if (!tradeParams.mm_isActive) {
            msgNotify += ` Note: Market-making is disabled.`;
            msgSendBack += ` Note: Market-making is disabled. To start market-making, type */start*.`;
          }

          return formSendBackAndNotify(msgSendBack, msgNotify);
        } else {
          setPendingConfirmation(`/enable ${params.join(' ')}`);

          msgSendBack = `Are you sure to reset Liquidity stats and VWAP for ${config.defaultPair} pair`;
          msgSendBack += ` (_${tradeParams.mm_liquiditySellAmount} ${coin1}_ asks and _${tradeParams.mm_liquidityBuyQuoteAmount} ${coin2}_ bids, depth _${depthResetString}_, trend _${tradeParams.mm_liquidityTrend}_${ssResetInfo})?`;
          msgSendBack += ` **This will restart the VWAP epoch for depth and spread support.** To view current liquidity stats, send the _/orders liq full_ command. Confirm with **/y** command or ignore.`;

          return formSendBackMessage(msgSendBack);
        }
      }

      // Parse ±depth%

      let depthPercentMin; let depthPercentMax;
      const depthString = parsedParams.percentString;
      const rangeOrValue = utils.parseRangeOrValue(depthString?.slice(0, -1));

      if (!rangeOrValue.isRange && !rangeOrValue.isValue) {
        return formSendBackMessage(`Set a valid ±depth% value. ${sampleCommand}.`);
      }

      if (rangeOrValue.value > maxDepth || rangeOrValue.from > maxDepth || rangeOrValue.to > maxDepth) {
        return formSendBackMessage(`Set the depth to less than ${maxDepth}%. ${sampleCommand}.`);
      }

      if (rangeOrValue.isRange && !hasLiquiditySafe) {
        return formSendBackMessage(`Depth range (e.g. _1-2%_) requires the Safe Liquidity module, which is not available in this build. ${sampleCommand}.`);
      }

      if (rangeOrValue.isValue) {
        depthPercentMin = 0;
        depthPercentMax = rangeOrValue.value;
      }

      if (rangeOrValue.isRange) {
        depthPercentMin = rangeOrValue.from;
        depthPercentMax = rangeOrValue.to;
      }

      // Parse liquidity amounts

      const coin1Param = parsedParams.moreByName(coin1);
      const coin2Param = parsedParams.moreByName(coin2);

      if (!coin1Param || !coin2Param) {
        return formSendBackMessage(`Specify liquidity amounts in the coins of the ${pair} trading pair. ${sampleCommand}.`);
      }

      const coin1AmountParam = parsedParams.prevTo(coin1);
      const coin2AmountParam = parsedParams.prevTo(coin2);
      const coin1Amount = coin1AmountParam?.paramNumber;
      const coin2Amount = coin2AmountParam?.paramNumber;

      if (!utils.isPositiveOrZeroNumber(coin1Amount) || !utils.isPositiveOrZeroNumber(coin2Amount)) {
        return formSendBackMessage(`Specify valid liquidity amounts in the coins of the ${pair} trading pair. ${sampleCommand}.`);
      }

      const minAmounts = orderUtils.getMinOrderAmount();

      if (coin1Amount < minAmounts.min) {
        return formSendBackMessage(`${coin1Amount} ${coin1} is below the minimum order amount of ${+minAmounts.minFixed} ${coin1} set by the exchange. ${sampleCommand}.`);
      }

      if (coin2Amount < minAmounts.minCoin2) {
        return formSendBackMessage(`${coin2Amount} ${coin2} is below the minimum order value of ${+minAmounts.minCoin2Fixed} ${coin2} set by the exchange. ${sampleCommand}.`);
      }

      // Parse spread support

      const ssParam = parsedParams.moreByName('ss');

      if (ssParam && !hasLiquiditySs) {
        return formSendBackMessage(`Spread support (_ss_) requires the Spread Support module, which is not available in this build. ${sampleCommand}.`);
      }

      const isSpreadSupport = ssParam ? true : false;

      // Parse liquidity trend

      const trendParam = parsedParams.getWhereIncluded(['middle', 'downtrend', 'uptrend']);
      const trend = trendParam?.param || 'middle';
      const trendDisplay = trend === 'middle' ? 'middle trend' : trend;

      const ssString = isSpreadSupport ? ' and *spread support*' : '';

      featureString = 'Liquidity and spread maintenance';
      infoString = ` with _${coin1Amount} ${coin1}_ asks (sell) and _${coin2Amount} ${coin2}_ bids (buy)`;
      infoString += ` within _${depthString}_ depth, using the _${trendDisplay}_${ssString}`;

      if (isConfirmed) {
        tradeParams.mm_isLiquidityActive = true;
        tradeParams.mm_liquidityInitTs = Date.now();

        tradeParams.mm_liquiditySpreadPercentMin = depthPercentMin;
        tradeParams.mm_liquiditySpreadPercent = depthPercentMax;

        tradeParams.mm_liquiditySellAmount = coin1Amount;
        tradeParams.mm_liquidityBuyQuoteAmount = coin2Amount;

        tradeParams.mm_liquidityTrend = trend;
        tradeParams.mm_liquiditySpreadSupport = isSpreadSupport;

        await getFeatureModule('liq').resetLiqLimits('both sides', 'CommandTxs/NewLiquiditySet');
      } else {
        setPendingConfirmation(`/enable ${params.join(' ')}`);

        msgNotify = '';
        msgSendBack = `Are you sure to enable ${featureString} for ${config.defaultPair} pair${infoString}? Confirm with **/y** command or ignore.`;

        return formSendBackMessage(msgSendBack);
      }

    } else if (purpose === 'sp') {

      const currentPrice = exchangerUtils.getRate(coin1, coin2) || 2.2;
      const referencePrice = utils.formatNumber(currentPrice * 0.5, false, coin2Decimals, coin2Decimals);
      const commandExample = `Try: */enable sp ${referencePrice} ${coin2}*`;

      // Parse amount threshold for order notifications

      const targetPriceParam = parsedParams.moreByIndex(1);
      const targetPrice = targetPriceParam?.paramNumber;
      if (!utils.isPositiveNumber(targetPrice)) {
        return formSendBackMessage(`Invalid ${pair} support price: ${targetPriceParam?.param}. ${commandExample}.`);
      }

      const coinParam = parsedParams.nextTo(targetPriceParam.param);
      const coin = coinParam?.paramUc;
      if (coin !== coin2) {
        return formSendBackMessage(`Set the support price in ${coin2}. ${commandExample}.`);
      }

      featureString = 'Support price';
      infoString = ` at _${targetPrice} ${coin2}_`;

      const isConfirmed = parsedParams.isConfirmed;

      let pwNoteString;
      if (tradeParams.mm_isPriceWatcherActive) {
        pwNoteString = ` **Note**: Price watcher is enabled ${pw.getPwInfoString()}.`;
      } else {
        pwNoteString = '';
      }

      let spChangeStringPercent = '';
      let fromString = '';

      if (tradeParams.mm_priceSupportLowPrice) {
        const spChangePercent = utils.numbersDifferencePercentDirect(tradeParams.mm_priceSupportLowPrice, targetPrice);
        spChangeStringPercent = utils.formatPercent(spChangePercent, 2);
        fromString = ` (previously ${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${coin2}, ${spChangeStringPercent})`;
      }

      const spChangeString = `support price to *${targetPrice} ${coin2}*${fromString} for the ${pair} pair on ${config.exchangeName} exchange`;

      if (isConfirmed) {
        pw.setIsPriceActual(false, '/enable sp');
        tradeParams.mm_priceSupportLowPrice = targetPrice;
      } else {
        let priceInfoString = getCoinRatesInfo(coin1).ratesString;
        const exchangeRatesInfo = await getExchangeRatesInfo(pair);
        priceInfoString += '\n\n' + exchangeRatesInfo.ratesString;

        setPendingConfirmation(`/enable ${params.join(' ')}`);

        msgSendBack = `Are you sure to enable ${spChangeString}?${pwNoteString} Confirm with **/y** command or ignore.\n\n${priceInfoString}`;

        return formSendBackMessage(msgSendBack);
      }

    } else if (purpose === 'bw') {

      const balancesCmd = await balances(['allcoins'], tx);
      const balanceInfoString = balancesCmd.msgSendBack;

      if (balanceInfoString.includes('Unable to retrieve') || !balanceInfoString.includes('Total')) {
        return formSendBackMessage(`Failed to obtain reference balances required to activate the Balance Watcher.\n\n${balanceInfoString}`);
      }

      let priceInfoString = getCoinRatesInfo(formattedPair.coin1).ratesString;
      const exchangeRatesInfo = await getExchangeRatesInfo(formattedPair.pair);
      priceInfoString += '\n\n' + exchangeRatesInfo.ratesString;

      tradeParams.mm_isBalanceWatcherActive = true;

      // Store reference balances for the Balance Watcher
      // Date.now() is not the same as the balances fetch timestamp, but it works because comparisons use the snapshot taken before the given timestamp
      tradeParams.mm_balanceWatcherReferenceTs = Date.now();

      infoString = ` with current balances stored as the reference`;
      featureString = 'Balance watcher';
      infoStringSendBack = `\n\n${balanceInfoString}\n\n${priceInfoString}`;

    } else if (purpose === 'pw') {

      const generalExample = 'Example: */enable pw 0.1—0.2 USDT* or */enable pw ADM/USDT@Azbit 0.5% smart prevent*.';

      const pwSourceInput = params[1];
      if (!pwSourceInput) {
        return {
          msgNotify: '',
          msgSendBack: `Wrong parameters. ${generalExample}`,
          errorField: 'source',
          notifyType: 'log',
        };
      }

      let rangeOrValue; let coin;
      let exchange; let exchangeName; let pair;
      let pairObj;
      let percentString; let percentValue;

      let pwLowPrice; let pwHighPrice; let pwMidPrice; let pwDeviationPercent; let pwSource; let pwSourcePolicy; let pwAction;

      if (params[1].indexOf('@') > -1) {
        // Watch pair@exchange

        const pairExchangeExample = 'Example: */enable pw ADM/USDT@Azbit 0.5% smart prevent*.';

        [pair, exchange] = params[1].split('@');

        if (!pair || pair.length < 3 || pair.indexOf('/') === -1 || !exchange || exchange.length < 3) {
          return {
            msgNotify: '',
            isError: true,
            errorField: 'source',
            msgSendBack: isWebApi ? `Trading pair ${pair.toUpperCase()} is not valid` : `Wrong price source. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }

        config.exchanges.forEach((e) => {
          if (e.toLowerCase() === exchange.toLowerCase()) {
            exchangeName = e;
          }
        });

        if (!exchangeName) {
          return {
            msgNotify: '',
            isError: true,
            errorField: 'source',
            msgSendBack: isWebApi ? `Unknown exchange: ${exchange}` : `I don't support ${exchange} exchange. Supported exchanges: ${config.supported_exchanges}. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }

        // Parse 'pair' string to market pair object, { pair, coin1, coin2 }
        // In case of external exchange, start loading getMarkets(). Do not connect to socket at this stage.
        pairObj = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair, exchangeName, true));
        if (!pairObj) {
          return {
            msgNotify: '',
            isError: true,
            errorField: 'source',
            msgSendBack: isWebApi ? `Trading pair ${pair.toUpperCase()} is not valid` : `Trading pair ${pair.toUpperCase()} is not valid. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }

        if (pairObj.coin1 !== config.coin1) {
          return {
            msgNotify: '',
            isError: true,
            errorField: 'source',
            msgSendBack: isWebApi ? `Base currency of a trading pair must be ${config.coin1}` : `Base currency of a trading pair must be ${config.coin1}, like ${config.coin1}/USDT.`,
            notifyType: 'log',
          };
        }

        if (
          pairObj.pair.toUpperCase() === config.defaultPair.toUpperCase() &&
          exchange.toLowerCase() === config.exchange.toLowerCase()
        ) {
          return {
            msgNotify: '',
            isError: true,
            errorField: 'source',
            msgSendBack: isWebApi ? `Unable to set Price watcher to the same trading pair as I trade, ${pairObj.pair}@${exchangeName}` : `Unable to set Price watcher to the same trading pair as I trade, ${pairObj.pair}@${exchangeName}. Set price in numbers or watch other trading pair/exchange. ${generalExample}`,
            notifyType: 'log',
          };
        }

        // Test if we can retrieve order book for the specific pair on the exchange
        let orderBook;
        if (exchange.toLowerCase() === config.exchange) {
          orderBook = await orderUtils.getOrderBookCached(pairObj.pair, moduleName);
        } else {
          if (!pairObj.exchangeApi.markets) {
            // We already created pairObj.exchangeApi when orderUtils.parseMarket(), but markets are probably still loading
            const pauseMs = 4000;
            await utils.pauseAsync(pauseMs, `${pauseMs} msec pause to ensure the ${exchangeName} loaded markets…`);
          }

          orderBook = await pairObj.exchangeApi.getOrderBook(pairObj.pair);
        }

        if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
          const noOrderBookInfo = `Unable to receive an order book for ${pairObj.pair} at ${exchangeName} exchange.`;
          log.warn(`commandTxs/enable: ${noOrderBookInfo}`);

          return {
            msgNotify: '',
            isError: true,
            errorField: 'source',
            msgSendBack: isWebApi ? noOrderBookInfo : `${noOrderBookInfo} Check if you've specified the trading pair correctly; Or it may be a temporary API error.`,
            notifyType: 'log',
          };
        }

        pwSource = `${pairObj.pair}@${exchangeName}`;

        // Validate deviation percent
        percentString = params[2];
        if (!percentString || (percentString.slice(-1) !== '%')) {
          return {
            msgNotify: '',
            msgSendBack: `Set a deviation in percentage. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }
        percentValue = +percentString.slice(0, -1);
        if (percentValue === Infinity || percentValue < 0 || percentValue > 90) {
          return {
            msgNotify: '',
            msgSendBack: `Set correct deviation in percentage. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }
        pwDeviationPercent = percentValue;

        // Validate deviation percent policy
        pwSourcePolicy = params[3];
        pwSourcePolicy = pwSourcePolicy?.toLowerCase();
        if (!['smart', 'strict'].includes(pwSourcePolicy)) {
          return {
            msgNotify: '',
            msgSendBack: `Wrong deviation policy. Allowed _smart_ or _strict_. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }

        // Validate action
        pwAction = params[4];
        pwAction = pwAction?.toLowerCase();
        if (!['fill', 'prevent'].includes(pwAction)) {
          return {
            msgNotify: '',
            msgSendBack: `Wrong Pw action. Allowed _fill_ or _prevent_. ${pairExchangeExample}`,
            notifyType: 'log',
          };
        }

        pwLowPrice = 0;
        pwHighPrice = 0;
        pwMidPrice = 0;

        infoString = ` based on _${pwSource}_ with _${pwSourcePolicy}_ policy, _${pwDeviationPercent.toFixed(2)}%_ deviation and _${pwAction}_ action`;

      } else {
        // Watch price in coin
        const rangeOrValueExample = 'Example: */enable pw 0.1—0.2 USDT fill* or */enable pw 0.5 USDT 1% fill*.';
        const valueExample = 'Example: */enable pw 0.5 USDT 1% fill*.';

        rangeOrValue = utils.parseRangeOrValue(params[1]);
        if (!rangeOrValue.isRange && !rangeOrValue.isValue) {
          return {
            msgNotify: '',
            msgSendBack: isWebApi ? 'Set correct source' : `Set a price range or value. ${rangeOrValueExample}`,
            notifyType: 'log',
            isError: true,
            errorField: 'source',
          };
        }

        coin = params[2];
        if (!coin || !coin.length || coin.toUpperCase() === config.coin1) {
          return {
            msgNotify: '',
            msgSendBack: isWebApi ? 'Incorrect currency' : `Incorrect currency. ${rangeOrValueExample}`,
            notifyType: 'log',
            errorField: 'currency',
            isError: true,
          };
        }
        coin = coin.toUpperCase();

        if (!exchangerUtils.hasTicker(coin)) {
          return {
            msgNotify: '',
            msgSendBack: isWebApi ? 'Incorrect currency' : `I don't know currency ${coin}. ${rangeOrValueExample}`,
            notifyType: 'log',
            errorField: 'currency',
            isError: true,
          };
        }

        let pwActionParam;

        if (rangeOrValue.isRange) {
          pwLowPrice = rangeOrValue.from;
          pwHighPrice = rangeOrValue.to;
          pwMidPrice = (pwLowPrice + pwHighPrice) / 2;
          pwDeviationPercent = (pwHighPrice - pwLowPrice) / 2 / pwMidPrice * 100;
          pwSource = coin;
          pwActionParam = params[3];
        }

        if (rangeOrValue.isValue) {
          percentString = params[3];

          if (!percentString || (percentString.slice(-1) !== '%')) {
            return {
              msgNotify: '',
              msgSendBack: `Set a deviation in percentage. ${valueExample}`,
              notifyType: 'log',
            };
          }

          percentValue = +percentString.slice(0, -1);
          if (!percentValue || percentValue === Infinity || percentValue <= 0 || percentValue > 90) {
            return {
              msgNotify: '',
              msgSendBack: `Set correct deviation in percentage. ${valueExample}`,
              notifyType: 'log',
            };
          }

          pwLowPrice = rangeOrValue.value * (1 - percentValue/100);
          pwHighPrice = rangeOrValue.value * (1 + percentValue/100);
          pwMidPrice = rangeOrValue.value;
          pwDeviationPercent = percentValue;
          pwSource = coin;
          pwActionParam = params[4];
        }

        let convertedString;
        let sourceString;
        let pwLowPriceInCoin2;
        let marketDecimals;

        if (coin === config.coin2) {
          pwLowPriceInCoin2 = pwLowPrice;
          sourceString = `${coin}`;
          convertedString = '';
          marketDecimals = coin2Decimals;
        } else {
          pwLowPriceInCoin2 = exchangerUtils.convertCryptos(coin, config.coin2, pwLowPrice).outAmount;
          sourceString = `${coin} (global rate)`;
          convertedString = ` (${pwLowPrice} converted to ${config.coin2})`;
          marketDecimals = 8;
        }

        if (!utils.isPositiveNumber(pwLowPriceInCoin2)) {
          return {
            msgNotify: '',
            msgSendBack: `Unable to convert ${coin} to ${config.coin2}. ${rangeOrValueExample}`,
            notifyType: 'log',
          };
        }

        // Validate action
        pwAction = pwActionParam?.toLowerCase();
        if (!['fill', 'prevent'].includes(pwAction)) {
          return {
            msgNotify: '',
            msgSendBack: `Wrong Pw action. Allowed _fill_ or _prevent_. ${rangeOrValueExample}`,
            notifyType: 'log',
          };
        }

        if (tradeParams.mm_priceSupportLowPrice > pwLowPriceInCoin2) {
          return {
            msgNotify: '',
            msgSendBack: `Support price ${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${config.coin2} is greater, than Price watcher's lower bound of ${pwLowPriceInCoin2.toFixed(coin2Decimals)} ${coin}${convertedString}. Update support price with */enable sp* command, or set suitable Price watcher's range.`,
            notifyType: 'log',
          };
        }

        infoString = ` from ${pwLowPrice.toFixed(marketDecimals)} to ${pwHighPrice.toFixed(marketDecimals)} ${sourceString}—${pwDeviationPercent.toFixed(2)}% price deviation and _${pwAction}_ action`;
      }

      featureString = 'Price watching';

      const isConfirmed = parsedParams.isConfirmed;

      const spNoteString = tradeParams.mm_priceSupportLowPrice ? `. *Note*: Support price is set to ${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${config.coin2}` : '';

      if (isConfirmed) {
        /**
         * Stop Price maker. Technically, we can check if current or target price is out of new Price Watcher's range,
         * But it's complicated because we should get current rates, convert source coin to quote coin,
         * Or get rate from pair@exchange source.
         * Also, with 'depth' mm_Policy, Price maker manipulates pw range
         * If Volatility chart is enabled, Price maker will be restarted automatically with a new range.
         */
        if (tradeParams.mm_isPriceMakerActive) {
          tradeParams.mm_isPriceMakerActive = false;
          if (tradeParams.mm_priceMakerInitiator === 'user') {
            infoString += `. Note: Price maker with target price ${tradeParams.mm_priceMakerTargetPrice} ${config.coin2} initiated by user is stopped`;
            infoStringSendBack = ' You can restart it with **/make price** command.';
          }
        }

        infoString += spNoteString;

        pw.setIsPriceActual(false, '/enable pw');

        tradeParams.mm_isPriceWatcherActive = true;
        tradeParams.mm_priceWatcherLowPriceInSourceCoin = pwLowPrice;
        tradeParams.mm_priceWatcherMidPriceInSourceCoin = pwMidPrice;
        tradeParams.mm_priceWatcherHighPriceInSourceCoin = pwHighPrice;
        tradeParams.mm_priceWatcherDeviationPercent = pwDeviationPercent;
        tradeParams.mm_priceWatcherSource = pwSource;
        tradeParams.mm_priceWatcherSourcePolicy = pwSourcePolicy;
        tradeParams.mm_priceWatcherAction = pwAction;

        pw.savePw('User> Price watcher enabled with /enable pw');
      } else {
        let priceInfoString = getCoinRatesInfo(formattedPair.coin1).ratesString;

        const exchangeRatesInfo = await getExchangeRatesInfo(formattedPair.pair);
        priceInfoString += '\n\n' + exchangeRatesInfo.ratesString;

        setPendingConfirmation(`/enable ${params.join(' ')}`);

        msgNotify = '';
        const spNoteStringDots = spNoteString ? utils.trimAny(spNoteString, '.') + '.' : '';
        msgSendBack = `Are you sure to enable ${featureString} for ${config.defaultPair} pair${infoString}?${spNoteStringDots} Confirm with **/y** command or ignore.\n\n${priceInfoString}`;

        return {
          msgNotify,
          msgSendBack,
          notifyType: 'log',
        };
      }

    } else if (purpose === 'ld') { // end of purpose === "pw"
      // enable ld2 {AMOUNT} {COIN} {COUNT} {step=STEP%} [mid {MIDPRICE} COIN2] [recheck=2min] [gain=5] [sa=10%] [ba=5%] [aa] [spa=15% [stopLd2At=60%]

      const ldNo = parsedParams.moduleIndexString;
      const ldInstance = getFeatureModule('ld')(ldNo);

      let midPriceCalculated;

      let ratesInfo;

      const exchangeRates = await traderapi.getRates(pair);
      if (exchangeRates?.ask) {
        const delta = exchangeRates.ask-exchangeRates.bid;
        midPriceCalculated = (exchangeRates.ask+exchangeRates.bid)/2;
        midPriceCalculated = +midPriceCalculated.toFixed(coin2Decimals);
        const deltaPercent = delta/midPriceCalculated * 100;
        ratesInfo = `\n\n${config.exchangeName} rates for ${pair} pair:\nBid: ${exchangeRates.bid.toFixed(coin2Decimals)}, ask: ${exchangeRates.ask.toFixed(coin2Decimals)}, spread: _${(delta).toFixed(coin2Decimals)}_ ${coin2} (${(deltaPercent).toFixed(2)}%)`;
      } else {
        return formSendBackMessage(`Unable to get ${config.exchangeName} rates for ${pair}. Try later.`);
      }

      const isConfirmed = parsedParams.isConfirmed;

      // Reactivate paused ladder

      const sampleResumeCommand = `Example: */enable ld${ldNo} resume*.${ratesInfo}`;

      if (parsedParams.is('resume')) {
        if (parsedParams.paramCountWoMarkers !== 2) {
          return formSendBackMessage(`To resume ladder${ldNo}, remove all other params. ${sampleResumeCommand}.`);
        }

        if (!tradeParams[`mm_isLadderPaused${ldNo}`] || !tradeParams[`mm_isLadderActive${ldNo}`]) {
          return formSendBackMessage(`You can resume ladder${ldNo} only when it's active and was paused earlier.`);
        }

        if (isConfirmed) {
          ldInstance.resumeLadder('User command');
        } else {
          setPendingConfirmation(`/enable ${params.join(' ')}`);

          msgNotify = '';
          msgSendBack = `Are you sure to resume ladder${ldNo} for ${config.defaultPair} pair,`;
          msgSendBack += ` previously paused by _${tradeParams['mm_ladderPauseReason' + ldNo]}_ ${utils.timeAgoString(tradeParams['mm_ladderPauseTs' + ldNo])}?`;
          msgSendBack += ' **It will use the same parameters as before pausing (check with _/params_). Verify that market conditions haven’t changed**.';
          msgSendBack += ` Confirm with **/y** command or ignore.${ratesInfo}`;

          return formSendBackMessage(msgSendBack);
        }

        msgNotify = `${config.notifyName} resumed ladder${ldNo} for ${pair}.`;
        msgSendBack = `Ladder${ldNo} is resumed for ${pair}.`;

        if (!tradeParams.mm_isActive) {
          msgNotify += ` Note: Market-making is disabled.`;
          msgSendBack += ` Note: Market-making is disabled. To start market-making and ladder${ldNo}, type */start*.`;
        }

        return formSendBackAndNotify(msgSendBack, msgNotify);
      }

      // Parse basic ladder params

      const sampleCommand = `Example: */enable ld${ldNo} 100 ${coin2} 10 step=2%*.${ratesInfo}`;

      if (parsedParams.paramCount < 5) {
        return formSendBackMessage(`Not enough parameters to enable ladder${ldNo}. ${sampleCommand}.`);
      }

      const amountCoin = parsedParams.more[2].paramUc;
      if (amountCoin !== coin1 && amountCoin !== coin2) {
        return formSendBackMessage(`Set either an order amount in ${coin1} or an order volume in ${coin2}. ${sampleCommand}.`);
      }

      const amountOrVolume = amountCoin === coin1 ? 'amount' : 'volume';

      const amount = +parsedParams.more[1].param;
      if (!utils.isPositiveNumber(amount)) {
        return formSendBackMessage(`Incorrect order ${amountOrVolume}: ${amount}. ${sampleCommand}.`);
      }

      const orderCount = +parsedParams.more[3].param;
      if (!utils.isPositiveInteger(orderCount)) {
        return formSendBackMessage(`Set correct ld${ldNo}-order count (each side). ${sampleCommand}.`);
      }

      const stepPercentParam = parsedParams['step'];
      const stepPercent = utils.parsePercent(stepPercentParam, false)?.percent;
      if (!stepPercent) {
        return formSendBackMessage(`Specify correct ladder${ldNo} price step percent. ${sampleCommand}.`);
      }

      // Parse additional ladder params

      let sampleCommandFull = `Example: */enable ld${ldNo} 100 ${coin2} 10 step=2%`;
      sampleCommandFull += ` mid=${midPriceCalculated.toFixed(coin2Decimals)} ${coin2}`;
      sampleCommandFull += ` recheck=2min gain=5 sa=10% aa spa=10% stopLd2At=60%*`;
      sampleCommandFull += `.${ratesInfo}`;

      let midPrice;
      const customMidPrice = parsedParams['mid'];

      if (customMidPrice !== undefined) {
        if (!utils.isPositiveNumber(+customMidPrice)) {
          return formSendBackMessage(`Incorrect middle ladder${ldNo} price: ${customMidPrice}. ${sampleCommandFull}.`);
        }

        midPrice = +customMidPrice;

        const midPriceCoin = parsedParams.nextTo('mid')?.paramUc;
        if (midPriceCoin !== config.coin2) {
          return formSendBackMessage(`Set a middle ladder${ldNo} price in ${config.coin2}. ${sampleCommandFull}.`);
        }
      } else {
        midPrice = midPriceCalculated;
      }

      // Recheck ladder interval

      const defaultIntervalMs = getFeatureModule('ld').DEFAULT_LADDER_INTERVAL;
      const customRecheckInterval = parsedParams['recheck'];
      let recheckIntervalParsed;

      if (customRecheckInterval) {
        recheckIntervalParsed = utils.parseSmartTime(customRecheckInterval);

        if (!recheckIntervalParsed.isTime) {
          return formSendBackMessage(`Incorrect recheck interval for ladder${ldNo}: ${customRecheckInterval}. ${sampleCommandFull}.`);
        }
      }

      const recheckIntervalMs = recheckIntervalParsed?.msecs || defaultIntervalMs;
      const recheckIntervalSmart = customRecheckInterval || `${Math.round(recheckIntervalMs / 1000)}sec`;

      let amountGain = 0; // Increase amount each ladder step. All ladder orders are the same by default.
      let amountGainString = '';
      const customAmountGain = parsedParams['gain'];

      if (customAmountGain !== undefined) {
        if (!utils.isPositiveNumber(+customAmountGain)) {
          return formSendBackMessage(`Incorrect ladder${ldNo} gain ${amountOrVolume}: ${customAmountGain}. ${sampleCommandFull}.`);
        }

        amountGain = +customAmountGain;
        amountGainString = ` (gained by ${customAmountGain} ${amountCoin})`;
      }

      let stopLd2At = false; // It stops Ladder2 and notify if X or Y% of one-side ld1-orders are filled at once (single check)
      let stopLd2AtOrderCount = 0;
      let stopLd2AtFilledPercent = 0; // One of these will be not zero
      let stopLd2AtString = '';

      const stopLd2AtParam = parsedParams['stopld2at'];

      if (stopLd2AtParam !== undefined) {
        const isNumber = utils.isPositiveInteger(+stopLd2AtParam);
        const percentParsed = utils.parsePercent(stopLd2AtParam, false);

        if (!isNumber && !percentParsed.parsed) {
          return formSendBackMessage(`Incorrect ladder${ldNo} stopLd2At param: ${stopLd2AtParam}. Specify order count or percent of filled orders. ${sampleCommandFull}.`);
        } else if (isNumber) {
          stopLd2AtOrderCount = +stopLd2AtParam;
          stopLd2AtFilledPercent = 0;

          stopLd2AtString = `when ${stopLd2AtOrderCount} ld1-orders are filled`;
        } else {
          stopLd2AtOrderCount = 0;
          stopLd2AtFilledPercent = percentParsed.percent;

          stopLd2AtString = `when ${stopLd2AtFilledPercent}% ld1-orders are filled`;
        }

        stopLd2At = true;
      }

      // Adds optional one-side **amount** adjustments to the ladder/grid strategy
      // It allows increasing only sell or only buy order amounts by a percentage

      let sellAmountAdjPercent = 0;
      let buyAmountAdjPercent = 0;
      const amountAdjStrings = [];

      const saParam = parsedParams['sa'];
      const baParam = parsedParams['ba'];

      if (saParam !== undefined) {
        const percentParsed = utils.parsePercent(saParam, false);

        if (!percentParsed.parsed) {
          return formSendBackMessage(`Incorrect ladder${ldNo} sell orders **${amountOrVolume} adjustment**: ${saParam}. Specify the percentage to increase all sell order ${amountOrVolume}s. ${sampleCommandFull}.`);
        }

        sellAmountAdjPercent = percentParsed.percent;

        amountAdjStrings.push(`+${sellAmountAdjPercent}% sell-side ${amountOrVolume}`);
      }

      if (baParam !== undefined) {
        const percentParsed = utils.parsePercent(baParam, false);

        if (!percentParsed.parsed) {
          return formSendBackMessage(`Incorrect ladder${ldNo} buy orders **${amountOrVolume} adjustment**: ${baParam}. Specify the percentage to increase all buy order ${amountOrVolume}s. ${sampleCommandFull}.`);
        }

        buyAmountAdjPercent = percentParsed.percent;

        amountAdjStrings.push(`+${buyAmountAdjPercent}% buy-side ${amountOrVolume}`);
      }

      const amountAdjString = amountAdjStrings.length ? ` **_${amountAdjStrings.join(' and ')}_ adjustment**` : '';

      // Adds optional one-side **price* adjustments to the ladder/grid strategy
      // It allows shifting only sell or only buy orders by a percentage

      let sellPriceAdjPercent = 0;
      let buyPriceAdjPercent = 0;
      const priceAdjStrings = [];

      const spaParam = parsedParams['spa'];
      const bpaParam = parsedParams['bpa'];

      if (spaParam !== undefined) {
        const percentParsed = utils.parsePercent(spaParam, false);

        if (!percentParsed.parsed) {
          return formSendBackMessage(`Incorrect ladder${ldNo} sell **price adjustment**: ${spaParam}. Specify the percentage to shift all sell orders upward. ${sampleCommandFull}.`);
        }

        sellPriceAdjPercent = percentParsed.percent;

        priceAdjStrings.push(`+${sellPriceAdjPercent}% sell-orders`);
      }

      if (bpaParam !== undefined) {
        const percentParsed = utils.parsePercent(bpaParam, false);

        if (!percentParsed.parsed) {
          return formSendBackMessage(`Incorrect ladder${ldNo} buy **price adjustment**: ${bpaParam}. Specify the percentage to shift all buy orders downward. ${sampleCommandFull}.`);
        }

        buyPriceAdjPercent = percentParsed.percent;

        priceAdjStrings.push(`−${buyPriceAdjPercent}% buy-orders`);
      }

      // The aa (Auto Amount Adjust) option automatically adjusts order amounts,
      // Based on the account balance at the moment when new ladder orders are placed

      const aaParam = parsedParams.moreByName('aa');
      const autoAmountAdj = !!aaParam;

      // Confirm command

      featureString = `Ladder${ldNo}`;

      infoString = ` with ${orderCount} orders on each side with **${stepPercent}%** price step`;
      infoString += ` and ~${amount} ${amountCoin}${amountGainString} order ${amountOrVolume}${amountAdjString},`;
      infoString += autoAmountAdj ? ` with **auto ${amountOrVolume} adjustment**,` : '';
      infoString += priceAdjStrings.length ? ` with _${priceAdjStrings.join(' and ')}_ **price adjustment**,` : '';
      infoString += ` starting from the middle of ${midPrice} ${config.coin2}`;
      infoString += `, recheck interval ${recheckIntervalSmart}`;
      infoString += stopLd2AtString ? `, and Ladder2 stops ${stopLd2AtString}` : '';

      if (isConfirmed) {
        tradeParams[`mm_ladderReInit${ldNo}`] = true;
        tradeParams[`mm_isLadderActive${ldNo}`] = true;
        tradeParams[`mm_isLadderPaused${ldNo}`] = false;
        tradeParams[`mm_ladderInitTs${ldNo}`] = Date.now();

        tradeParams[`mm_ladderAmount${ldNo}`] = amount;
        tradeParams[`mm_ladderAmountCoin${ldNo}`] = amountCoin;
        tradeParams[`mm_ladderCount${ldNo}`] = orderCount;
        tradeParams[`mm_ladderPriceStepPercent${ldNo}`] = stepPercent;
        tradeParams[`mm_ladderMidPrice${ldNo}`] = midPrice;
        tradeParams[`mm_ladderMidPriceType${ldNo}`] = customMidPrice ? 'Manual' : 'Calculated';

        tradeParams[`mm_ladderRecheckIntervalMs${ldNo}`] = recheckIntervalMs;
        tradeParams[`mm_ladderRecheckIntervalSmart${ldNo}`] = recheckIntervalSmart;

        tradeParams[`mm_ladderSellAmountAdjPercent${ldNo}`] = sellAmountAdjPercent;
        tradeParams[`mm_ladderBuyAmountAdjPercent${ldNo}`] = buyAmountAdjPercent;

        tradeParams[`mm_ladderSellPriceAdjPercent${ldNo}`] = sellPriceAdjPercent;
        tradeParams[`mm_ladderBuyPriceAdjPercent${ldNo}`] = buyPriceAdjPercent;

        tradeParams[`mm_ladderAmountGain${ldNo}`] = amountGain;
        tradeParams[`mm_ladderAutoAmountAdj${ldNo}`] = autoAmountAdj;

        tradeParams[`mm_ladderStopLd2At`] = stopLd2At;
        tradeParams[`mm_ladderStopLd2AtOrderCount`] = stopLd2AtOrderCount;
        tradeParams[`mm_ladderStopLd2AtFilledPercent`] = stopLd2AtFilledPercent;
      } else {
        setPendingConfirmation(`/enable ${params.join(' ')}`);

        const reInitWarn = tradeParams.mm_isLadderActive ? ` Current ladder${ldNo} will be re-initialized.` : '';

        msgNotify = '';
        msgSendBack = `Are you sure to enable ${featureString} for ${config.defaultPair} pair${infoString}?${reInitWarn} Confirm with **/y** command or ignore.${ratesInfo}`;

        return formSendBackMessage(msgSendBack);
      }

    } else if (purpose === 'on') { // end of purpose === "ld"
      const commandExample = `Try: */enable on 1k USDT priority=2k*`;

      // Parse amount threshold for order notifications

      const amountParam = parsedParams.moreByIndex(1);
      if (!amountParam?.paramSmartNumber?.isNumber) {
        return formSendBackMessage(`Invalid amount threshold for placed order monitoring: ${amountParam?.param}. ${commandExample}.`);
      }

      const amount = amountParam.paramSmartNumber.number;
      const amountSmart = amountParam.paramSmartNumber.fancyNumberString;

      const coinParam = parsedParams.nextTo(amountParam.param);
      const coin = coinParam?.paramUc;
      if (!coin) {
        return formSendBackMessage(`Incorrect coin to calculate ${coin1} amount for placed order monitoring: ${coin}. ${commandExample}.`);
      }

      let coin1Amount = amount;
      let amountString = amountSmart;

      if (coin !== coin1) {
        coin1Amount = exchangerUtils.convertCryptos(coin, coin1, amount).outAmount;
        if (!utils.isPositiveNumber(coin1Amount)) {
          return formSendBackMessage(`Unable to calculate ${amount} ${coin} to ${coin1} amount for placed order monitoring. ${commandExample}.`);
        }

        amountString = utils.toFixedMeaningful(coin1Amount, coin1Decimals);
      }

      // Parse priority amount threshold for order priority notifications

      let priorityAmount = 0;
      let coin1PriorityAmount = 0;
      let priorityAmountString;

      const priorityAmountParam = parsedParams.priority;
      if (priorityAmountParam !== undefined) {
        const priorityAmountSmart = utils.parsePositiveSmartNumber(priorityAmountParam);

        if (!priorityAmountSmart.isNumber) {
          return formSendBackMessage(`Invalid priority amount threshold for placed order monitoring: ${priorityAmountParam || undefined}. ${commandExample}.`);
        }

        priorityAmount = priorityAmountSmart.number;
        priorityAmountString = priorityAmountParam;

        if (coin !== coin1) {
          coin1PriorityAmount = exchangerUtils.convertCryptos(coin, coin1, priorityAmount).outAmount;
          if (!utils.isPositiveNumber(coin1PriorityAmount)) {
            return formSendBackMessage(`Unable to calculate ${priorityAmount} ${coin} to ${coin1} priority amount for placed order monitoring. ${commandExample}.`);
          }

          priorityAmountString = utils.toFixedMeaningful(coin1PriorityAmount, coin1Decimals);
        }

        if (priorityAmount <= amount) {
          return formSendBackMessage(`Set the priority notification amount higher than the regular amount. ${commandExample}.`);
        }
      }

      // Save Order notifier parameters

      tradeParams.mm_isOrderNotifierActive = true;
      tradeParams.mm_orderNotifierAmount = coin1Amount;
      tradeParams.mm_orderNotifierAmountPriority = coin1PriorityAmount;

      getFeatureModule('on').resetOrderNotifier();

      // Prepare informational message

      amountString = `${amountString} ${coin1}`;
      if (coin !== coin1) amountString += ` (${amountSmart} ${coin})`;
      infoString = ` for orders from _${amountString}_`;

      if (priorityAmountString) {
        priorityAmountString = `${priorityAmountString} ${coin1}`;
        if (coin !== coin1) priorityAmountString += ` (${priorityAmountParam} ${coin})`;
        infoString += ` and priority notifications from _${priorityAmountString}_`;
      }

      featureString = 'Order notifier';
    } // end of purpose === "on"

    msgNotify = `${config.notifyName} enabled ${featureString} for ${pair}${infoString}.`;
    msgSendBack = `${featureString} is enabled for ${pair}${infoString}.${infoStringSendBack}`;

    if (!tradeParams.mm_isActive) {
      msgNotify += ` Market-making and ${featureString} are not started yet.`;
      msgSendBack += `\n\nTo start market-making and ${featureString}, type */start*.`;
    }
  } catch (e) {
    log.error(`commandTxs: Error in enable() of ${moduleName} module: ${e}`);
  }

  return formSendBackAndNotify(msgSendBack, msgNotify);
}


/**
 * Enables a trading feature
 * Format: /disable {purpose}
 * @see https://marketmaking.app/cex-mm/command-reference#disable
 * @param {string[]} params Feature to disable
 * @returns {CommandReply}
 */
function disable(params) {
  let msgNotify; let msgSendBack; let featureString;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    let purpose = parsedParams?.more?.[0]?.param; // Feature purpose is broader than orderCollector.orderPurposes because not all features have their own order purpose

    if (parsedParams?.moduleIndex > 1) { // E.g., ld2
      purpose = parsedParams.purpose;
    }

    const typeValidation = validateFeature(purpose, 'disable');

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${typeValidation.msgSendBack}`);
    }

    if (!typeValidation.featureExists) {
      return formSendBackMessage(typeValidation.msgSendBack);
    }

    if (typeValidation.moduleAvailable === false) {
      return formSendBackMessage(typeValidation.msgSendBack);
    }

    if (config.perpetual && !typeValidation.perpetual) {
      return formSendBackMessage(`The feature _${purpose}_ (${typeValidation.description}) is not available for perpetual contract trading.`);
    }

    const instanceNo = parsedParams.moduleIndexString || ''; // May be undefined, because not all features have a corresponding order purpose
    typeValidation.tradeParamActiveName = `${typeValidation.tradeParamActiveName}${instanceNo}`;
    const purposeIndexed = `${purpose}${instanceNo}`;

    if (!tradeParams[typeValidation.tradeParamActiveName]) {
      return formSendBackMessage(`The feature _${purposeIndexed}_ (${typeValidation.description}) is _already disabled_.`);
    }

    const pair = config.defaultPair;

    const pausing = parsedParams.is('pause');
    let pauseActivated = false;

    const pw = getPriceWatcherModule();

    if (purpose === 'sp') {
      tradeParams[typeValidation.tradeParamActiveName] = 0;
      featureString = 'Support price';
    } else if (purpose === 'pw') {
      tradeParams[typeValidation.tradeParamActiveName] = false;
      featureString = 'Price watching';

      pw.savePw('User /disable pw command');
    } else if (purpose === 'vc') {
      tradeParams[typeValidation.tradeParamActiveName] = false;
      featureString = 'Volatility chart';

      if (tradeParams.mm_priceMakerInitiator === 'volatility chart') {
        if (tradeParams.mm_isPriceMakerActive === true && tradeParams.mm_isTraderActive && tradeParams.mm_Policy === 'depth') {
          pw.restorePw('User> Price maker run by Volatility chart is stopped because of Vc is now disabled');
        }

        tradeParams.mm_isPriceMakerActive = false;
      }
    } else if (purpose === 'ld') {
      const ldInstance = getFeatureModule('ld')(instanceNo);

      if (pausing) {
        pauseActivated = ldInstance.pauseLadder('User command').paused;

        if (!pauseActivated) {
          return formSendBackMessage(`The feature _${purposeIndexed}_ (${typeValidation.description}) is _already paused_.`);
        }
      } else {
        tradeParams[typeValidation.tradeParamActiveName] = false;
      }

      featureString = `Ladder${instanceNo}`;
    } else { // Disabling a feature follows a unified workflow
      tradeParams[typeValidation.tradeParamActiveName] = false;
      featureString = utils.capitalize(typeValidation.description);
    }

    const action = pauseActivated ? 'paused' : 'disabled';

    msgNotify = `${config.notifyName} _${action}_ ${featureString} for ${pair} on ${config.exchangeName}.`;
    msgSendBack = `${featureString} is _${action}_ for ${pair} on ${config.exchangeName}.`;

    if (tradeParams.mm_isActive) {
      msgNotify += ' Market-making is _still active_.';
      msgSendBack += '\n\nMarket-making is _still active_—to stop it, type */stop*.';
    }
  } catch (e) {
    log.error(`commandTxs: Error in disable() of ${moduleName} module: ${e}`);
  }

  return formSendBackAndNotify(msgSendBack, msgNotify);
}

module.exports = {
  botFeatures,
  validateFeature,
  composeFeatureList,
  getNiceChartIntervalWarning,
  features,
  enable,
  disable,
};
