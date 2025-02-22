/**
 * Processor for user commands
 */

/**
 * @module modules/commandTxs
 * @typedef {import('../types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('../types/bybit/tickers.d').Tickers} Tickers
 */

'use strict';

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const exchangerUtils = require('../helpers/cryptos/exchanger');
const config = require('./configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const api = require('./api');

const tradeParams = require('../trade/settings/tradeParams_' + config.exchange);
const orderCollector = require('../trade/orderCollector');
const orderStats = require('../trade/orderStats');
const orderUtils = require('../trade/orderUtils');

const TraderApi = require('../trade/trader_' + config.exchange);
const perpetualApi = undefined;

const traderapi = TraderApi(
    config.apikey,
    config.apisecret,
    config.apipassword,
    log,
    undefined,
    undefined,
    config.exchange_socket,
    config.exchange_socket_pull,
);

let traderapi2;

const timeToConfirm = 1000 * 60 * 10; // 10 minutes to confirm
const pendingConfirmation = {
  command: '',
  timestamp: 0,
};

const previousBalances = [
  {}, // balances of the first trade account
  {}, // balances of the second trade account
  {}, // sum of balances for both trade accounts
];
/**
  accountNo -> userId -> balances object
  {
    userId: {
      timestamp,
      balances: balances for userId/senderId @timestamp
    }
  }
 */

const previousOrders = [
  {}, // orders of the first trade account
  {}, // orders of the second trade account
];

module.exports = async (commandMsg, tx, itx) => {
  let commandResult = {};

  try {
    const from = tx.senderTgUsername ?
      `${tx.senderTgUsername} (message ${tx.id})` :
      `${tx.senderId} (transaction ${tx.id})`;

    log.log(`Processing '${commandMsg}' command from ${from}…`);

    let group = commandMsg
        .trim()
        .replace(/ {2,}/g, ' ')
        .split(' ');
    let commandName = group.shift().trim().toLowerCase().replace('/', '');

    const alias = aliases[commandName];
    if (alias) {
      log.log(`Alias '${commandMsg}' converted to command '${alias(group)}'`);
      group = alias(group)
          .trim()
          .replace(/ {2,}/g, ' ')
          .split(' ');
      commandName = group.shift().trim().toLowerCase().replace('/', '');
    }

    const command = commands[commandName];

    if (command) {
      commandResult = await command(group, tx, itx?.commandFix); // commandFix if for /help only
    } else {
      commandResult.msgSendBack = `I don’t know */${commandName}* command. ℹ️ You can start with **/help**.`;
    }

    if (commandResult.msgNotify) {
      notify(`${commandResult.msgNotify} Action is executed by ${from}.`, commandResult.notifyType);
    }

    if (itx) {
      await itx.update({ isProcessed: true }, true);
    }

    if (commandName !== 'y') {
      utils.saveConfig(false, `After-commandTxs(/${commandName})`);
    }
  } catch (e) {
    tx = tx || {};

    if (tx.senderTgUsername) {
      log.error(`Error while processing ${commandMsg} command from ${tx.senderTgUsername} (message ${tx.id}). Error: ${e.toString()}`);
    } else {
      log.error(`Error while processing ${commandMsg} command from ${tx.senderId} (transaction ${tx.id}). Error: ${e.toString()}`);
    }
  }

  return commandResult;
};

/**
 * Helper to form CommandReply
 * No notification and no logging
 * @param {string} msgSendBack Reply to user
 * @returns {CommandReply}
 */
function formSendBackMessage(msgSendBack) {
  return {
    msgNotify: '',
    msgSendBack,
    notifyType: 'log',
  };
}

/**
 * Helper to form CommandReply
 * @param {string} msgSendBack Reply to user
 * @param {string} [msgNotify=''] Notification message
 * @returns {CommandReply}
 */
function formSendBackAndNotify(msgSendBack, msgNotify = '') {
  return {
    msgNotify,
    msgSendBack,
    notifyType: 'log',
  };
}

/**
 * Get pair rates info for a spot pair or a contract from an exchange
 * @param {string} pair Trading pair BTC/USDT or a contract BTC/USDT
 * @returns {{success: boolean, exchangeRates: Tickers, ratesString: string}}
 */
async function getExchangeRatesInfo(pair) {
  let er; // exchangeRates
  let ratesString;
  let success;

  try {
    const formattedPair = orderUtils.parseMarket(pair);
    const coin1 = formattedPair.coin1;
    const coin2 = formattedPair.coin2;
    const coin2Decimals = formattedPair.coin2Decimals;

    let type;

    if (formattedPair.perpetual) {
      type = 'perpetual contract';
      er = await perpetualApi.getTickerInfo(formattedPair.perpetual);
    } else {
      type = 'spot pair';
      er = await traderapi.getRates(formattedPair.pair);
    }

    if (er) {
      const delta = er.ask-er.bid;
      const average = (er.ask + er.bid)/2;
      const deltaPercent = delta/average * 100;

      ratesString = `${config.exchangeName} rates for ${pair} ${type}:`;
      ratesString += `\nBid: ${utils.formatNumber(er.bid)}, ask: ${utils.formatNumber(er.ask)}, spread: _${utils.formatNumber(delta.toFixed(coin2Decimals))}_ ${coin2} (${(deltaPercent).toFixed(2)}%).`;
      if (er.last) {
        ratesString += ` Last price: _${utils.formatNumber(er.last)}_ ${coin2}.`;
      }

      if (formattedPair.perpetual) {
        ratesString += `\nOpen interest: _${utils.formatNumber(er.openInterest)}_ ${coin1} (_${(utils.formatNumber(er.openInterestValue))}_ ${coin2}), funding rate: _${(er.fundingRate * 100).toFixed(6)}%_.`;
      }

      success = true;
    } else {
      ratesString = `Unable to get ${config.exchangeName} rates for ${pair} ${type}.`;
      success = false;
    }
  } catch (e) {
    log.error(`Error in getExchangeRatesInfo() of ${utils.getModuleName(module.id)} module: ${e}`);

    ratesString = `Unable to process ${config.exchangeName} rates for ${pair}: ${e}.`;
    success = false;
  }

  return {
    success,
    exchangeRates: er,
    ratesString,
  };
}

/**
 * Set a command to be confirmed
 * @param {String} command This command will be executed with /y
 */
function setPendingConfirmation(command) {
  try {
    pendingConfirmation.command = command;
    pendingConfirmation.timestamp = Date.now();
    log.log(`Pending command to confirm: ${command}.`);
  } catch (e) {
    log.error(`Error in setPendingConfirmation() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

/**
 * Command to confirm pending command, set with setPendingConfirmation()
 * @param {Array of String} params Doesn't matter
 * @param {Object} tx Information about initiator
 * @return {Object} commandResult.msgSendBack to reply
 */
async function y(params, tx) {
  try {
    if (pendingConfirmation.command) {
      let commandResult = {
        msgNotify: '',
        msgSendBack: '',
        notifyType: 'log',
      };

      if (Date.now() - pendingConfirmation.timestamp > timeToConfirm) {
        commandResult.msgSendBack = `I will not confirm command ${pendingConfirmation.command} as it is expired. Try again.`;
      } else {
        commandResult = await module.exports(`${pendingConfirmation.command} -y`, tx);
        commandResult.msgNotify = ''; // Command itself will notify, we need only msgSendBack
      }

      pendingConfirmation.command = '';

      return commandResult;
    } else {
      return {
        msgNotify: '',
        msgSendBack: 'There is no pending command to confirm.',
        notifyType: 'log',
      };
    }
  } catch (e) {
    log.error(`Error in y()-confirmation of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

/**
 * Starts market-making
 * Format: /start mm [strategy]
 * @see https://marketmaking.app/cex-mm/command-reference#start
 * @param {[string]} params 'mm' and strategy name
 * @returns {CommandReply}
 */
function start(params) {
  const commandExample = `Try: */start mm optimal*`;

  try {
    const pair = config.defaultPair;

    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const type = parsedParams.purpose;
    if (type !== 'mm') {
      return formSendBackMessage(`Indicate trade type, _mm_ for ${pair} market-making. ${commandExample}.`);
    }

    let policy = parsedParams.more?.find((param) => param.param !== 'mm')?.param;

    if (policy && !constants.MM_POLICIES.includes(policy)) {
      return formSendBackMessage(`Unknown market-making policy: _${policy}_. Allowed policies: _${constants.MM_POLICIES.join(', ')}_. ${commandExample}.`);
    } else if (!policy) {
      policy = tradeParams.mm_Policy || 'optimal';
    }

    if (
      tradeParams.mm_isPriceMakerActive === true &&
      tradeParams.mm_Policy === 'depth' &&
      policy !== 'depth'
    ) {
      const pw = require('../trade/mm_price_watcher');
      pw.restorePw(`User> Market making policy changed from depth to ${policy}`);
    }

    tradeParams.mm_isActive = true;
    tradeParams.mm_Policy = policy;

    const notesStringMsg = ' Check enabled options with the */params* command.';

    const msgNotify = `${config.notifyName} started market-making with the _${policy}_ policy for ${pair}.`;
    const msgSendBack = `Starting market-making with the _${policy}_ policy for ${pair}.${notesStringMsg}`;

    return {
      msgNotify,
      msgSendBack,
      notifyType: 'log',
    };
  } catch (e) {
    log.error(`Error in start() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Stops market-making
 * Format: /stop mm
 * @see https://marketmaking.app/cex-mm/command-reference#stop
 * @param {[string]} params 'mm'
 * @returns {CommandReply}
 */
function stop(params) {
  const commandExample = `Try: */stop mm*`;

  try {
    const pair = config.defaultPair;

    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const type = parsedParams.purpose;
    if (type !== 'mm') {
      return formSendBackMessage(`Indicate trade type, _mm_ for ${pair} market-making. ${commandExample}.`);
    }

    const optionsString = ', order book building, liquidity and spread maintenance, price watching and other options';

    let msgNotify;
    let msgSendBack;

    if (tradeParams.mm_isActive) {
      msgNotify = `${config.notifyName} stopped market-making${optionsString} for ${pair}.`;
      msgSendBack = `Market-making${optionsString} for ${pair} are disabled now.`;
    } else {
      msgNotify = '';
      msgSendBack = `Market-making for ${pair} is not active.`;
    }

    tradeParams.mm_isActive = false;

    return {
      msgNotify,
      msgSendBack,
      notifyType: 'log',
    };
  } catch (e) {
    log.error(`Error in stop() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Validate if the bot has a specific feature
 * @param {string} feature Feature to enable or disable
 * @param {'enable' | 'disable'} action
 * @returns {{ featureExists: boolean, validated?: boolean, perpetual?: boolean, description?: string, msgSendBack: string }}
 */
function validateFeature(feature, action) {
  // Bot feature list with descriptions
  // It's broader than orderCollector.orderPurposes because not all features have its order type
  const botFeatures = {
    ob: {
      description: 'dynamic order book building',
      perpetual: true,
    },
    liq: {
      description: 'liquidity and spread maintenance',
      perpetual: false,
    },
    pw: {
      description: 'price watching',
      perpetual: false,
    },
  };

  // Check if feature exists and get its description

  const featureExists = Object.keys(botFeatures).includes(feature);

  const perpetual = featureExists && botFeatures[feature].perpetual;
  const description = featureExists && botFeatures[feature].description;

  const validated = perpetual;

  let featureDescription = Object.entries(botFeatures)
      .map(([key, value]) => `\n_${key}_ for ${value.description}`)
      .join(', ');
  featureDescription = utils.trimAny(featureDescription, ', ') + '.';

  let msgSendBack = 'Indicate option:\n';
  msgSendBack += featureDescription;
  msgSendBack += action === 'enable' ? '\n\nExample: */enable ob 15*.' : '\n\nExample: */disable ob*.';

  return {
    featureExists, // If feature is correct
    validated, // Not in use
    perpetual,
    description,
    msgSendBack,
  };
}

/**
 * Enables a trading feature
 * Format: /enable {purpose} [params]
 * @see https://marketmaking.app/cex-mm/command-reference#enable-ob
 * @param {[string]} params Feature to enable and their params
 * @returns {CommandReply}
 */
async function enable(params, _, isWebApi = false) {
  let msgNotify; let msgSendBack; let infoString; let infoStringSendBack = ''; let optionsString;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    let type = parsedParams?.more?.[0]?.param; // Feature type is broader than orderCollector.orderPurposes because not all features have its order type

    if (parsedParams?.moduleIndex > 1) { // E.g., ld2
      type = parsedParams.purpose;
    }

    // Validate type

    const typeValidation = validateFeature(type, 'enable');

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${typeValidation.msgSendBack}`);
    }

    if (!typeValidation.featureExists) {
      return formSendBackMessage(typeValidation.msgSendBack);
    }

    if (config.perpetual && !typeValidation.perpetual) {
      return formSendBackMessage(`The feature _${type}_ (${typeValidation.description}) is not available for perpetual contract trading.`);
    }

    const pair = config.defaultPair;
    const formattedPair = orderUtils.parseMarket(pair);
    const coin1 = formattedPair.coin1;
    const coin1Decimals = formattedPair.coin1Decimals;

    if (type === 'ob') {
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
            msgSendBack: `Set correct max ob-order amount percent from market-making max order (currently _${tradeParams.mm_maxAmount.toFixed(coin1Decimals)} ${coin1}_). Example: */enable ob 15 20%*.`,
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
      optionsString = 'Order book building';
      if (tradeParams.mm_orderBookMaxOrderPercent === 100) {
        infoStringPercent = ` and same max order amount as market-making (currently _${tradeParams.mm_maxAmount.toFixed(coin1Decimals)} ${coin1}_)`;
      } else {
        const maxAgOrderAmount = tradeParams.mm_orderBookMaxOrderPercent * tradeParams.mm_maxAmount / 100;
        infoStringPercent = ` and max order amount of _${tradeParams.mm_orderBookMaxOrderPercent}%_ from market-making max order, _~${maxAgOrderAmount.toFixed(coin1Decimals)} ${coin1}_ currently`;
      }
      infoString = ` with _${tradeParams.mm_orderBookOrdersCount}_ maximum number of orders${infoStringPercent}`;

    } else if (type === 'liq') {

      // Parse ±depth%
      let spreadPercentMin; let spreadPercentMax;
      const spreadString = params[1];
      if (!spreadString || (spreadString.slice(-1) !== '%')) {
        return {
          msgNotify: '',
          msgSendBack: 'Set correct ±depth%. Example: */enable liq 2% 1000 ADM 50 USDT uptrend*.',
          notifyType: 'log',
        };
      }
      const rangeOrValue = utils.parseRangeOrValue(spreadString.slice(0, -1));
      if (rangeOrValue.isValue) {
        return {
          msgNotify: '',
          msgSendBack: 'Set correct ±depth%. Example: */enable liq 2% 1000 ADM 50 USDT uptrend*.',
          notifyType: 'log',
        };
      }

      if (rangeOrValue.isValue) {
        if (rangeOrValue.value > 80) {
          return {
            msgNotify: '',
            msgSendBack: 'Set correct ±depth%. Example: */enable liq 2% 1000 ADM 50 USDT ss uptrend*.',
            notifyType: 'log',
          };
        }
        spreadPercentMin = 0;
        spreadPercentMax = rangeOrValue.value;
      }

      // Parse liquidity value
      const coin1 = params[3]?.toUpperCase();
      const coin2 = params[5]?.toUpperCase();
      if (
        !coin1 || !coin2 || coin1 === coin2 ||
        (![config.coin1, config.coin2].includes(coin1)) || (![config.coin1, config.coin2].includes(coin2))
      ) {
        return {
          msgNotify: '',
          msgSendBack: `Incorrect liquidity coins. Config is set to trade ${config.pair} pair. Example: */enable liq 2% 100 ${config.coin1} 50 ${config.coin2} uptrend*.`,
          notifyType: 'log',
        };
      }

      const coin1Amount = +params[2];
      if (!utils.isPositiveOrZeroNumber(coin1Amount)) {
        return {
          msgNotify: '',
          msgSendBack: `Incorrect ${coin1} amount: _${coin1Amount}_. Example: */enable liq 2% 100 ${config.coin1} 50 ${config.coin2} uptrend*.`,
          notifyType: 'log',
        };
      }

      const coin2Amount = +params[4];
      if (!utils.isPositiveOrZeroNumber(coin2Amount)) {
        return {
          msgNotify: '',
          msgSendBack: `Incorrect ${coin2} amount: _${coin2Amount}_. Example: */enable liq 1.5-2% 100 ${config.coin1} 50 ${config.coin2} ss uptrend*.`,
          notifyType: 'log',
        };
      }

      // Parse spread support and trend
      let isSpreadSupport = false; let trend = 'middle';
      for (let ssOrTrend of [params[6], params[7]]) {
        if (ssOrTrend) {
          ssOrTrend = ssOrTrend?.toLowerCase();
          if ((['middle', 'downtrend', 'uptrend'].includes(ssOrTrend))) {
            trend = ssOrTrend;
          } else {
            return {
              msgNotify: '',
              msgSendBack: `Unknown parameter: _${ssOrTrend}_. Usage: */enable liq 2% 100 ${config.coin1} 50 ${config.coin2} uptrend*.`,
              notifyType: 'log',
            };
          }
        }
      }

      if (coin1 === config.coin1) {
        tradeParams.mm_liquiditySellAmount = coin1Amount;
        tradeParams.mm_liquidityBuyQuoteAmount = coin2Amount;
      } else {
        tradeParams.mm_liquiditySellAmount = coin2Amount;
        tradeParams.mm_liquidityBuyQuoteAmount = coin1Amount;
      }

      tradeParams.mm_liquidityTrend = trend;
      tradeParams.mm_liquiditySpreadPercentMin = spreadPercentMin;
      tradeParams.mm_liquiditySpreadPercent = spreadPercentMax;
      tradeParams.mm_liquiditySpreadSupport = isSpreadSupport;
      tradeParams.mm_isLiquidityActive = true;

      if (trend === 'middle') {
        trend = 'middle trend';
      }
      const ssString = isSpreadSupport ? ' & *spread support*' : '';

      infoString = ` with _${tradeParams.mm_liquiditySellAmount} ${config.coin1}_ asks (sell) and _${tradeParams.mm_liquidityBuyQuoteAmount} ${config.coin2}_ bids (buy)`;
      infoString += ` in _${spreadString}_ depth & _${trend}_${ssString}`;
      optionsString = 'Liquidity and spread maintenance';

      await require('../trade/mm_liquidity_provider').resetLiqLimits('all', 'CommandTxs/NewLiquiditySet');

    } else if (type === 'pw') {

      const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

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
        pairObj = orderUtils.parseMarket(pair, exchangeName, true);
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
          pairObj.pair.toUpperCase() === config.pair.toUpperCase() &&
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
          orderBook = await orderUtils.getOrderBookCached(pairObj.pair, utils.getModuleName(module.id));
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
          log.warn(noOrderBookInfo);

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

      optionsString = 'Price watching';

      let isConfirmed = params[params.length-1];
      if (['-y', '-Y'].includes(isConfirmed)) {
        isConfirmed = true;
      } else {
        isConfirmed = false;
      }

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

        const pw = require('../trade/mm_price_watcher');
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
        let priceInfoString = '';
        pairObj = orderUtils.parseMarket(config.pair);

        const currencies = exchangerUtils.currencies;
        const res = Object
            .keys(currencies)
            .filter((t) => t.startsWith(pairObj.coin1 + '/'))
            .map((t) => {
              const p = `${pairObj.coin1}/**${t.replace(pairObj.coin1 + '/', '')}**`;
              return `${p}: ${currencies[t]}`;
            })
            .join(', ');

        if (!res.length) {
          if (!pairObj.pair) {
            priceInfoString = `I can’t get rates for *${pairObj.coin1}* from Infoservice.`;
          }
        } else {
          priceInfoString = `Global market rates for ${pairObj.coin1}:\n${res}.`;
        }

        if (priceInfoString) {
          priceInfoString += '\n\n';
        }

        const exchangeRatesInfo = await getExchangeRatesInfo(pairObj.pair);
        priceInfoString += exchangeRatesInfo.ratesString;

        setPendingConfirmation(`/enable ${params.join(' ')}`);

        msgNotify = '';
        const spNoteStringDots = spNoteString ? utils.trimAny(spNoteString, '.') + '.' : '';
        msgSendBack = `Are you sure to enable ${optionsString} for ${config.pair} pair${infoString}?${spNoteStringDots} Confirm with **/y** command or ignore.\n\n${priceInfoString}`;

        return {
          msgNotify,
          msgSendBack,
          notifyType: 'log',
        };
      }

    } // type === "pw"

    msgNotify = `${config.notifyName} enabled ${optionsString} for ${pair}${infoString}.`;
    msgSendBack = `${optionsString} is enabled for ${pair}${infoString}.${infoStringSendBack}`;

    if (!tradeParams.mm_isActive) {
      msgNotify += ` Market-making and ${optionsString} are not started yet.`;
      msgSendBack += ` To start market-making and ${optionsString}, type */start mm*.`;
    }
  } catch (e) {
    log.error(`Error in enable() of ${utils.getModuleName(module.id)} module: ${e}`);
  }

  return formSendBackAndNotify(msgSendBack, msgNotify);
}

/**
 * Enables a trading feature
 * Format: /disable {purpose}
 * @see https://marketmaking.app/cex-mm/command-reference#disable
 * @param {[string]} params Feature to disable
 * @returns {CommandReply}
 */
function disable(params) {
  let msgNotify; let msgSendBack; let optionsString;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    let type = parsedParams?.more?.[0]?.param; // Feature type is broader than orderCollector.orderPurposes because not all features have its order type

    if (parsedParams?.moduleIndex > 1) { // E.g., ld2
      type = parsedParams.purpose;
    }

    const typeValidation = validateFeature(type, 'disable');

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${typeValidation.msgSendBack}`);
    }

    if (!typeValidation.featureExists) {
      return formSendBackMessage(typeValidation.msgSendBack);
    }

    if (config.perpetual && !typeValidation.perpetual) {
      return formSendBackMessage(`The feature _${type}_ (${typeValidation.description}) is not available for perpetual contract trading.`);
    }

    const pair = config.defaultPair;

    const paused = parsedParams.is('pause');
    let pauseActivated = false;

    if (type === 'ob') {
      tradeParams.mm_isOrderBookActive = false;
      optionsString = 'Order book building';
    } else if (type === 'liq') {
      tradeParams.mm_isLiquidityActive = false;
      optionsString = 'Liquidity and spread maintenance';
    } else if (type === 'pw') {
      tradeParams.mm_isPriceWatcherActive = false;
      const pw = require('../trade/mm_price_watcher');
      pw.savePw('User /disable pw command');
      optionsString = 'Price watching';
    }

    const action = pauseActivated ? 'paused' : 'disabled';

    msgNotify = `${config.notifyName} _${action}_ ${optionsString} for ${pair} on ${config.exchangeName}.`;
    msgSendBack = `${optionsString} is _${action}_ for ${pair} on ${config.exchangeName}.`;

    if (tradeParams.mm_isActive) {
      msgNotify += ' Market-making is still active.';
      msgSendBack += ' Market-making is still active—to stop it, type */stop mm*.';
    }
  } catch (e) {
    log.error(`Error in disable() of ${utils.getModuleName(module.id)} module: ${e}`);
  }

  return formSendBackAndNotify(msgSendBack, msgNotify);
}

function buypercent(param) {
  const val = +((param[0] || '').trim());
  if (!val || val === Infinity || val < 0 || val > 100) {
    return {
      msgNotify: '',
      msgSendBack: 'Invalid percentage of buy orders. Example: */buyPercent 85*.',
      notifyType: 'log',
    };
  }

  tradeParams.mm_buyPercent = val / 100;
  return {
    msgNotify: `${config.notifyName} is set to make market with ${val}% of buy orders for ${config.pair} pair. Order book building is set to ${100-val}% of buy orders.`,
    msgSendBack: `Set to make market with ${val}% of buy orders for ${config.pair} pair. Order book building is set to ${100-val}% of buy orders.`,
    notifyType: 'log',
  };
}

/**
 * Set trading amounts
 * Format: /amount [min-max]
 * @see https://marketmaking.app/cex-mm/command-reference#amount
 * @param {[string]} params Expected: interval min-max
 * @returns {CommandReply}
 */
function amount(params) {
  const commandExample = `Try: */amount 0.01-20*`;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const intervalParam = parsedParams.more?.[0];

    if (!intervalParam.isInterval) {
      return formSendBackMessage(`Wrong trading amount interval: _${intervalParam.param}_. ${commandExample}.`);
    }

    const interval = utils.parseRangeOrValue(intervalParam.param);

    if (!interval.isRange) {
      return formSendBackMessage(`Unable to parse trading amount interval: _${intervalParam.param}_. ${commandExample}.`);
    }

    const oldVolume = exchangerUtils.estimateCurrentDailyTradeVolume();
    tradeParams.mm_minAmount = interval.from;
    tradeParams.mm_maxAmount = interval.to;
    const newVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

    const volumeChangePercent = utils.numbersDifferencePercentDirect(oldVolume.coin1, newVolume.coin1);
    const operator = oldVolume.coin1 > newVolume.coin1 ? '–' : '+';
    const volumeChangePercentString = `${operator}${volumeChangePercent.toFixed(2)}%`;

    let infoString = `to make market with amounts from _${interval.fromStr}_ to _${interval.toStr}_ ${config.coin1} for ${config.defaultPair}.`;
    infoString += ` Estimate daily mm trading volume changed _${volumeChangePercentString}_: ${exchangerUtils.getVolumeChangeInfoString(oldVolume, newVolume)}.`;

    return {
      msgNotify: `${config.notifyName} is set ${infoString}`,
      msgSendBack: `I'm set ${infoString}`,
      notifyType: 'log',
    };

  } catch (e) {
    log.error(`Error in amount() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Set trading interval
 * Format: /amount [min-max] [unit]
 * @see https://marketmaking.app/cex-mm/command-reference#interval
 * @param {[string]} params Expected: interval min-max, time unit
 * @returns {CommandReply}
 */
function interval(params) {
  const commandExample = `Try: */interval 1-5 min*`;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 2);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const intervalParam = parsedParams.more?.[0];

    if (!intervalParam.isInterval) {
      return formSendBackMessage(`Wrong trading amount interval: _${intervalParam.param}_. ${commandExample}.`);
    }

    const interval = utils.parseRangeOrValue(intervalParam.param);

    if (!interval.isRange) {
      return formSendBackMessage(`Unable to parse trading amount interval: _${intervalParam.param}_. ${commandExample}.`);
    }

    const timeUnit = parsedParams.more?.[1]?.param;

    let multiplier;

    switch (timeUnit) {
      case 'sec':
        multiplier = 1000;
        break;
      case 'min':
        multiplier = 1000*60;
        break;
      case 'hour':
        multiplier = 1000*60*60;
        break;
      default:
        break;
    }

    if (!multiplier) {
      return formSendBackMessage(`Invalid time unit for interval: _${timeUnit}_. Set _sec_, _min_, or _hour_. ${commandExample}.`);
    }

    const oldVolume = exchangerUtils.estimateCurrentDailyTradeVolume();
    tradeParams.mm_minInterval = Math.round(interval.from * multiplier);
    tradeParams.mm_maxInterval = Math.round(interval.to * multiplier);
    const newVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

    const volumeChangePercent = utils.numbersDifferencePercentDirect(oldVolume.coin1, newVolume.coin1);
    const operator = oldVolume.coin1 > newVolume.coin1 ? '–' : '+';
    const volumeChangePercentString = `${operator}${volumeChangePercent.toFixed(2)}%`;

    let infoString = `to make market in intervals from _${interval.fromStr}_ to _${interval.toStr}_ ${timeUnit} for ${config.defaultPair}.`;
    infoString += ` Estimate daily mm trading volume changed _${volumeChangePercentString}_: ${exchangerUtils.getVolumeChangeInfoString(oldVolume, newVolume)}.`;

    return {
      msgNotify: `${config.notifyName} is set ${infoString}`,
      msgSendBack: `I'm set ${infoString}`,
      notifyType: 'log',
    };

  } catch (e) {
    log.error(`Error in interval() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Cancels orders on a spot trading pair or a contract
 * Format: /clear [pair] [type] {buy/sell} [condition] {force}
 * @see https://marketmaking.app/cex-mm/command-reference#clear
 * @param {[string]} params Expected to receive a coin, trading pair, or a contract ticker
 * @returns {CommandReply}
 */
async function clear(params) {
  const commandExample = `Try: */clear mm sell >0.5 ${config.coin2}*`;
  const commandExampleSimple = 'Try: */clear man*';

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    if (utils.isPerpetual(pair) && !perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    const formattedPair = orderUtils.parseMarket(pair);

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExampleSimple}.`);
    }

    const type = parsedParams.orderType;
    const doForce = parsedParams.is('force');
    const condition = parsedParams.condition;

    const purpose = parsedParams.purpose;
    const moduleIndexString = parsedParams.moduleIndexString;
    const purposeString = `${parsedParams.purposeString}${moduleIndexString}`;

    if (!purpose) {
      return formSendBackMessage(`Specify the type of orders to clear. Available order types:\n\n${orderCollector.getPurposeList().message}.\n\n${commandExampleSimple}.`);
    }

    let filter;
    let conditionString = '';

    if (condition) {
      conditionString = condition.string;

      if (condition.error) {
        return formSendBackMessage(`The condition '${conditionString}' is invalid: ${condition.error}. ${commandExample}.`);
      }

      if (['all', 'unk'].includes(purpose)) {
        return formSendBackMessage(`The price filter doesn't work with **all** and **unk** orders. ${commandExample}.`);
      }

      const priceCoin = condition.valueCoin;

      if (priceCoin !== formattedPair.coin2) {
        return formSendBackMessage(`The expected price filter coin is ${formattedPair.coin2} for ${formattedPair.pair}. ${commandExample}.`);
      }

      filter = condition.mongoFilter;

      // Create a new key 'price' with the value of 'value'
      filter.price = filter.value;
      delete filter.value;
    }

    // Choose API

    let api;

    if (formattedPair.perpetual) {
      api = perpetualApi; // Currently, orderCollector checks if a contract and uses perpetualApi then independent of this param
    } else if (parsedParams.useSecondAccount) {
      if (traderapi2) {
        api = traderapi2;
      } else {
        return formSendBackMessage(`The second trader account is not set. Remove the _-2_ option to run the command for the first account. ${commandExampleSimple}.`);
      }
    } else {
      api = traderapi;
    }

    // Cancel orders

    let output = '';
    let clearedInfo = {};
    const typeString = type ? `**${type}**-` : '';

    if (purpose === 'all') {
      clearedInfo = await orderCollector.clearAllOrders(formattedPair.pair, doForce, type, 'User command', `${typeString}orders`, api);
    } else { // Closing orders of specified type only
      let filterString = '';

      if (purpose === 'unk') {
        clearedInfo = await orderCollector.clearUnknownOrders(formattedPair.pair, doForce, type, 'User command', `**${purposeString}** ${typeString}orders${filterString}`, api);
      } else {
        if (filter) {
          filterString = ` with price ${conditionString} ${config.coin2}`;
        }

        clearedInfo = await orderCollector.clearLocalOrders([purpose], formattedPair.pair, doForce, type, filter, 'User command', `**${purposeString}** ${typeString}orders${filterString}`, api, moduleIndexString);
      }
    }

    output = clearedInfo.logMessage;

    return formSendBackMessage(output);
  } catch (e) {
    log.error(`Error in clear() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Places several orders within a price range on spot or contract trading pair
 * Format: /fill [pair] {buy/sell} [amount= or quote=] [low=] [high=] [count=]
 * @see https://marketmaking.app/cex-mm/command-reference#fill
 * @param {[string]} params Command parameters
 * @returns {CommandReply}
 */
async function fill(params) {
  const commandExample = `Try: */fill ADM/BTC buy quote=0.00002000 low=0.00000100 high=0.00000132 count=7*`;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 4);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    if (utils.isPerpetual(pair) && !perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    const formattedPair = orderUtils.parseMarket(pair);

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    // Verify parameters

    const type = parsedParams.orderType;

    if (!type) {
      return formSendBackMessage(`Specify _buy_ or _sell_ orders to fill. ${commandExample}.`);
    }

    // Name : type to parse and verify
    const paramMap = {
      count: 'positive integer',
      low: 'positive number',
      high: 'positive number',
    };

    if (type === 'buy') {
      paramMap.quote = 'positive number';
    } else {
      paramMap.amount = 'positive number';
    }

    for (const paramName of Object.keys(paramMap)) {
      const param = parsedParams[paramName];
      const verify = utils.verifyParam(paramName, param, paramMap[paramName]);

      if (!verify.success) {
        return formSendBackMessage(`Wrong arguments. ${verify.message}. ${commandExample}.`);
      }

      parsedParams[paramName + 'Parsed'] = verify.parsed;
    }

    const low = parsedParams.lowParsed.number;
    const high = parsedParams.highParsed.number;

    if (low >= high) {
      return formSendBackMessage(`To fill orders, _high_ is expected to be greater than _low_. ${commandExample}.`);
    }

    if (!parsedParams.xorAmounts) {
      return formSendBackMessage(`Buy should follow with _quote_, sell with _amount_. ${commandExample}.`);
    }

    const amountType = parsedParams.amountType;
    const qty = parsedParams.qty;

    const count = parsedParams.countParsed;
    const isConfirmed = parsedParams.isConfirmed;

    // Choose API

    let api;

    if (formattedPair.perpetual) {
      api = perpetualApi; // Currently, orderCollector checks if a contract and uses perpetualApi then independent of this param
    } else if (parsedParams.useSecondAccount) {
      if (traderapi2) {
        api = traderapi2;
      } else {
        return formSendBackMessage(`The second trader account is not set. Remove the _-2_ option to run the command for the first account. ${commandExample}.`);
      }
    } else {
      api = traderapi;
    }

    // Check if enough coin balance

    const balanceCheck = await orderUtils.isEnoughCoins(type, pair, qty, qty, 'fill', undefined, utils.getModuleName(module.id), api);

    if (!balanceCheck.result) {
      return formSendBackMessage(balanceCheck.message);
    }

    // For big orders, ask for a confirmation

    const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

    const totalUsd = amountType === 'quote' ?
        exchangerUtils.convertCryptos(formattedPair.coin2, 'USD', qty).outAmount :
        exchangerUtils.convertCryptos(formattedPair.coin1, 'USD', qty).outAmount;

    if (totalUsd >= config.amount_to_confirm_usd && !isConfirmed) {
      setPendingConfirmation(`/fill ${parsedParams.paramString}`);

      const totalUsdString = utils.formatNumber(totalUsd.toFixed(0), true);

      let confirmationMessage = `Are you sure to fill ${count} orders${onWhichAccount}`;
      confirmationMessage += amountType === 'quote' ?
          ` to ${type} ${formattedPair.coin1} worth ~${totalUsdString} USD` :
          ` to ${type} ${qty} ${formattedPair.coin1} (worth ~${totalUsdString} USD)`;
      confirmationMessage += ` priced from ${low} to ${high} ${formattedPair.coin2}?`;
      confirmationMessage += ' Confirm with **/y** command or ignore.';

      return formSendBackMessage(confirmationMessage);
    }

    // Make order list

    const orderList = [];

    const priceDelta = high - low;
    const priceStep = priceDelta / count;

    const avgQty = qty / count;

    const deviation = 0.9; // Randomize order prices and amounts

    let orderPrice = low;
    let totalQty = 0; let orderQty = 0; let coin2Amount = 0;

    for (let i=0; i < count; i++) {
      orderPrice += utils.randomDeviation(priceStep, deviation);
      orderQty = utils.randomDeviation(avgQty, deviation);

      totalQty += orderQty;

      // Checks if total or price exceeded
      if (totalQty > qty || orderPrice > high) {
        if (count === 1) {
          if (totalQty > qty) orderQty = qty;
          if (orderPrice > high) orderPrice = high;
        } else {
          break;
        }
      }

      // Count base and quote currency amounts
      if (type === 'buy') {
        orderQty = orderQty / orderPrice;
        coin2Amount = orderQty;
      } else {
        // orderQty is amount
        coin2Amount = orderQty * orderPrice;
      }

      orderList.push({
        price: orderPrice,
        amount: orderQty,
        quote: coin2Amount,
      });
    }

    // Place orders

    let totalAmount = 0; let totalQuote = 0;
    let placedOrders = 0; let notPlacedOrders = 0;

    let order;

    for (let i=0; i < orderList.length; i++) {
      order = await orderUtils.addGeneralOrder(type, formattedPair.pair, orderList[i].price, orderList[i].amount, 1, null, 'man', api);

      if (order?._id) {
        placedOrders += 1;
        totalAmount += +orderList[i].amount;
        totalQuote += +orderList[i].quote;
      } else {
        notPlacedOrders += 1;
      }
    }

    // Message command results

    let output = '';

    const totalAmountString = utils.formatNumber(totalAmount.toFixed(formattedPair.coin1Decimals));
    const totalQuoteString = utils.formatNumber(totalQuote.toFixed(formattedPair.coin2Decimals));

    if (placedOrders > 0) {
      output = `${placedOrders} orders${onWhichAccount} on ${pair} to ${type} ${totalAmountString} ${formattedPair.coin1} for ${totalQuoteString} ${formattedPair.coin2}.`;

      if (notPlacedOrders) {
        output += ` ${notPlacedOrders} orders missed because of errors, check the log file for details.`;
      }
    } else {
      output = `I couldn't place orders${onWhichAccount} on ${pair}. Check the log file for details.`;
    }

    const msgNotify = placedOrders > 0 ? `${config.notifyName} placed ${output}` : '';
    const msgSendBack = placedOrders > 0 ? `I've placed ${output}` : output;

    return {
      msgNotify,
      msgSendBack,
      notifyType: 'log',
    };
  } catch (e) {
    log.error(`Error in fill() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Places a buy order on spot or contract trading pair
 * Format: /{buy/sell} [pair] [amount= or quote=] [price=]
 * @see https://marketmaking.app/cex-mm/command-reference#buy-sell
 * @param {[string]} params Command parameters
 * @returns {CommandReply}
 */
async function buy(params) {
  const parsedParams = parseBuySellParams(params, 'buy');

  return buy_sell(parsedParams, 'buy');
}

/**
 * Places a sell order on spot or contract trading pair
 * Format: /{buy/sell} [pair] [amount= or quote=] [price=]
 * @see https://marketmaking.app/cex-mm/command-reference#buy-sell
 * @param {[string]} params Command parameters
 * @returns {CommandReply}
 */
async function sell(params) {
  const parsedParams = parseBuySellParams(params, 'sell');

  return buy_sell(parsedParams, 'sell');
}

/**
 * Parameters parser for /buy and /sell commands
 * Works both for Spot and Contracts
 * WARNING: We don't validate perpetual parameters currently
 * @param {[string]} params Command parameters
 * @param {'buy' | 'sell'} type Order type
 * @returns {Object} Parsed command parameters
 */
function parseBuySellParams(params, type) {
  // Default: pair={config.defaultPair} Base/Quote, price=market
  // amount XOR quote
  // buy ADM/BTC amount=200 price=0.00000224 | buy 200 ADM at 0.00000224
  // sell ADM/BTC amount=200 price=0.00000224 | sell 200 ADM at 0.00000224
  // buy ADM/BTC quote=0.01 price=0.00000224 | buy ADM for 0.01 BTC at 0.00000224
  // sell ADM/BTC quote=0.01 price=0.00000224 | sell ADM to get 0.01 BTC at 0.00000224

  // When Market order, buy follows quote, sell follows amount (but some exchanges offers any of these)
  // buy ADM/BTC quote=0.01 | buy ADM for 0.01 BTC at market price
  // buy ADM/BTC quote=0.01 price=market | the same
  // buy ADM/BTC quote=0.01 | buy ADM for 0.01 BTC at market price
  // sell ADM/BTC amount=8 | sell 8 ADM at market price

  const commandExample = `Try: */sell ADM/BTC amount=200 price=market*`;
  const commandExamplePerpetual = `Try: */buy BTCUSDT amount=1 price=market*`;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    if (utils.isPerpetual(pair) && !perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    const formattedPair = orderUtils.parseMarket(pair);

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    const commandExampleDepending = utils.isPerpetual(pair) ? commandExamplePerpetual : commandExample;

    // Verify parameters

    // Name : type to parse and verify
    const paramMap = {
      // price: 'positive number | '/market/i' | undefined',
    };

    if (type === 'buy') {
      paramMap.quote = 'positive number';
    } else {
      paramMap.amount = 'positive number';
    }

    for (const paramName of Object.keys(paramMap)) {
      const param = parsedParams[paramName];
      const verify = utils.verifyParam(paramName, param, paramMap[paramName], true);

      if (!verify.success) {
        return formSendBackMessage(`Wrong arguments. ${verify.message}. ${commandExampleDepending}.`);
      }

      parsedParams[paramName + 'Parsed'] = verify.parsed;
    }

    if (!parsedParams.xorAmounts) {
      return formSendBackMessage(`Specify order volume either in _quote_, or in _amount_. ${commandExampleDepending}.`);
    }

    const amountType = parsedParams.amountType; // 'amount' | 'quote'
    const qty = parsedParams.qty; // amountOrQuote

    const isConfirmed = parsedParams.isConfirmed;

    // Validate price
    let price = parsedParams['price']?.toLowerCase() || 'market';

    if (price !== 'market') {
      price = +price;

      if (!utils.isPositiveNumber(price)) {
        return formSendBackMessage(`Set correct order price or specify 'price=market'. ${commandExampleDepending}.`);
      }
    }

    // Perpetual params
    // WARNING: We don't validate them currently
    const reduceOnly = parsedParams['reduceonly'] || false;
    const timeInForce = parsedParams['timeinforce'];
    const takeProfitPrice = +parsedParams['takeprofitprice'];
    const stopLossPrice = +parsedParams['stoplossprice'];
    const smpType = parsedParams['smptype'];

    // Choose API

    let api;

    if (formattedPair.perpetual) {
      api = perpetualApi; // Currently, orderCollector checks if a contract and uses perpetualApi then independent of this param
    } else if (parsedParams.useSecondAccount) {
      if (traderapi2) {
        api = traderapi2;
      } else {
        return formSendBackMessage(`The second trader account is not set. Remove the _-2_ option to run the command for the first account. ${commandExampleDepending}.`);
      }
    } else {
      api = traderapi;
    }

    // Validate market price order

    if (price === 'market') {
      if (!api.features().placeMarketOrder) {
        return formSendBackMessage(`Placing Market orders on ${config.exchangeName} via API is not supported.`);
      }

      // Buy follows quote, sell follows amount
      if (!api.features()?.allowAmountForMarketBuy) {
        if (
          type === 'buy' && amountType === 'amount' ||
          type === 'sell' && amountType === 'quote'
        ) {
          return formSendBackMessage(`When placing Market order on ${config.exchangeName}, buy follows _quote_, sell follows _amount_. ${commandExampleDepending}.`);
        }
      }

      // Amount in coin1 is necessary for both buy and sell
      if (api.features()?.amountForMarketOrderNecessary) {
        if (amountType !== 'amount') {
          return formSendBackMessage(`When placing Market order on ${config.exchangeName}, _amount_ is necessary. ${commandExampleDepending}.`);
        }
      }
    }

    // Formatted pair

    const coin1 = formattedPair.coin1;
    const coin2 = formattedPair.coin2;
    const coin1Decimals = formattedPair.coin1Decimals;
    const coin2Decimals = formattedPair.coin2Decimals;

    // Calculate order volume in USD

    const totalUSD = amountType === 'amount' ?
        exchangerUtils.convertCryptos(coin1, 'USD', qty).outAmount :
        exchangerUtils.convertCryptos(coin2, 'USD', qty).outAmount;

    const totalUsdString = utils.formatNumber(totalUSD.toFixed(0), true);

    // Ask confirmation

    if (totalUSD >= config.amount_to_confirm_usd && !isConfirmed) {
      setPendingConfirmation(`/${type} ${params.join(' ')}`);

      let confirmationMessage = '';

      const amountCalculated = amountType === 'amount' ?
          qty :
          Number(exchangerUtils.convertCryptos(coin2, coin1, qty).outAmount.toFixed(coin1Decimals));

      const quoteCalculated = amountType === 'quote' ?
          qty :
          Number(exchangerUtils.convertCryptos(coin1, coin2, qty).outAmount.toFixed(coin2Decimals));

      if (price === 'market') {
        if (amountType === 'amount') {
          // buy 100 ADM (worth ~999 USD) for ~1000 USDT at Market price
          // sell 100 ADM (worth ~999 USD) for ~1000 USDT at Market price
          confirmationMessage += `Are you sure to ${type} ${qty} ${coin1} (worth ~${totalUsdString} USD) for ~${quoteCalculated} ${coin2} at _Market_ price on ${pair}?`;
        } else {
          // buy ~100 ADM for 1000 USDT (worth ~999 USD) at Market price
          // sell ~100 ADM for 1000 USDT (worth ~999 USD) at Market price
          confirmationMessage += `Are you sure to ${type} ~${amountCalculated} ${coin1} for ${qty} ${coin2} (worth ~${totalUsdString} USD) at _Market_ price on ${pair}?`;
        }
      } else {
        confirmationMessage += `Are you sure to place an order to ${type} ${amountCalculated} ${coin1} (worth ~${totalUsdString} USD) for _${quoteCalculated}_ ${coin2} at ${price} ${coin2} price on ${pair}?`;

        const marketPrice = exchangerUtils.convertCryptos(coin1, coin2, 1).exchangePrice;
        const priceDifference = utils.numbersDifferencePercentDirectNegative(marketPrice, price);

        if (
          (priceDifference < -20 && type === 'buy') ||
          (priceDifference > 20 && type === 'sell')
        ) {
          confirmationMessage += `\n\n**Warning: ${type} price is ${Math.abs(priceDifference).toFixed(0)}% ${marketPrice > price ? 'less' : 'greater'} than market**.`;
        }
      }

      confirmationMessage += '\n\nConfirm with **/y** command or ignore.';

      return formSendBackMessage(confirmationMessage);
    }

    return {
      amount: amountType === 'amount' ? qty : undefined,
      quote: amountType === 'quote' ? qty : undefined,
      price,
      pair,
      formattedPair,
      api,
      reduceOnly,
      timeInForce,
      takeProfitPrice,
      stopLossPrice,
      smpType,
    };
  } catch (e) {
    log.error(`Error in parseBuySellParams() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Executor for /buy and /sell commands on spot or contract trading pair
 * @param {Object} params Parsed command parameters
 * @param {'buy' | 'sell'} type Order type
 * @returns {CommandReply}
 */
async function buy_sell(params, type) {
  let paramsInfo = `type=${type}, amount=${params?.amount}, quote=${params?.quote}, price=${params?.price}, pair=${params?.pair}, formattedPair=(${Boolean(params?.formattedPair)}), api=(${Boolean(params?.api)})`;

  if (params?.formattedPair?.perpetual) {
    paramsInfo += `, reduceOnly=${params?.reduceOnly}, takeProfitPrice=${params?.takeProfitPrice}, stopLossPrice=${params?.stopLossPrice}, timeInForce=${params?.timeInForce}, smpType=${params?.smpType}`;
  }

  try {
    if (params.msgSendBack) {
      return params; // Confirmation or error message
    }

    const isMarketOrder = params.price === 'market';

    const result = await orderUtils.addGeneralOrder(
        type,
        params.pair,
        isMarketOrder ? null : params.price,
        params.amount,
        isMarketOrder ? 0 : 1,
        params.quote,
        'man',
        params.api,
        {
          reduceOnly: params.reduceOnly,
          timeInForce: params.timeInForce,
          stopLossPrice: params.stopLossPrice,
          takeProfitPrice: params.takeProfitPrice,
          smpType: params.smpType,
        },
    );

    let msgNotify; let msgSendBack;

    if (result !== undefined) {
      msgSendBack = result.message;

      if (result?._id) {
        msgNotify = `${config.notifyName}: ${result.message}`;
      }
    } else {
      const onWhichAccount = params.api?.isSecondAccount ? ' (on second account)' : '';

      msgSendBack = `Request to place an order${onWhichAccount} with params [${paramsInfo}] failed. It looks like an API temporary error. Try again.`;
      msgNotify = '';

      log.error(`Buy_sell command: ${msgSendBack}`);
    }

    return {
      msgNotify,
      msgSendBack,
      notifyType: 'log',
    };
  } catch (e) {
    log.error(`Error in buy_sell(${paramsInfo}) of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Message exchange's tradeParams
 * @returns {CommandReply}
 */
function params() {
  let output = `I am set to work with ${config.defaultPair} on ${config.exchangeName}. Current trading settings:`;
  output += utils.codeBlock(JSON.stringify(tradeParams, null, 2));

  return formSendBackMessage(output);
}

/**
 * Message basic bot information
 * @returns {CommandReply}
 */
function help(_, __, commandFix) {
  const marketType = config.perpetual ? 'perpetual contract' : 'spot market';
  const twoKeysInfo = traderapi2 && !config.perpetual ? ' **Working with two trading accounts**.' : '';

  const configParams = {
    'Exchange account': config.account,
    'Full bot name': config.bot_name,
    Version: config.version,
    'Repository name': config.projectName,
    'Repository branch': config.projectBranch,
    'Development mode': config.dev,
  };

  let output = `I am **online** and set to trade on ${config.defaultPair} ${marketType} on ${config.exchangeName}.${twoKeysInfo}`;
  output += '\nI do market-making, trade, and provide market information and statistics.';
  output += ' See the command reference on https://marketmaking.app/cex-mm/command-reference.';
  output += '\n\nSome parameters:';
  output += utils.codeBlock(JSON.stringify(configParams, null, 2));
  output += 'Happy trading!';

  if (commandFix === 'help') {
    output += '\n\nNote: commands start with slash **/**. Example: **/help**.';
  }

  return formSendBackMessage(output);
}

/**
 * Shows rates for a coin, trading pair, or a contract
 * @param {[string]} params Expected to receive a coin, trading pair, or a contract ticker
 * @returns {CommandReply}
 */
async function rates(params) {
  let output = '';
  const commandExample = `Try */pair ${config.defaultPair}* or */pair ${config.coin1}*`;

  try {
    // Check if we have a coin, trading pair, or a contract ticker

    const parsedParams = utils.parseCommandParams(params);

    if (parsedParams?.pairOrCoinErrored) {
      return formSendBackMessage(`Wrong market, perpetual contract ticker, or coin: '${parsedParams.paramString}'. ${commandExample}.`);
    }

    let coin;
    let pair = parsedParams?.pair;

    if (!pair) {
      coin = parsedParams?.possibleCoin;

      if (coin === config.coin1) {
        pair = config.defaultPair;
      }
    }

    if (!coin) {
      pair ??= config.defaultPair;
    }

    // Parse market/contract

    if (pair) {
      const formattedPair = orderUtils.parseMarket(pair);
      coin = formattedPair.coin1;

      if (!formattedPair) { // parseMarket returns false for contract, if perpetual is not enabled in the config
        return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
      }
    }

    // Form global Currencyinfo rates

    const CurrencyinfoRates = Object
        .keys(exchangerUtils.currencies)
        .filter((t) => t.startsWith(coin + '/'))
        .map((t) => {
          const quoteCoin = t.replace(coin + '/', '');
          const pair = `${coin}/**${quoteCoin}**`;
          const rate = utils.formatNumber(exchangerUtils.currencies[t].toFixed(constants.PRECISION_DECIMALS));
          return `${pair}: ${rate}`;
        })
        .join(', ');

    if (!CurrencyinfoRates.length) {
      output = `I can’t get global rates for ${coin} from Currencyinfo. Probably, Currencyinfo doesn't monitor the coin.`;
    } else {
      output = `Global market rates for ${coin}:\n${CurrencyinfoRates}.`;
    }

    if (pair) {
      const exchangeRatesInfo = await getExchangeRatesInfo(pair);
      output += '\n\n' + exchangeRatesInfo.ratesString;
    }
  } catch (e) {
    output = `Error in rates() of ${utils.getModuleName(module.id)} module: ${e}`;

    log.error(output);
  }

  return formSendBackMessage(output);
}

async function getDepositInfo(accountNo = 0, tx = {}, coin1) {
  let output = '';

  try {
    const api = accountNo === 0 ? traderapi : traderapi2;
    const depositAddresses = await api.getDepositAddress(coin1);

    if (depositAddresses?.length) {
      output = `The deposit addresses for ${coin1} on ${config.exchangeName}:\n${depositAddresses.map(({ network, address, memo }) => `${network ? `_${network}_: ` : ''}${address}${memo ? `, ${memo}` : ''}`).join('\n')}`;
    } else {
      output = `Unable to get a deposit addresses for ${coin1}.`;

      if (depositAddresses?.message) {
        output += ` Error: ${depositAddresses?.message}.`;
      } else if (api.features().createDepositAddressWithWebsiteOnly) {
        output += ` Note: ${config.exchangeName} don't create new deposit addresses via API. Create it manually with a website.`;
      }
    }
  } catch (e) {
    log.error(`Error in getDepositInfo() of ${utils.getModuleName(module.id)} module: ` + e);
  }

  return output;
}

/**
 * Cancel order
 * Format: /cancel [trading pair] {id}
 * Works both for Spot and for Contracts
 * @see https://marketmaking.app/cex-mm/command-reference#cancel
 * @param {[string]} params Command parameters
 * @returns {CommandReply}
 */
async function cancel(params) {
  const commandExample = 'Try: */cancel some-order-id*';

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    if (utils.isPerpetual(pair) && !perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    const formattedPair = orderUtils.parseMarket(pair);

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    const orderId = parsedParams?.more?.[0]?.param;
    if (!orderId) {
      return formSendBackMessage(`Order ID is required. ${commandExample}.`);
    }

    let api = traderapi;
    let onWhichAccount = '';

    if (formattedPair.perpetual) {
      api = perpetualApi; // Currently, checks if it's a contract and uses perpetualApi then independent of this param
    } else if (parsedParams.useSecondAccount) {
      if (traderapi2) {
        api = traderapi2;
        onWhichAccount = ' (on the second trade account)';
      } else {
        return formSendBackMessage('Second trader account is not set. Remove _-2_ option to run the command for the account 1.');
      }
    }

    // Cancel order

    const callerName = 'User command';
    const reasonToClose = 'Manual cancellation';

    let result;

    try {
      result = await orderCollector.clearOrderById(orderId, pair, undefined, callerName, reasonToClose, undefined, api);
    } catch (error) {
      return formSendBackMessage(`Error while cancelling order ${orderId}${onWhichAccount} on ${pair}: ${error}`);
    }

    let orderDbInfo = '';

    if (result.isOrderFoundInTheOrdersDb) {
      orderDbInfo = ' Note: This order was in the local order database:';
      delete result.order.db;
      orderDbInfo += utils.codeBlock(JSON.stringify(result.order, null, 2));
    } else {
      orderDbInfo = ` Note: Local order database didn't include this order.`;
    }

    if (result.isOrderCancelled) {
      return formSendBackMessage(`Order ${orderId}${onWhichAccount} is cancelled.${orderDbInfo}`);
    } else if (result.isCancelRequestProcessed) {
      const note = result.isOrderFoundInTheOrdersDb ?
          `Probably, it's already closed.${orderDbInfo}` :
          `Probably, it doesn't exist or already closed. Local order database didn't include this order either.`;
      return formSendBackMessage(`Unable to cancel order ${orderId}${onWhichAccount}. ${note}`);
    } else {
      return formSendBackMessage(`Unable to cancel order ${orderId}${onWhichAccount} on ${pair}: ${config.exchangeName} failed to process the request. Try again.${orderDbInfo}`);
    }
  } catch (e) {
    log.error(`Error in cancel() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Get order details
 * Format: /order [trading pair] {id}
 * Works both for Spot and for Contracts
 * @see https://marketmaking.app/cex-mm/command-reference#order
 * @param {[string]} params Command parameters
 * @returns {CommandReply}
 */
async function order(params) {
  const commandExample = 'Try: */order some-order-id*';

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 1);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    if (utils.isPerpetual(pair) && !perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    const formattedPair = orderUtils.parseMarket(pair);

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    const orderId = parsedParams?.more?.[0]?.param;
    if (!orderId) {
      return formSendBackMessage(`Order ID is required. ${commandExample}.`);
    }

    let api = traderapi;
    let onWhichAccount = '';

    if (formattedPair.perpetual) {
      api = perpetualApi; // Currently, checks if it's a contract and uses perpetualApi then independent of this param
    } else if (parsedParams.useSecondAccount) {
      if (traderapi2) {
        api = traderapi2;
        onWhichAccount = ' (on the second trade account)';
      } else {
        return formSendBackMessage('Second trader account is not set. Remove _-2_ option to run the command for the account 1.');
      }
    }

    // Get order details

    if (!api.getOrderDetails) {
      return formSendBackMessage(`A method to get order details is not implemented on ${config.exchangeName}.`);
    }

    let orderDetails;

    try {
      orderDetails = await api.getOrderDetails(orderId, pair);
    } catch (error) {
      return formSendBackMessage(`Error while receiving order ${orderId}${onWhichAccount} on ${pair}: ${error}`);
    }

    if (Object.keys(orderDetails)?.length > 3) {
      let output = `${config.exchangeName} order ${orderDetails.orderId}${onWhichAccount} details:`;
      output += utils.codeBlock(JSON.stringify(orderDetails, null, 2));
      output += 'Note: Pair may be wrong because of implementation specifics.';

      return formSendBackMessage(output);
    } else {
      return formSendBackMessage(`Unable to receive order ${orderId}${onWhichAccount} on ${pair} details. Does it exist?`);
    }
  } catch (e) {
    log.error(`Error in order() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

async function deposit(params, tx = {}) {
  let output = '';

  try {
    if (!params[0] || params[0].indexOf('/') !== -1) {
      output = 'Please specify coin to get a deposit address. F. e., */deposit ADM*.';
      return {
        msgNotify: '',
        msgSendBack: `${output}`,
        notifyType: 'log',
      };
    }

    if (!traderapi.features().getDepositAddress) {
      return {
        msgNotify: '',
        msgSendBack: 'The exchange doesn\'t support receiving a deposit address.',
        notifyType: 'log',
      };
    }

    const coin1 = params[0].toUpperCase();
    const account0DepositInfo = await getDepositInfo(0, tx, coin1);
    const account1DepositInfo = traderapi2 ? await getDepositInfo(1, tx, coin1) : undefined;
    output = account1DepositInfo ?
      account0DepositInfo.replace(`on ${config.exchangeName}`, `on ${config.exchangeName} (account 1)`) +
      '\n\n\n' + account1DepositInfo.replace(`on ${config.exchangeName}`, `on ${config.exchangeName} (account 2)`) :
      account0DepositInfo;
  } catch (e) {
    log.error(`Error in deposit() of ${utils.getModuleName(module.id)} module: ` + e);
  }

  return {
    msgNotify: '',
    msgSendBack: output,
    notifyType: 'log',
  };
}

async function stats(params) {
  let output = '';

  try {
    let pair = params[0];
    if (!pair) {
      pair = config.pair;
    }
    if (pair.indexOf('/') === -1 && !utils.isPerpetual(pair, 'USDT') && !utils.isPerpetual(pair, 'USDC') && !utils.isPerpetual(pair, 'USD')) {
      output = `Wrong pair '${pair}'. Try */stats ${config.pair}*.`;
      return {
        msgNotify: '',
        msgSendBack: `${output}`,
        notifyType: 'log',
      };
    }
    const pairObj = orderUtils.parseMarket(pair);
    const coin1 = pairObj.coin1;
    const coin2 = pairObj.coin2;
    const coin1Decimals = pairObj.coin1Decimals;
    const coin2Decimals = pairObj.coin2Decimals;

    // First, get exchange 24h stats on pair: volume, low, high, spread
    let exchangeRates;
    if (pairObj.perpetual) {
      exchangeRates = await perpetualApi.getTickerInfo(pairObj.pair);
    } else {
      exchangeRates = await traderapi.getRates(pairObj.pair);
    }

    const totalVolume24 = +exchangeRates?.volume;
    if (exchangeRates) {
      let volumeInCoin2String = '';
      if (exchangeRates.volumeInCoin2) {
        volumeInCoin2String = ` & ${utils.formatNumber(+exchangeRates.volumeInCoin2.toFixed(coin2Decimals), true)} ${coin2}`;
      }
      output += `${config.exchangeName} 24h stats for ${pairObj.pair} pair:`;
      let delta = exchangeRates.high-exchangeRates.low;
      let average = (exchangeRates.high+exchangeRates.low)/2;
      let deltaPercent = delta/average * 100;
      output += `\nVol: ${utils.formatNumber(+exchangeRates.volume.toFixed(coin1Decimals), true)} ${coin1}${volumeInCoin2String}.`;
      if (exchangeRates.low && exchangeRates.high) {
        output += `\nLow: ${exchangeRates.low.toFixed(coin2Decimals)}, high: ${exchangeRates.high.toFixed(coin2Decimals)}, delta: _${(delta).toFixed(coin2Decimals)}_ ${coin2} (${(deltaPercent).toFixed(2)}%).`;
      } else {
        output += '\nNo low and high rates available.';
      }
      delta = exchangeRates.ask-exchangeRates.bid;
      average = (exchangeRates.ask+exchangeRates.bid)/2;
      deltaPercent = delta/average * 100;
      output += `\nBid: ${exchangeRates.bid.toFixed(coin2Decimals)}, ask: ${exchangeRates.ask.toFixed(coin2Decimals)}, spread: _${(delta).toFixed(coin2Decimals)}_ ${coin2} (${(deltaPercent).toFixed(2)}%).`;
      if (exchangeRates.last) {
        output += `\nLast price: _${(exchangeRates.last).toFixed(coin2Decimals)}_ ${coin2}.`;
      }
    } else {
      output += `Unable to get ${config.exchangeName} stats for ${pairObj.pair}. Try again later.`;
    }

    // Second, get order book information
    const orderBook = await orderUtils.getOrderBookCached(pairObj.pair, utils.getModuleName(module.id), false, pairObj.perpetual);
    const orderBookInfo = utils.getOrderBookInfo(orderBook);
    if (orderBook && orderBookInfo) {
      const delta = orderBookInfo.smartAsk-orderBookInfo.smartBid;
      const average = (orderBookInfo.smartAsk+orderBookInfo.smartBid)/2;
      const deltaPercent = delta/average * 100;

      const bids2 = orderBookInfo.liquidity['percent2'].amountBidsQuote;
      const asks2 = orderBookInfo.liquidity['percent2'].amountAsks;
      const bidsFull = orderBookInfo.liquidity['full'].amountBidsQuote;
      const asksFull = orderBookInfo.liquidity['full'].amountAsks;

      const bidsPercent2 = bids2 / bidsFull * 100;
      const asksPercent2 = asks2 / asksFull * 100;

      const fairPrice2 = bids2 / asks2;
      const fairPriceFull = bidsFull / asksFull;

      output += '\n\n**Order book information**:\n\n';
      output += `Smart bid: ${orderBookInfo.smartBid.toFixed(coin2Decimals)}, smart ask: ${orderBookInfo.smartAsk.toFixed(coin2Decimals)}, smart spread: _${(delta).toFixed(coin2Decimals)}_ ${coin2} (${(deltaPercent).toFixed(2)}%).`;
      output += `\nFull depth (may be limited by exchange API): ${orderBookInfo.liquidity['full'].bidsCount} bids with ${utils.formatNumber(bidsFull.toFixed(coin2Decimals), true)} ${coin2}`;
      output += ` and ${orderBookInfo.liquidity['full'].asksCount} asks with ${utils.formatNumber(asksFull.toFixed(coin1Decimals), true)} ${coin1}.`;
      output += ` Fair price: _${utils.formatNumber(fairPriceFull.toFixed(coin2Decimals), true)}_ ${coin2}.`;
      output += `\nDepth ±2%: ${orderBookInfo.liquidity['percent2'].bidsCount} bids with ${utils.formatNumber(bids2.toFixed(coin2Decimals), true)} ${coin2} (${bidsPercent2.toFixed(2)}%)`;
      output += ` and ${orderBookInfo.liquidity['percent2'].asksCount} asks with ${utils.formatNumber(asks2.toFixed(coin1Decimals), true)} ${coin1} (${asksPercent2.toFixed(2)}%).`;
      if (fairPrice2) {
        output += ` Fair price: _${utils.formatNumber(fairPrice2.toFixed(coin2Decimals), true)}_ ${coin2}.`;
      }
    } else {
      output += `\n\nUnable to get ${config.exchangeName} order book information for ${pairObj.pair}. Try again later.`;
    }

    const mmDisabledNote = tradeParams.mm_isActive ? '' : ' [Note: currently market-making is disabled]';

    // Third, get target mm volume
    const currentDailyTradeVolume = exchangerUtils.estimateCurrentDailyTradeVolume();
    const currentDailyTradeVolumeString = `~${utils.formatNumber(currentDailyTradeVolume.coin1.toFixed(coin1Decimals), true)} ${coin1} (${utils.formatNumber(currentDailyTradeVolume.coin2.toFixed(coin2Decimals), true)} ${coin2})`;
    output += '\n\n**Target estimated market-making volume**:\n\n';

    if (tradeParams.mm_isActive) {
      if (tradeParams.mm_Policy === 'depth') {
        output += 'I work with **depth** market-making policy to maintain order books, and run no trades to move price or for volume.';
        output += ` If you'll change policy, with current parameters daily I will generate ${currentDailyTradeVolumeString}.`;
      } else {
        output += `With current parameters, daily I will generate ${currentDailyTradeVolumeString}`;
        if (tradeParams.mm_isPriceChangeVolumeActive) {
          output += ' plus additional volume by Price maker and Price watcher. Amount of additional volume depends on liquidity set with _/enable liq_ command.';
        } else {
          output += ', additional volume by Price maker and Price watcher is disabled.';
        }
      }
    } else {
      output += '**Market-making is disabled**.';
      output += ` If you'll enable it, with current parameters daily I will generate ${currentDailyTradeVolumeString}.`;
    }

    // Forth, get order statistics
    const { statList, statTotal } = await orderStats.getAllOrderStats(['mm', 'pm', 'pw', 'cl', 'qh', 'man'], pairObj.pair);

    const composeOrderStats = function(stats) {
      const composeLine = function(time, label) {
        if (stats[`coin1AmountTotal${time}Count`]) {
          const percentString = (totalVolume24 && time === 'Day') ? ` (${(stats[`coin1AmountTotal${time}`] / totalVolume24 * 100).toFixed(2)}%)` : '';
          return `\n${label || time} — ${stats[`coin1AmountTotal${time}Count`]} orders with ${utils.formatNumber(stats[`coin1AmountTotal${time}`].toFixed(coin1Decimals), true)} ${coin1} and ${utils.formatNumber(stats[`coin2AmountTotal${time}`].toFixed(coin2Decimals), true)} ${coin2}${percentString}`;
        } else {
          return `\n${label || time} — No orders`;
        }
      };

      let orderStatsString = `_${stats.purposeName}_:`;
      if (stats.coin1AmountTotalHourCount !== 0) {
        orderStatsString += composeLine('Hour');
      }
      if (stats.coin1AmountTotalDayCount > stats.coin1AmountTotalHourCount) {
        orderStatsString += composeLine('Day');
      }
      if (stats.coin1AmountTotalMonthCount > stats.coin1AmountTotalDayCount) {
        orderStatsString += composeLine('Month');
      }
      orderStatsString += composeLine('All', 'All time');
      return orderStatsString;
    };

    if (statTotal?.coin1AmountTotalAllCount > 0) {
      output += `\n\n**Executed order statistics**${mmDisabledNote}:`;
      statList.forEach((stats) => {
        output += `\n\n${composeOrderStats(stats)}`;
      });
      output += `\n\n${composeOrderStats(statTotal)}`;
    } else {
      output += `\n\nThe bot executed no orders on ${pairObj.pair} pair all time.`;
    }
  } catch (e) {
    log.error(`Error in stats() of ${utils.getModuleName(module.id)} module: ` + e);
  }

  return {
    msgNotify: '',
    msgSendBack: output,
    notifyType: 'log',
  };
}

/**
 * Shows trading pair or contract info
 * @param {[string]} params Expected to receive trading pair or contract ticker
 * @returns {CommandReply}
 */
async function pair(params) {
  let output = '';

  try {
    const parsedParams = utils.parseCommandParams(params);

    if (parsedParams?.pairErrored) {
      return formSendBackMessage(`Wrong market or perpetual contract ticker '${parsedParams.paramString}'. Try */pair ${config.defaultPair}*.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    let info;
    let type;

    if (utils.isPerpetual(pair)) {
      type = 'perpetual contract';

      if (!perpetualApi) {
        return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
      }

      if (!perpetualApi.features().getInstruments) {
        return formSendBackMessage(`${config.exchangeName} doesn't support receiving ${type} info.`);
      }

      info = perpetualApi.instrumentInfo(pair);
    } else {
      type = 'market';

      if (!traderapi.features().getMarkets) {
        return formSendBackMessage(`${config.exchangeName} doesn't support receiving ${type} info.`);
      }

      info = traderapi.marketInfo(pair);
    }

    if (!info) {
      return formSendBackMessage(`Unable to receive ${pair} ${type} info. Try */pair ${config.defaultPair}*.`);
    }

    output = `${config.exchangeName} reported these details on ${pair} ${type}:`;
    output += utils.codeBlock(JSON.stringify(info, null, 2));
  } catch (e) {
    output = `Error in pair() of ${utils.getModuleName(module.id)} module: ${e}`;

    log.error(output);
  }

  return formSendBackMessage(output);
}

/**
 * Helper to compose open order summary for accountNo
 * Stores them and compares to the previous request
 * @param {number} [accountNo=0] 0 is for the first trade account, 1 is for the second
 * @param {Object} tx Income ADM transaction for in-chat command
 * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
 * @returns Order details for an account
 */
async function composeOrderSummary(accountNo = 0, tx = {}, pair) {
  let output = '';

  const formattedPair = orderUtils.parseMarket(pair);
  const coin1 = formattedPair.coin1;
  const coin2 = formattedPair.coin2;
  const coin1Decimals = formattedPair.coin1Decimals;
  const coin2Decimals = formattedPair.coin2Decimals;

  const api = accountNo === 0 ? traderapi : traderapi2;
  const accountNoString = traderapi2 ? ` (account ${accountNo+1})` : '';

  const ordersByType = await orderStats.ordersByType(formattedPair.pair, api);
  const openOrders = await orderUtils.getOpenOrdersCached(formattedPair.pair, utils.getModuleName(module.id), false, api);

  let diffOrderCountString = '';
  let diffUnkOrderCountString = '';

  if (openOrders) {
    let diff; let sign;

    const prevOpenOrdersCount = previousOrders?.[accountNo]?.[tx.senderId]?.[formattedPair?.pair]?.openOrdersCount;

    if (prevOpenOrdersCount) {
      diff = openOrders.length - prevOpenOrdersCount;
      sign = diff > 0 ? '+' : '−';
      diff = Math.abs(diff);
      if (diff) diffOrderCountString = ` (${sign}${diff})`;
    }

    ordersByType.openOrdersCount = openOrders.length;
    ordersByType.unkLength = openOrders.length - ordersByType['all'].allOrders.length;

    const prevUnkOpenOrdersCount = previousOrders?.[accountNo]?.[tx.senderId]?.[formattedPair?.pair]?.unkLength;

    if (prevUnkOpenOrdersCount) {
      diff = ordersByType.unkLength - prevUnkOpenOrdersCount;
      sign = diff > 0 ? '+' : '−';
      diff = Math.abs(diff);
      if (diff) diffUnkOrderCountString = ` (${sign}${diff})`;
    }
  } else {
    output = `Unable to receive open orders on ${config.exchangeName} for ${formattedPair.pair}${accountNoString}. Try again.`;
  }

  /**
   * Calculates order count difference by purpose comparing to the previous request
   * @param {string} purpose Type of orders to calc order count difference
   * @returns {string}
   */
  const getDiffString = function(purpose) {
    let diff; let sign;
    let diffString = '';

    const prevPurposeOrderCount = previousOrders?.[accountNo]?.[tx.senderId]?.[formattedPair.pair]?.[purpose]?.allOrders.length;
    const curPurposeOrderCount = ordersByType[purpose].allOrders.length;

    if (prevPurposeOrderCount >= 0) {
      diff = curPurposeOrderCount - prevPurposeOrderCount;
      sign = diff > 0 ? '+' : '−';
      diff = Math.abs(diff);
      if (diff) diffString = ` (${sign}${diff})`;
    }

    return diffString;
  };

  /**
   * Creates a string showing amounts for bids and asks aggregated by purpose
   * @param {string} purpose Type of orders
   * @returns {string}
   */
  const getAmountsString = function(purpose) {
    let amountsString = '';

    const quote = ordersByType[purpose].buyOrdersQuote;
    const amount = ordersByType[purpose].sellOrdersAmount;

    if (quote || amount) {
      amountsString = ` — ${quote.toFixed(coin2Decimals)} ${coin2} buys & ${amount.toFixed(coin1Decimals)} ${coin1} sells`;
    }
    return amountsString;
  };

  // Compose "Orders in my database"

  if (ordersByType?.['all']?.allOrders?.length > 0) {
    output += '\n\nOrders in my database:';

    Object.keys(ordersByType).forEach((purpose) => { // Handles also indexed purposes like 'ld2'
      if (ordersByType[purpose].purposeName) { // Skip additional fields like ordersByType.openOrdersCount
        const purposeString = `${ordersByType[purpose].purposeName}`;
        const count = ordersByType[purpose].allOrders.length;

        output += `\n${purposeString} _${purpose}_: ${count}${getDiffString(purpose)}${getAmountsString(purpose)},`;
      }
    });

    output = utils.trimAny(output, ',') + '.';
  } else {
    output += '\n\n' + 'No open orders in my database.';
  }

  output += `\n\nOrders which are not in my database (Unknown orders _unk_): ${ordersByType.unkLength}${diffUnkOrderCountString}.`;

  // Store open orders as previous for the new request

  previousOrders[accountNo][tx.senderId] = {};
  previousOrders[accountNo][tx.senderId][formattedPair.pair] = ordersByType;

  return {
    count: openOrders?.length,
    diffOrderCountString,
    output,
  };
}

/**
 * Helper to compose open order details of specific type for accountNo
 * @param {number} [accountNo=0] 0 is for the first trade account, 1 is for the second
 * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
 * @param {string} purpose Type of orders to list, e.g., 'ld' or 'man'
 * @param {''|string} moduleIndexString When working with several module instances, e.g., ladder1 and ladder2. It's '' for the first instance, or e.g., '2'.
 * @param {boolean} fullInfo Show full order info, with additional fields, e.g., order date
 * @returns {{ count: number, output: string }} List of open orders of specific type
 */
async function composeOrdersDetails(accountNo = 0, pair, purpose, moduleIndexString, fullInfo) {
  let output = '';

  const formattedPair = orderUtils.parseMarket(pair);

  const api = accountNo === 0 ? traderapi : traderapi2;

  let ordersByType = await orderStats.ordersByType(formattedPair.pair, api, false);
  const purposeIndexed = `${purpose}${moduleIndexString}`; // E.g., 'ld2' or 'man'
  ordersByType = ordersByType[purposeIndexed].allOrders; // Both buy and sell for the purpose

  if (ordersByType.length) {
    ordersByType.sort((a, b) => b.price - a.price);

    for (const order of ordersByType) {
      const amountString = order.coin1Amount?.toFixed(formattedPair.coin1Decimals);
      const quoteString = +order.coin2Amount?.toFixed(formattedPair.coin2Decimals);
      const priceString = order.price?.toFixed(formattedPair.coin2Decimals);

      if (purpose === 'ld') {
        output += `${utils.padTo2Digits(order.ladderIndex)} `;
      }

      const gainInfo = order.gainIndex ? ` with +${order.gainIndex} gain` : '';

      output += `${order.type} ${amountString} ${order.coin1} @${priceString} for ${quoteString} ${order.coin2}${gainInfo} `;

      if (purpose === 'ld') {
        output += `| ${order.ladderState} `;
      }

      if (fullInfo) {
        if (purpose === 'ld') {
          if (order.ladderNotPlacedReason) {
            output += `(${order.ladderNotPlacedReason}) `;
          }
        }

        output += `| ${utils.formatDate(new Date(order.date))} | ${order._id}`;
      }

      output += '\n';
    }

    output = utils.codeBlock(output);
  }

  return {
    count: ordersByType.length,
    output,
  };
}

/**
 * Get open order list or their details
 * Works both for Spot and Contracts
 * Format: /orders [trading pair] [type] {full}
 * @see https://marketmaking.app/cex-mm/command-reference#orders
 * @param {[string]} params Command parameters
 * @param {Object} tx Income ADM transaction for in-chat command
 * @returns {CommandReply}
 */
async function orders(params, tx = {}) {
  const commandExample = `Try: */orders ${config.defaultPair} man full*`;

  try {
    // Parse parameters

    const parsedParams = utils.parseCommandParams(params);

    if (!parsedParams) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const pair = parsedParams?.pair || config.defaultPair;

    if (utils.isPerpetual(pair) && !perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    const formattedPair = orderUtils.parseMarket(pair);

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    const showFull = parsedParams.is('full');
    const detailsPurpose = parsedParams.purpose;
    const moduleIndexString = parsedParams.moduleIndexString;

    // Get open order list or their details

    let orderList;
    let output = '';
    let caption;
    let accountNoString;

    const accountNumber = traderapi2 ? 2 : 1;

    if (detailsPurpose) {
      for (let i=1; i <= accountNumber; i++) {
        orderList = await composeOrdersDetails(i-1, pair, detailsPurpose, moduleIndexString, showFull);

        accountNoString = traderapi2 ? ` (account ${i})` : '';

        caption = orderList.count ?
            `${config.exchangeName} ${detailsPurpose}${moduleIndexString}-orders for ${formattedPair.pair}${accountNoString}: ${orderList.count}.` :
            `No ${detailsPurpose}${moduleIndexString}-orders opened on ${config.exchangeName} for ${formattedPair.pair}${accountNoString}.\n`;

        output += caption + orderList.output;
      }
    } else {
      for (let i=1; i <= accountNumber; i++) {
        orderList = await composeOrderSummary(i-1, tx, pair);

        accountNoString = traderapi2 ? ` (account ${i})` : '';

        if (orderList.count !== undefined) { // May be 0
          output += `${config.exchangeName} open orders for ${formattedPair.pair}${accountNoString}: ${orderList.count}${orderList.diffOrderCountString}.`;
        }

        output += orderList.output + '\n';
      }
    }

    return formSendBackMessage(output);
  } catch (e) {
    const errorDetails = `Error in orders() of ${utils.getModuleName(module.id)} module: ${e}`;

    log.error(errorDetails);

    return formSendBackMessage(`Unable to process the command, try again later. ${errorDetails}`);
  }
}

/**
 * Makes a price with buy or sell order of type 'man'
 * @param {Array} params Command parameters to parse
 * @param {Object} tx Income ADM transaction
 * @param {Boolean} isWebApi Other messages if isWebApi true
 * @returns Notification messages
 */
async function make(params, tx, isWebApi = false) {
  // make price 1.1 COIN2 now — buy/sell to achieve target price of 1.1 COIN2
  try {

    let msgNotify; let msgSendBack; let actionString; let priceString;

    const param = (params[0] || '').trim();
    if (!param || !['price'].includes(param)) {
      msgSendBack = 'Indicate option:\n';
      msgSendBack += `\n_price_ to buy/sell to achieve target price: */make price 1.1 ${config.coin2}.`;
      return {
        msgNotify: '',
        msgSendBack,
        notifyType: 'log',
      };
    }

    if (param === 'price') {
      try {
        let priceInfoString = '';

        const pairObj = orderUtils.parseMarket(config.pair);
        const pair = pairObj.pair;
        const coin1 = pairObj.coin1;
        const coin2 = pairObj.coin2;
        const coin1Decimals = pairObj.coin1Decimals;
        const coin2Decimals = pairObj.coin2Decimals;

        const currencies = exchangerUtils.currencies;
        const coin1Rates = Object
            .keys(currencies)
            .filter((t) => t.startsWith(coin1 + '/'))
            .map((t) => {
              const p = `${coin1}/**${t.replace(coin1 + '/', '')}**`;
              return `${p}: ${currencies[t]}`;
            })
            .join(', ');

        if (!coin1Rates.length) {
          if (!pair) {
            priceInfoString = `I can’t get rates for *${coin1} from Infoservice*.`;
          }
        } else {
          priceInfoString = `Global market rates for ${coin1}:\n${coin1Rates}.`;
        }

        if (priceInfoString) {
          priceInfoString += '\n\n';
        }

        const exchangeRatesBeforeInfo = await getExchangeRatesInfo(pair);
        const exchangeRatesBefore = exchangeRatesBeforeInfo.exchangeRates;

        if (exchangeRatesBeforeInfo.success) {
          priceInfoString += exchangeRatesBeforeInfo.ratesString;
        } else {
          return {
            msgNotify: '',
            msgSendBack: `${exchangeRatesBeforeInfo.ratesString} Try again.`,
            notifyType: 'log',
          };
        }

        let targetPrice = params[1];
        targetPrice = +targetPrice;
        if (!utils.isPositiveNumber(targetPrice)) {
          return {
            msgNotify: '',
            msgSendBack: `Incorrect ${config.coin2} target price: ${targetPrice}. Example: */make price 1.1 ${config.coin2} now*.\n\n${priceInfoString}`,
            notifyType: 'log',
          };
        }

        const verifyCoin = params[2]?.toUpperCase();
        if (!verifyCoin || verifyCoin !== config.coin2) {
          return {
            msgNotify: '',
            msgSendBack: `You must set a price in ${config.coin2}. Example: */make price 1.1 ${config.coin2} now*.\n\n${priceInfoString}`,
            notifyType: 'log',
          };
        }

        const nowOrIn = params[3]?.toUpperCase();
        let dateString = '';
        if (!nowOrIn || !['NOW'].includes(nowOrIn)) {
          return {
            msgNotify: '',
            msgSendBack: `Specify when to achieve target price of ${targetPrice.toFixed(coin2Decimals)} ${coin2}. Example: */make price 1.1 ${config.coin2} now*.\n\n${priceInfoString}`,
            notifyType: 'log',
          };
        } else if (nowOrIn === 'NOW') {
          dateString = 'now';
        }

        let isConfirmed = params[params.length-1];
        if (['-y', '-Y'].includes(isConfirmed)) {
          isConfirmed = true;
        } else {
          isConfirmed = false;
        }

        /*
          Set amount to buy or sell
          reliabilityKoef: we must be sure that we'll fill all orders in the order book,
            as users/bot can add more orders while filling these orders.
            Moreover, we should place counter-order to set new spread.
            This will not work using 2-keys trading, as we have to cancel this order to avoid SELF_TRADE later
        */
        const reliabilityKoef = utils.randomValue(1.05, 1.1);
        const orderBook = await orderUtils.getOrderBookCached(config.pair, utils.getModuleName(module.id), true);
        const orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent, targetPrice);
        orderBookInfo.amountTargetPrice *= reliabilityKoef;
        orderBookInfo.amountTargetPriceQuote *= reliabilityKoef;

        let priceBefore; let priceChangeSign;
        if (orderBookInfo.typeTargetPrice === 'buy') {
          priceBefore = exchangeRatesBefore.ask;
          priceChangeSign = '+';
        } else {
          priceBefore = exchangeRatesBefore.bid;
          priceChangeSign = '–';
        }
        const priceChange = utils.numbersDifferencePercent(priceBefore, targetPrice);
        priceString = `${config.pair} price of ${targetPrice.toFixed(coin2Decimals)} ${config.coin2} from ${priceBefore.toFixed(coin2Decimals)} ${config.coin2}`;
        priceString += ` (${priceChangeSign}${priceChange.toFixed(2)}%)`;
        priceString += ` ${dateString}`;

        if (orderBookInfo.typeTargetPrice === 'inSpread') {
          return {
            msgNotify: '',
            msgSendBack: `${priceString} is already in spread. **No action needed**.\n\n${priceInfoString}`,
            notifyType: 'log',
          };
        } else {
          actionString = `${orderBookInfo.typeTargetPrice} ${orderBookInfo.amountTargetPrice.toFixed(coin1Decimals)} ${config.coin1} ${orderBookInfo.typeTargetPrice === 'buy' ? 'with' : 'for'} ${orderBookInfo.amountTargetPriceQuote.toFixed(coin2Decimals)} ${config.coin2}`;
        }

        if (tradeParams.mm_Policy === 'depth') {
          // With depth mm policy, other conditions apply
          if (nowOrIn === 'NOW') {
            params[3] = 'NOW'; // case insensitive
            const makeIn1min = params.join(' ').replace('NOW', 'in 1 min');
            return {
              msgNotify: '',
              msgSendBack: `You can't make price _now_ with _depth_ mm policy policy. Try to _/make ${makeIn1min}_.\n\n${priceInfoString}`,
              notifyType: 'log',
            };
          }
        }

        const whichAccount = traderapi2 ? ' (using second account)' : '';
        const pw = require('../trade/mm_price_watcher');

        if (isConfirmed) {
          if (nowOrIn === 'NOW') {
            // Not a depth mm policy, place pm-order to make price right now
            // If 2-keys trading, execute order with key2 not to SELF_TRADE
            const order = await orderUtils.addGeneralOrder(orderBookInfo.typeTargetPrice, config.pair, targetPrice,
                orderBookInfo.amountTargetPrice, 1, orderBookInfo.amountTargetPriceQuote, 'pm', traderapi2);

            if (order?._id) {
              // After we place an order, notify about price changes
              setTimeout(async () => {
                priceInfoString = '';

                const exchangeRatesAfter = await traderapi.getRates(pair);
                if (exchangeRatesAfter) {
                  priceInfoString += `${config.exchangeName} rates for ${pair} pair:\nBefore action — bid: ${exchangeRatesBefore.bid.toFixed(coin2Decimals)}, ask: ${exchangeRatesBefore.ask.toFixed(coin2Decimals)}.`;
                  priceInfoString += `\nAfter action — bid: ${exchangeRatesAfter.bid.toFixed(coin2Decimals)}, ask: ${exchangeRatesAfter.ask.toFixed(coin2Decimals)}`;
                  priceInfoString += ' [May be not actual if cached by exchange].';
                } else {
                  priceInfoString += `Unable to get ${config.exchangeName} rates for ${pair}.`;
                }

                msgNotify = `${config.notifyName}: Making ${priceString}: Successfully placed an order${whichAccount} to *${actionString}*.\n\n${priceInfoString}`;
                msgSendBack = `Making ${priceString}: Successfully placed an order${whichAccount} to **${actionString}**.\n\n${priceInfoString}`;

                notify(msgNotify, 'log');

                if (!isWebApi) {
                  api.sendMessage(config.passPhrase, tx.senderId, msgSendBack).then((response) => {
                    if (!response.success) {
                      log.warn(`Failed to send ADM message '${msgSendBack}' to ${tx.senderId}. ${response.errorMessage}.`);
                    }
                  });
                }
              }, 7000); // If exchange doesn't cache rates, 7 sec is enough to update

              // If 2-keys trading, make sure we'll clear placed order not to SELF_TRADE later
              if (traderapi2) {
                const reasonToClose = 'Avoid SELF_TRADE';
                await orderCollector.clearOrderById(
                    order, order.pair, order.type, 'User command', reasonToClose, undefined, traderapi2);
              }
            } else {
              // Unable to place pm-order
              msgNotify = '';
              msgSendBack = `Unable to make ${priceString}. The order to ${actionString} failed: it's likely not enough funds${traderapi2 ? ', a SELF_TRADE error,' : ''} or a temporary API error. Check balances and try again.\n\n${priceInfoString}`;
            }
          }
        } else {
          // Ask for confirmation
          msgNotify = '';
          let pwWarning = ' ';

          if (tradeParams.mm_Policy === 'depth') {
            msgSendBack = `Are you sure to make ${priceString}? With _depth_ policy, **I'll update Price watcher and manage order book to allow other users move the price, and also act as a taker**.`;
            msgSendBack = isWebApi ? msgSendBack : `${msgSendBack} Confirm with **/y** command or ignore.\n\n${priceInfoString}`;
          } else {
            // Not a depth mm policy, ask for a regular confirmation
            if (tradeParams.mm_isPriceWatcherActive) {
              if (tradeParams.mm_priceWatcherSource.indexOf('@') > -1) {
                pwWarning = `\n\n**Warning: The price watcher is enabled and ${pw.getPwInfoString()}.**`;
                pwWarning += ' Disable the price watcher or ensure it will not interfere with making a price.';
                pwWarning += '\n\n';
              } else {
                let targetPriceInSourceCoin;

                if (tradeParams.mm_priceWatcherSource === config.coin2) {
                  targetPriceInSourceCoin = targetPrice;
                } else {
                  targetPriceInSourceCoin = exchangerUtils.convertCryptos(
                      config.coin2, tradeParams.mm_priceWatcherSource, targetPrice).outAmount;
                }

                if (targetPriceInSourceCoin) {
                  const pwLowPriceInSourceCoinPrev = tradeParams.mm_priceWatcherLowPriceInSourceCoin;
                  const pwHighPriceInSourceCoinPrev = tradeParams.mm_priceWatcherHighPriceInSourceCoin;

                  if (
                    targetPriceInSourceCoin < pwLowPriceInSourceCoinPrev ||
                    targetPriceInSourceCoin > pwHighPriceInSourceCoinPrev
                  ) {
                    pwWarning = `\n\n**Warning: Target price ${targetPrice.toFixed(coin2Decimals)} ${config.coin2} is out of Pw ${pw.getPwInfoString()}.**`;
                    if (nowOrIn === 'NOW') {
                      pwWarning += ' If you confirm, the bot will restore a price then.';
                      pwWarning += ' If you don\'t want Price watcher to interfere, update its range with _/enable pw_ command first.';
                    } else {
                      pwWarning += ' If you confirm, the bot will extend Price watcher\'s range.';
                    }
                    pwWarning += '\n\n';
                  }
                }
              }
            }

            let actionNoteString = '';
            if (nowOrIn === 'NOW') {
              actionNoteString = 'I am going to';
            } else {
              actionNoteString = '[Upon current order book] I\'ll';
            }
            msgSendBack = isWebApi ? `Are you sure to make ${priceString}? ${actionNoteString} **${actionString}**.${pwWarning}` : `Are you sure to make ${priceString}? ${actionNoteString} **${actionString}**.${pwWarning}Confirm with **/y** command or ignore.\n\n${priceInfoString}`;
          }

          setPendingConfirmation(`/make ${params.join(' ')}`);
        }
      } catch (e) {
        log.error(`Error in make()-price of ${utils.getModuleName(module.id)} module: ${e}`);
      }
    } // if (param === "price")

    return {
      msgNotify,
      msgSendBack,
      notifyType: 'log',
    };

  } catch (e) {
    log.error(`Error in make() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Get info on coin withdrawal information and networks
 * @param {Array} params Command parameters to parse
 * @param {Object} tx Income ADM transaction
 * @param {Boolean} isWebApi If isWebApi true, messages can be different
 * @returns Notification messages
 * @returns {Promise<void>}
 */
async function info(params, tx, isWebApi = false) {
  try {
    const coin = params[0]?.toUpperCase() || '';
    if (coin?.length < 2) {
      return {
        msgNotify: '',
        msgSendBack: 'Specify coin to get withdrawal information and networks. Example: */info USDT*.',
        notifyType: 'log',
      };
    }

    if (traderapi.features().getCurrencies && traderapi.currencies) {
      await traderapi.getCurrencies(coin, true);

      const currency = await traderapi.currencyInfo(coin);
      if (!currency) {
        return {
          msgNotify: '',
          msgSendBack: `It seems ${config.exchangeName} doesn't have _${coin}_ coin. Try */info USDT*.`,
          notifyType: 'log',
        };
      }

      let msgSendBack = `_${coin}_ on ${config.exchangeName} info:\n`;
      msgSendBack += coinInfoString(currency);

      return {
        msgNotify: '',
        msgSendBack,
        notifyType: 'log',
      };
    }

    return {
      msgNotify: '',
      msgSendBack: `It seems ${config.exchangeName} doesn't provide info about coins.`,
      notifyType: 'log',
    };
  } catch (e) {
    log.error(`Error in info() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

async function calc(params, tx, isWebApi = false) {
  let output = '';
  try {

    if (params.length !== 4) {
      return {
        msgNotify: '',
        msgSendBack: 'Wrong arguments. Command works like this: */calc 2.05 BTC in USDT*.',
        notifyType: 'log',
      };
    }

    const amount = +params[0];
    const inCurrency = params[1].toUpperCase().trim();
    const outCurrency = params[3].toUpperCase().trim();
    const pair = inCurrency + '/' + outCurrency;
    const pair2 = outCurrency + '/' + inCurrency;

    if (!utils.isPositiveOrZeroNumber(amount)) {
      output = `Wrong amount: _${params[0]}_. Command works like this: */calc 2.05 BTC in USD*.`;
      return {
        msgNotify: '',
        msgSendBack: `${output}`,
        notifyType: 'log',
      };
    }
    if (!exchangerUtils.hasTicker(inCurrency)) {
      output = `I don’t have rates of crypto *${inCurrency}* from Infoservice. Made a typo? Try */calc 2.05 BTC in USDT*.`;
    }
    if (!exchangerUtils.hasTicker(outCurrency)) {
      output = `I don’t have rates of crypto *${outCurrency}* from Infoservice. Made a typo? Try */calc 2.05 BTC in USDT*.`;
    }

    let result;
    if (!output) {
      result = exchangerUtils.convertCryptos(inCurrency, outCurrency, amount).outAmount;
      if (!utils.isPositiveOrZeroNumber(result)) {
        output = `Unable to calc _${params[0]}_ ${inCurrency} in ${outCurrency}.`;
        return {
          msgNotify: '',
          msgSendBack: `${output}`,
          notifyType: 'log',
        };
      }

      const precision = exchangerUtils.isFiat(outCurrency) ? 2 : constants.PRECISION_DECIMALS;
      output = isWebApi ? utils.formatNumber(result.toFixed(precision), false) : `Global market value of ${utils.formatNumber(amount)} ${inCurrency} equals ${utils.formatNumber(result.toFixed(precision), true)} ${outCurrency}.`;
    } else {
      output = '';
    }

    if (output && !isWebApi) {
      output += '\n\n';
    }
    let askValue; let bidValue;

    let exchangeRates = await traderapi.getRates(pair);
    if (!isWebApi) {
      if (exchangeRates) {
        askValue = exchangeRates.ask * amount;
        bidValue = exchangeRates.bid * amount;
        output += `${config.exchangeName} value of ${utils.formatNumber(amount)} ${inCurrency}:\nBid: **${utils.formatNumber(bidValue.toFixed(8))} ${outCurrency}**, ask: **${utils.formatNumber(askValue.toFixed(8))} ${outCurrency}**.`;
      } else {
        exchangeRates = await traderapi.getRates(pair2);
        if (exchangeRates) {
          askValue = amount / exchangeRates.ask;
          bidValue = amount / exchangeRates.bid;
          output += `${config.exchangeName} value of ${utils.formatNumber(amount)} ${inCurrency}:\nBid: **${utils.formatNumber(bidValue.toFixed(8))} ${outCurrency}**, ask: **${utils.formatNumber(askValue.toFixed(8))} ${outCurrency}**.`;
        } else {
          output += `Unable to get ${config.exchangeName} rates for ${pair}.`;
        }
      }
    }

  } catch (e) {
    log.error(`Error in calc() of ${utils.getModuleName(module.id)} module: ` + e);
  }

  return {
    msgNotify: '',
    msgSendBack: output,
    notifyType: 'log',
  };
}

/**
 * Creates a string about coin info
 * @param {Object} coin
 * @return {String}
 */
function coinInfoString(coin) {
  const networksSupported = traderapi.features().supportCoinNetworks && typeof coin.networks === 'object' && Object.keys(coin.networks)?.length;

  let message = '';
  message += `Coin status is ${buildStatusString(coin)}${coin.comment ? ': ' + utils.trimAny(coin.comment, '. ') : ''}.`;
  if (coin.type) {
    message += ` Type: ${coin.type}.`;
  }
  if (coin.decimals) {
    message += ` Decimals: ${coin.decimals}, precision: ${coin.precision?.toFixed(coin.decimals)}.`;
  }
  message += '\n';

  if (!networksSupported) {
    message += coinNetworkInfoString(coin);

    if (traderapi.features().supportCoinNetworksRestricted) {
      message += `\nNote: Receiving coin networks on ${config.exchangeName} is of private API. Try _/deposit ${coin.symbol}_ to list supported networks.`;
    }
  } else {
    message += `Supported networks for _${coin.name}_:`;
    message += supportedNetworksString(coin);
  }

  return message;
}

/**
 * Creates a string with coin's network info
 * @param {Object} coinOrNetwork Coin or coin.networks[network]
 * @param {Object} coin Coin to get parent info for a network
 * @return String
 */
function coinNetworkInfoString(coinOrNetwork, coin) {
  let message = '';

  const confirmations = coinOrNetwork.confirmations || coin?.confirmations;
  if (confirmations) {
    message += `Deposit confirmations: ${confirmations}. `;
  }

  const symbol = coinOrNetwork.symbol || coin?.symbol;
  const withdrawalFee = coinOrNetwork.withdrawalFee ?? coin?.withdrawalFee;
  const withdrawalFeeCurrency = coinOrNetwork.withdrawalFeeCurrency || coin?.withdrawalFeeCurrency || symbol;
  const minWithdrawal = coinOrNetwork.minWithdrawal || coin?.minWithdrawal;
  const maxWithdrawal = coinOrNetwork.maxWithdrawal || coin?.maxWithdrawal;
  if (utils.isPositiveOrZeroNumber(withdrawalFee) || coinOrNetwork.minWithdrawal) {
    if (utils.isPositiveOrZeroNumber(withdrawalFee)) {
      message += `Withdrawal fee — ${withdrawalFee} ${withdrawalFeeCurrency}`;
    } else {
      message += 'Withdrawal fee — unknown';
    }
    if (minWithdrawal) {
      message += `, minimum amount to withdraw ${minWithdrawal} ${symbol}`;
    }
    if (coinOrNetwork.maxWithdrawal) {
      message += `, maximum ${maxWithdrawal} ${symbol}`;
    }
  }

  message = utils.trimAny(message, '. ');

  const decimals = coinOrNetwork.decimals || coin?.decimals;
  const precision = coinOrNetwork.precision || coin?.precision;

  if (decimals) {
    if (message) {
      message += '. ';
    }

    message += `Decimals: ${decimals}, precision: ${precision?.toFixed(decimals)}`;
  }

  message = message ? message + '.' : '';

  return message;
}

/**
 * Creates a coin/network status string
 * @param {Object} coin
 * @return String
 */
function buildStatusString(coinOrNetwork) {
  let statusString = '';
  statusString = coinOrNetwork.status === 'ONLINE' ? `${coinOrNetwork.status.toLowerCase()}` : `**${coinOrNetwork.status}**`;

  if (coinOrNetwork.depositStatus || coinOrNetwork.withdrawalStatus) {
    if (coinOrNetwork.status !== coinOrNetwork.depositStatus || coinOrNetwork.status !== coinOrNetwork.withdrawalStatus) {
      statusString += ` (deposits: ${coinOrNetwork.depositStatus}, withdrawals: ${coinOrNetwork.withdrawalStatus})`;
    }
  }

  return statusString;
}

/**
 * Creates a string from supported networks on exchange
 * @param {Object} coin
 * @return String
 */
function supportedNetworksString(coin) {
  let message = '';

  for (const network of Object.keys(coin.networks)) {
    const networkStatus = buildStatusString(coin.networks[network]);
    message += `\n+ _${network}_ is ${networkStatus}. `;
    message += coinNetworkInfoString(coin.networks[network], coin);
    message = utils.trimAny(message, '. ') + '.';
  }

  return message;
}

/**
 * Creates a string with balances information, looks like total-available-frozen for each crypto
 * Adds totalBTC, totalUSD, totalNonCoin1USD, totalNonCoin1BTC to balancesResponse object (mutates it)
 * @param {Object[] | { success: boolean, message: string } | undefined} balancesResponse Balances response from an exchange's API
 * @param {string} caption E.g., '${config.exchangeName} balances:'
 * @param {string[]} params First parameter: account type, e.g., main, trade, margin, or 'full'
 * @return {{string, Object}} String with balances information and mutated balancesResponse object with totalBTC, totalUSD, totalNonCoin1USD, totalNonCoin1BTC
 */
function balancesString(balancesResponse, caption, params) {
  let output = '';

  let totalBTC = 0; let totalUSD = 0;
  let totalNonCoin1BTC = 0; let totalNonCoin1USD = 0;

  const unknownCryptos = [];

  output = caption;

  if (!balancesResponse) {
    output += 'Unable to get account balances. Check API keys, or it may be a temporary error. See logs for details.';
  } else if (balancesResponse.message) {
    output += `Unable to get account balances: ${balancesResponse.message}`;
  } else if (balancesResponse.length === 0) {
    output += 'All empty.';
  } else {
    // Skip total-available-frozen for totals
    balancesResponse = balancesResponse.filter((crypto) => !['totalBTC', 'totalUSD', 'totalNonCoin1BTC', 'totalNonCoin1USD'].includes(crypto.code));

    // Create total-available-frozen string for each crypto in balancesResponse object
    // 29 528.7105 ADM (6 937.2207 available & 22 591.4898 frozen)
    balancesResponse.forEach((crypto) => {
      // In requested to show balances of special account/wallet type, e.g, margin wallet
      const accountTypeString = params?.[0] ? `[${crypto.accountType}] ` : '';

      output += `${accountTypeString}${utils.formCoinBalancesString(crypto, true)}\n`;

      let value;
      const skipUnknownCryptos = ['BTXCRD'];

      // Incrementally count Total holdings in USD
      if (utils.isPositiveOrZeroNumber(crypto.usd)) {
        totalUSD += crypto.usd;
        if (crypto.code !== config.coin1) totalNonCoin1USD += crypto.usd;
      } else {
        value = exchangerUtils.convertCryptos(crypto.code, 'USD', crypto.total).outAmount;

        if (utils.isPositiveOrZeroNumber(value)) {
          totalUSD += value;
          if (crypto.code !== config.coin1) totalNonCoin1USD += value;
        } else if (!skipUnknownCryptos.includes(crypto.code)) {
          unknownCryptos.push(crypto.code);
        }
      }

      // Incrementally count Total holdings in BTC
      if (utils.isPositiveOrZeroNumber(crypto.btc)) {
        totalBTC += crypto.btc;
        if (crypto.code !== config.coin1) totalNonCoin1BTC += crypto.btc;
      } else {
        value = exchangerUtils.convertCryptos(crypto.code, 'BTC', crypto.total).outAmount;

        if (utils.isPositiveOrZeroNumber(value)) {
          totalBTC += value;
          if (crypto.code !== config.coin1) totalNonCoin1BTC += value;
        }
      }
    });

    output += `Total holdings ~ ${utils.formatNumber(totalUSD.toFixed(2), true)} _USD_ or ${utils.formatNumber(totalBTC.toFixed(8), true)} _BTC_`;
    output += `\nTotal holdings (non-${config.coin1}) ~ ${utils.formatNumber(totalNonCoin1USD.toFixed(2), true)} _USD_ or ${utils.formatNumber(totalNonCoin1BTC.toFixed(8), true)} _BTC_`;

    if (unknownCryptos.length) {
      output += `. Note: I didn't count unknown cryptos ${unknownCryptos.join(', ')}.`;
    }

    output += '\n';

    // Add totals to balancesResponse object (mutates it)

    const totals = {
      totalUSD,
      totalBTC,
      totalNonCoin1USD,
      totalNonCoin1BTC,
    };

    Object.keys(totals).forEach((key) => {
      balancesResponse.push({
        code: key,
        total: totals[key],
      });
    });
  }

  return { output, balances: balancesResponse };
}

/**
 * Creates balance info string for an account, including balance difference from the previous request.
 * Note: Balance difference is only for the main trading account/wallet.
 * @param {number} accountNo 0 for the first account, 1 for the second one
 * @param {Object} tx [deprecated] Income ADM transaction to get senderId
 * @param {boolean} isWebApi If true, info messages will be different
 * @param {string[]} params First parameter: account type, like main, trade, margin, or 'full'
 * @param {string} userId senderId (or userId for WebUI). The bot stores previous balances for each user separately.
 * @return {string}
 */
async function getBalancesInfo(accountNo = 0, tx, isWebApi = false, params, userId) {
  let output = '';

  try {
    const walletType = params?.[0];
    const api = accountNo === 0 ? traderapi : traderapi2;
    const balancesResponse = await orderUtils.getBalancesCached(true, utils.getModuleName(module.id), false, walletType, api);

    let caption;
    const accountTypeString = walletType ? ` _${walletType}_ account/wallet` : '';
    if (traderapi2) {
      caption = `${config.exchangeName}${accountTypeString} balances (account ${accountNo+1}):\n`;
    } else {
      caption = `${config.exchangeName}${accountTypeString} balances:\n`;
    }

    const balancesObject = balancesString(balancesResponse, caption, params);
    output = balancesObject.output;
    const balancesWithTotals = balancesObject.balances;

    // Calculate balance difference from the previous request. Only for the main trading account/wallet.
    if (!isWebApi && !walletType) {
      output += utils.differenceInBalancesString(
          balancesWithTotals,
          previousBalances[accountNo][userId],
          orderUtils.parseMarket(config.pair),
      );

      previousBalances[accountNo][userId] = {
        timestamp: Date.now(),
        balances: balancesWithTotals,
      };
    }
  } catch (e) {
    log.error(`Error in getBalancesInfo() of ${utils.getModuleName(module.id)} module: ${e}`);
  }

  return output;
}

/**
 * Show account balance info
 * @param {Array} params First parameter: account type, like main, trade, margin, or 'full'.
 *   If undefined, will show balances for 'trade' account. If 'full', for all account types.
 *   Exchange should support features().accountTypes
 *   Note: Both account balances in case of two-keys trading will show only for 'trade'
 * @param {Object} tx Income ADM transaction for in-chat command
 * @param {Object} user User info for web
 * @param {Boolean} isWebApi If true, info messages will be different
 * @return {String}
 */
async function balances(params, tx, user, isWebApi = false) {
  let output = '';

  try {
    if (params?.[0]) {
      if (traderapi.features().accountTypes) {
        params[0] = params[0].toLowerCase();
      } else {
        params = {};
      }
    }

    const userId = isWebApi ? user.login : tx.senderId;

    // Get balances info for each account separately
    const account0Balances = await getBalancesInfo(0, tx, isWebApi, params, userId);
    const account1Balances = traderapi2 ? await getBalancesInfo(1, tx, isWebApi, params, userId) : undefined;

    output = account1Balances ? account0Balances + '\n\n' + account1Balances : account0Balances;

    // Get balances info combined for two accounts (commonBalances)
    if (account0Balances && account1Balances && !isWebApi && !params?.[0]) {
      const commonBalances = utils.sumBalances(previousBalances[0][userId]?.balances, previousBalances[1][userId]?.balances);

      output += balancesString(commonBalances, '\n\n**Both accounts**:\n').output;

      const diffString = utils.differenceInBalancesString(
          commonBalances,
          previousBalances[2][userId],
          orderUtils.parseMarket(config.pair),
      );

      if (diffString) {
        output += diffString;
      }

      previousBalances[2][userId] = { timestamp: Date.now(), balances: commonBalances };
    }

    return formSendBackMessage(output);
  } catch (e) {
    const errorDetails = `Error in balances() of ${utils.getModuleName(module.id)} module: ${e}`;

    log.error(errorDetails);

    return formSendBackMessage(`Unable to process the command, try again later. ${errorDetails}`);
  }
}

async function getAccountInfo(accountNo = 0, tx, isWebApi = false) {
  const paramString = `accountNo: ${accountNo}, tx: ${tx}, isWebApi: ${isWebApi}`;

  let output = '';

  try {
    const api = accountNo === 0 ? traderapi : traderapi2;

    if (traderapi.features().getTradingFees) {
      const feesBTC = config.pair === 'BTC/USDT' ? [] : await api.getFees('BTC/USDT');
      const feesCoin2 = await api.getFees(config.coin1);

      const fees = [...feesBTC, ...feesCoin2];

      if (traderapi2) {
        output += `${config.exchangeName} trading fees (account ${accountNo+1}):\n`;
      } else {
        output += `${config.exchangeName} trading fees:\n`;
      }

      fees.forEach((pair) => {
        output += `_${pair.pair}_: maker ${utils.formatNumber(pair.makerRate, true)}, taker ${utils.formatNumber(pair.takerRate, true)}`;
        if (pair.takerRateStable && pair.takerRateCrypto) {
          output += `, taker-stable ${utils.formatNumber(pair.takerRateStable, true)}`;
          output += `, taker-crypto ${utils.formatNumber(pair.takerRateCrypto, true)}`;
        }
        output += '\n';
      });
      output += '\n';

    } else {
      output += `${config.exchangeName}'s API doesn't provide trading fees information.\n\n`;
    }

    if (traderapi.features().getAccountTradeVolume) {
      const tradingVolume = await api.getVolume();

      if (traderapi2) {
        output += `${config.exchangeName} 30-days trading volume (account ${accountNo+1}): `;
      } else {
        output += `${config.exchangeName} 30-days trading volume: `;
      }

      output += `${utils.formatNumber(tradingVolume?.volume30days, true)}`;
      output += tradingVolume?.volumeUnit ? ` ${tradingVolume?.volumeUnit}` : '';
      output += tradingVolume?.updated ? ` as on ${tradingVolume?.updated}.` : '.';

    } else {
      output += `${config.exchangeName}'s API doesn't provide trading volume information.`;
    }

    if (TraderApi.exchangeAccounts) {
      const { accountType, accountTypeAll, isMasterAccount, uid } = TraderApi.exchangeAccounts;

      output += '\n\n';
      if (isMasterAccount) {
        output += `Account is main (not a subaccount).\nType (default trading wallet): ${accountType}.\nAccounts (wallets): ${accountTypeAll.join(', ')}.\nUID: ${uid}.`;
      } else {
        output += `It's a sub-account (not a main account).\nType (default trading wallet): ${accountType}.\nAccounts (wallets): ${accountTypeAll.join(', ')}.\nUID: ${uid}.`;
      }
    }
  } catch (e) {
    log.error(`Error in getAccountInfo(${paramString}) of ${utils.getModuleName(module.id)} module: ${e}`);
    output = 'Error while receiving account information. Try again later.';
  }

  return output;
}

async function account(_, tx, isWebApi = false) {
  let output = '';

  try {

    if (traderapi.features().getTradingFees || traderapi.features().getAccountTradeVolume) {
      const account0Info = await getAccountInfo(0, tx, isWebApi);
      const account1Info = traderapi2 ? await getAccountInfo(1, tx, isWebApi) : undefined;
      output = account1Info ? account0Info + '\n\n' + account1Info : account0Info;
    } else {
      output = `${config.exchangeName}'s API doesn't provide account information.`;
    }

  } catch (e) {
    log.error(`Error in account() of ${utils.getModuleName(module.id)} module: ` + e);
  }

  return {
    msgNotify: '',
    msgSendBack: output,
    notifyType: 'log',
  };
}

function version() {
  return {
    msgNotify: '',
    msgSendBack: `I am running on _adamant-tradebot_ software version _${config.version}_. Revise code on ADAMANT's GitHub.`,
    notifyType: 'log',
  };
}

function volume() {
  return {
    msgNotify: '',
    msgSendBack: 'This is a stub.',
    notifyType: 'log',
  };
}

/**
 * Get orderbook
 * @param {string[]} params Param list
 * @returns {Promise<{msgNotify: string, msgSendBack: string, notifyType: string}>}
 */
async function orderbook(params) {
  const DEFAULT_DEPTH = 10;
  const MAX_DEPTH = 30;

  const commandExample = `Try: */orderbook ADM/USDT ${DEFAULT_DEPTH}*`;

  // Parse command params

  const parsedParams = utils.parseCommandParams(params, 0);

  const depthParam = parsedParams?.more?.[0];
  const depth = depthParam?.param ?? DEFAULT_DEPTH;

  const verify = utils.verifyParam('depth', depth, 'positive integer');

  if (!verify.success || depth > MAX_DEPTH) {
    return formSendBackMessage(`Wrong arguments. ${verify.message ? verify.message + '. ' : ''}A range between 1–${MAX_DEPTH} is allowed. ${commandExample}.`);
  }

  // Verify pair/contract

  const pair = parsedParams?.pair || config.defaultPair;

  if (utils.isPerpetual(pair) && !perpetualApi) {
    return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
  }

  const formattedPair = orderUtils.parseMarket(pair);

  if (!formattedPair?.isParsed) {
    return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}.`);
  }

  // Choose API

  let type;
  let orderBook;
  let api;

  if (formattedPair.perpetual) {
    type = 'perpetual contract';
    api = perpetualApi;
  } else {
    type = 'spot market';
    api = traderapi;
  }

  // Get order book

  try {
    orderBook = await api.getOrderBook(pair);
  } catch (error) {
    return formSendBackMessage(`Error while receiving orderbook for ${pair} ${type}: ${error}`);
  }

  const orderBookInfo = utils.getOrderBookInfo(orderBook);

  // Output table

  if (orderBook?.asks && orderBook?.bids) {
    const { coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;

    const result = {};

    result.asks = orderBook.asks.slice(0, depth).reverse();
    result.bids = orderBook.bids.slice(0, depth);

    const tableHeader = ['#', 'Type', `Price ${coin2}`, `Amount ${coin1}`, `Quote ${coin2}`, '~USD', `Cum (${coin1}/${coin2})`];

    const tableContent = [
      ...result.asks
          .map((ask, index) => [
            result.asks.length - 1 - index,
            'Ask',
            ask.price,
            ask.amount,
            (ask.price * ask.amount).toFixed(coin2Decimals),
            exchangerUtils.convertCryptos(coin1, 'USD', ask.amount).outAmount.toFixed(2),
            orderBookInfo.cumulative.asks[result.asks.length - 1 - index].amount.toFixed(coin1Decimals),
          ]),
      ['---', '---', '---', '---', '---', '---', '---'],
      ...result.bids
          .map((bid, index) => [
            index,
            'Bid',
            bid.price,
            bid.amount,
            (bid.price * bid.amount).toFixed(coin2Decimals),
            exchangerUtils.convertCryptos(coin2, 'USD', bid.price * bid.amount).outAmount.toFixed(2),
            orderBookInfo.cumulative.bids[index].quote.toFixed(coin2Decimals),
          ]),
    ];

    let output = `Orderbook for ${pair}@${config.exchangeName} ${type}:\n`;
    output += `\`\`\`\n` + utils.generateTable(tableHeader, tableContent); + `\n\`\`\``;

    return formSendBackMessage(output);
  } else {
    return formSendBackMessage(`Unable to get orderbook for ${pair} ${type}. Check params and try again.`);
  }
}

/**
 * Get trades
 * @param {string[]} params Param list
 * @returns {Promise<{msgNotify: string, msgSendBack: string, notifyType: string}>}
 */
async function trades(params) {
  const DEFAULT_RECORDS = 10;
  const MAX_RECORDS = 30;

  const commandExample = `Example: */trades ADM/USDT ${DEFAULT_RECORDS}*`;

  // Parse command params

  const parsedParams = utils.parseCommandParams(params, 0);

  const recordsParam = parsedParams?.more?.[0];
  const records = recordsParam?.param ?? DEFAULT_RECORDS;

  const verify = utils.verifyParam('records', records, 'positive integer');

  if (!verify.success || records > MAX_RECORDS) {
    return formSendBackMessage(`Wrong arguments. ${verify.message ? verify.message + '. ' : ''}A range between 1–${MAX_RECORDS} is allowed. ${commandExample}.`);
  }

  // Verify pair/contract

  const pair = parsedParams?.pair || config.defaultPair;

  if (utils.isPerpetual(pair) && !perpetualApi) {
    return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
  }

  const formattedPair = orderUtils.parseMarket(pair);

  if (!formattedPair?.isParsed) {
    return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}.`);
  }

  const { coin1, coin2, coin2Decimals } = formattedPair;

  let type;
  let trades;

  if (formattedPair.perpetual) {
    type = 'perpetual contract';

    trades = await perpetualApi.getPublicTradeHistory(pair);
  } else {
    type = 'spot market';

    trades = await traderapi.getTradesHistory(pair);
  }

  if (!trades) {
    return formSendBackMessage(`Unable to get trades for ${pair} ${type}. Check params and try again.`);
  } else if (!trades.length) {
    return formSendBackMessage(`There were no trades for ${pair} ${type} yet.`);
  } else {
    const result = trades
        .sort((a, b) => b.date - a.date)
        .slice(0, records)
        .map((trade) => {
          trade.coin2Amount = trade.coin2Amount.toFixed(coin2Decimals);
          trade.date = utils.formatDate(new Date(trade.date));

          if (trade.type === 'buy') {
            trade.usd = exchangerUtils.convertCryptos(coin1, 'USD', trade.coin1Amount).outAmount.toFixed(2);
          } else {
            trade.usd = exchangerUtils.convertCryptos(coin2, 'USD', trade.price * trade.coin1Amount).outAmount.toFixed(2);
          }

          return trade;
        });

    const tableHeader = ['Date', 'Type', `Price ${coin2}`, `Amount ${coin1}`, `Quote ${coin2}`, '~USD'];
    const tableContent = [
      ...result.map((trade) => [trade.date, trade.type, trade.price, trade.coin1Amount, trade.coin2Amount, trade.usd]),
    ];

    let output = `Public trades for ${pair}@${config.exchangeName} ${type}:\n`;
    output += `\`\`\`\n` + utils.generateTable(tableHeader, tableContent); + `\n\`\`\``;

    return formSendBackMessage(output);
  }
}

/**
 * Get ticker
 * @param {string[]} params Param list
 * @returns {Promise<{msgNotify: string, msgSendBack: string, notifyType: string}>}
 */
async function ticker(params) {
  const commandExample = `Try */ticker ${config.defaultPair}*`;

  const parsedParams = utils.parseCommandParams(params, 0);

  if (parsedParams?.pairErrored) {
    return formSendBackMessage(`Wrong market or perpetual contract ticker '${parsedParams.paramString}'. ${commandExample}.`);
  }

  const { pair = config.pair } = parsedParams;

  let type;
  let ticker;

  if (utils.isPerpetual(pair)) {
    type = 'perpetual contract';

    if (!perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    ticker = await perpetualApi.getTickerInfo(pair);
  } else {
    type = 'spot market';

    ticker = await traderapi.getRates(pair);
  }

  if (ticker?.high && ticker?.low) {
    let output = `Ticker data for ${pair}@${config.exchangeName} ${type}:\n`;
    output += `\`\`\`\n` + `${JSON.stringify(ticker, null, 2)}` + `\n\`\`\``;

    return formSendBackMessage(output);
  } else {
    return formSendBackMessage(`Unable to get ticker data for ${pair} ${type}. Check params and try again.`);
  }
}

const aliases = {
  // Balances for all bots
  rbalances: () => ('/remote balances all'),
  rba: () => ('/remote balances all'),
  rb: () => ('/remote balances all'),
  // Orders for all bots
  roa: () => ('/remote orders all'),
  ro: () => ('/remote orders all'),
  // Clean unknown orders for all bots
  rcua: () => ('/remote clear unk all'),
  rcu: () => ('/remote clear unk all'),
  // Price watcher for all bots
  epwa: (params) => (`/remote enable pw ${params.join(' ')} {QUOTE_COIN} all`),
  epw: (params) => (`/remote enable pw ${params.join(' ')} {QUOTE_COIN} all`),
  // Make price for all bots
  rmpa: (params) => (`/remote make price ${params?.[0]} {QUOTE_COIN} ${params?.slice(1)?.join(' ')} all`),
  rmp: (params) => (`/remote make price ${params?.[0]} {QUOTE_COIN} ${params?.slice(1)?.join(' ')} all`),
  // Stop price maker for all bots (no confirmation)
  rmpas: () => ('/remote make price stop all -y'),
  rmps: () => ('/remote make price stop all -y'),
  // Support price for all bots
  rspa: (params) => (`/remote enable sp ${params.join(' ')} {QUOTE_COIN} all`),
  rsp: (params) => (`/remote enable sp ${params.join(' ')} {QUOTE_COIN} all`),
  // Start and stop all the bots
  rstopy: () => ('/remote stop mm all -y'),
  rstart: () => ('/remote start mm all'),

  b: (params) => (`/balances ${params.join(' ')}`),

  o: (params) => (`/orders ${params.join(' ')}`),

  position: (params) => (`/positions ${params.join(' ')}`),
  pp: (params) => (`/positions ${params.join(' ')}`),
  p: (params) => (`/positions ${params.join(' ')}`),
};

const commands = {
  help,
  rates,
  stats,
  pair,
  orders,
  calc,
  balances,
  account,
  version,
  start,
  stop,
  buypercent,
  amount,
  interval,
  clear,
  fill,
  params,
  buy,
  sell,
  enable,
  disable,
  cancel,
  deposit,
  order,
  make,
  y,
  volume,
  info,
  saveConfig: utils.saveConfig,
  orderbook,
  trades,
  ticker,
};

module.exports.commands = commands;
