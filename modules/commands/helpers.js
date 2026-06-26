'use strict';

/**
 * @module modules/commands/helpers
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/bot/commandTxs.d.js').CoinRatesInfoResult} CoinRatesInfoResult
 * @typedef {import('types/bot/commandTxs.d.js').ExchangeRatesInfoResult} ExchangeRatesInfoResult
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 */

const {
  exchangerUtils, config, log, traderapi, perpetualApi, orderUtils, moduleName, utils, pendingConfirmation,
} = require('./context');

/**
 * Builds a {@link CommandReply} with only a user-facing message (no operator notification).
 *
 * @param {string} msgSendBack Reply to send back to the user
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
 * Builds a {@link CommandReply} with a user message and an operator notification.
 *
 * @param {string} msgSendBack Reply to send back to the user
 * @param {string} [msgNotify=''] Notification message for Slack/ADM/Telegram
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
 * Fetches global coin rates from the Currencyinfo service and formats a reply string.
 *
 * @param {string} coin Base coin symbol, e.g. `BTC`
 * @returns {CoinRatesInfoResult}
 */
function getCoinRatesInfo(coin) {
  const er = exchangerUtils.currencies;
  let ratesString;
  let success;

  try {
    const currencyinfoRates = Object
        .keys(er)
        .filter((t) => t.startsWith(coin + '/'))
        .map((t) => {
          const quoteCoin = t.replace(coin + '/', '');
          const pair = `${coin}/**${quoteCoin}**`;
          const rate = utils.toFixedMeaningful(er[t]);

          return `${pair}: ${rate}`;
        })
        .join(', ');

    if (!currencyinfoRates.length) {
      ratesString = `I can’t get global rates for ${coin} from Currencyinfo service. Probably, Currencyinfo doesn't monitor the coin.`;
      success = false;
    } else {
      ratesString = `Global market rates for ${coin}:\n${currencyinfoRates}.`;
      success = true;
    }
  } catch (e) {
    log.error(`commandTxs: Error in getCoinRatesInfo() of ${moduleName} module: ${e}`);

    ratesString = `Unable to process Currencyinfo rates for ${coin}: ${e}.`;
    success = false;
  }

  return {
    success,
    exchangeRates: er,
    ratesString,
  };
}


/**
 * Fetches bid/ask (and perpetual extras) for a spot pair or contract from the exchange API.
 *
 * @param {string} pairRaw Trading pair, e.g. `BTC/USDT`, or a perpetual contract id
 * @returns {Promise<ExchangeRatesInfoResult>}
 */
async function getExchangeRatesInfo(pairRaw) {
  let er; // exchangeRates
  let ratesString;
  let spreadString = '';
  let success;

  try {
    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pairRaw));
    const { pair, coin1, coin2, coin2Decimals, perpetual } = formattedPair;

    let type;

    if (perpetual) {
      type = 'perpetual contract';
      er = await perpetualApi.getTickerInfo(pair, true);
    } else {
      type = 'spot pair';
      er = await traderapi.getRates(pair);
    }

    if (er) {
      const delta = er.ask-er.bid;
      const average = (er.ask + er.bid)/2;
      const deltaPercent = delta/average * 100;

      spreadString = `Bid: ${utils.formatNumber(er.bid)}, ask: ${utils.formatNumber(er.ask)}, spread: **${utils.formatNumber(delta.toFixed(coin2Decimals))}** ${coin2} (**${(deltaPercent).toFixed(2)}%**).`;
      if (er.last) {
        spreadString += ` Last price: _${utils.formatNumber(er.last)}_ ${coin2}.`;
      }

      ratesString = `${config.exchangeName} rates for ${pair} ${type}:\n${spreadString}`;

      if (perpetual) {
        ratesString += `\nOpen interest: _${utils.formatNumber(er.openInterest)}_ ${coin1} (_${(utils.formatNumber(er.openInterestValue))}_ ${coin2}), funding rate: _${(er.fundingRate * 100).toFixed(6)}%_.`;
      }

      success = true;
    } else {
      ratesString = `Unable to get ${config.exchangeName} rates for ${pair} ${type}.`;
      success = false;
    }
  } catch (e) {
    log.error(`commandTxs: Error in getExchangeRatesInfo() of ${moduleName} module: ${e}`);

    ratesString = `Unable to process ${config.exchangeName} rates for ${pairRaw}: ${e}.`;
    success = false;
  }

  return {
    success,
    exchangeRates: er,
    ratesString,
    spreadString,
  };
}


/**
 * Queues a command for explicit `/y` confirmation (used by destructive or high-value actions).
 *
 * @param {string} command Full command text to execute after confirmation
 */
function setPendingConfirmation(command) {
  try {
    pendingConfirmation.command = command;
    pendingConfirmation.timestamp = Date.now();
    log.log(`commandTxs: Pending command to confirm: ${command}`);
  } catch (e) {
    log.error(`commandTxs: Error in setPendingConfirmation() of ${moduleName} module: ` + e);
  }
}


/**
 * Validates the lower bound of a trader amount range against the exchange minimum order size.
 *
 * @param {number} minAmount Lower bound of the trading amount range
 * @param {string} coin1 Base coin symbol
 * @param {string} commandExample Example command string for error replies
 * @returns {CommandReply | undefined} Error reply when validation fails
 */
function validateTraderMinAmount(minAmount, coin1, commandExample) {
  const minAmounts = orderUtils.getMinOrderAmount();

  if (minAmounts && minAmount < minAmounts.min) {
    return formSendBackMessage(
        `${minAmount} ${coin1} is below the minimum order amount of ${minAmounts.minFixed} ${coin1} set by the exchange. ${commandExample}.`,
    );
  }
}

module.exports = {
  formSendBackMessage,
  formSendBackAndNotify,
  getCoinRatesInfo,
  getExchangeRatesInfo,
  setPendingConfirmation,
  validateTraderMinAmount,
};
