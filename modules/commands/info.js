'use strict';

/**
 * @module modules/commands/info
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/bot/commandTxs.d.js').CommandTx} CommandTx
 */

const {
  constants, config, log, tradeParams, traderapi, perpetualApi, orderUtils,
  orderStats, moduleName, utils, exchangerUtils,
} = require('./context');
const { formSendBackMessage, getCoinRatesInfo, getExchangeRatesInfo } = require('./helpers');
const { composeOrderBookInfoString } = require('./compose');

/**
 * Shows rates for a coin, trading pair, or a contract
 * @param {string[]} params Expected to receive a coin, trading pair, or a contract ticker
 * @returns {Promise<CommandReply>}
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
      const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));
      coin = formattedPair.coin1;

      if (!formattedPair) { // parseMarket returns false for contract, if perpetual is not enabled in the config
        return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
      }
    }

    output += '\n\n' + getCoinRatesInfo(coin).ratesString;

    if (pair) {
      const exchangeRatesInfo = await getExchangeRatesInfo(pair);
      output += '\n\n' + exchangeRatesInfo.ratesString;
    }
  } catch (e) {
    output = `Error in rates() of ${moduleName} module: ${e}`;

    log.error(output);
  }

  return formSendBackMessage(output);
}


/**
 * Get orderbook
 * @param {string[]} params Param list
 * @returns {Promise<CommandReply>}
 */
async function orderbook(params) {
  const DEFAULT_DEPTH = 10;
  const MAX_DEPTH = 30;

  const commandExample = `Try: */orderbook ADM/USDT ${DEFAULT_DEPTH}*`;

  // Parse command params

  const parsedParams = utils.parseCommandParams(params, 0);

  const depthParam = parsedParams?.more?.[0];
  const depth = String(depthParam?.param ?? DEFAULT_DEPTH);

  const verify = utils.verifyParam('depth', depth, 'positive integer');

  if (!verify.success || Number(depth) > MAX_DEPTH) {
    return formSendBackMessage(`Wrong arguments. ${verify.message ? verify.message + '. ' : ''}A range between 1–${MAX_DEPTH} is allowed. ${commandExample}.`);
  }

  // Verify pair/contract

  const pair = parsedParams?.pair || config.defaultPair;

  if (utils.isPerpetual(pair) && !perpetualApi) {
    return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
  }

  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

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

  if (orderBookInfo) {
    const { coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;

    const result = {};

    result.asks = orderBook.asks.slice(0, depth).reverse();
    result.bids = orderBook.bids.slice(0, depth);

    // Build purpose lookup maps from bot orders in DB

    const askPurposeMap = new Map();
    const bidPurposeMap = new Map();

    try {
      const ordersByPurpose = await orderStats.ordersByPurpose(pair, api);
      const allBotOrders = ordersByPurpose?.['all']?.allOrders || [];

      for (const order of allBotOrders) {
        const map = order.side === 'sell' ? askPurposeMap : bidPurposeMap;
        const moduleIndex = order.moduleIndex || 1;
        const purposeKey = moduleIndex > 1 ? `${order.purpose}${moduleIndex}` : order.purpose;

        let purposeStr = purposeKey;
        if (order.subPurpose) {
          purposeStr += ` ${order.subPurpose}`;
          if (order.subType) {
            purposeStr += `, ${order.subType}`;
          }
        }

        const priceKey = +order.price.toFixed(coin2Decimals);
        const existing = map.get(priceKey);
        if (existing) {
          if (!existing.includes(purposeStr)) {
            existing.push(purposeStr);
          }
        } else {
          map.set(priceKey, [purposeStr]);
        }
      }
    } catch (e) {
      log.warn(`commandTxs/orderbook: Unable to build purpose map for ${pair}: ${e}`);
    }

    /**
     * Returns purpose string for a given side and price, or empty string if no bot order matches
     * @param {'ask'|'bid'} side
     * @param {number} price
     * @returns {string}
     */
    const getPurpose = (side, price) => {
      const map = side === 'ask' ? askPurposeMap : bidPurposeMap;
      return map.get(+price.toFixed(coin2Decimals))?.join(' / ') || '';
    };

    const tableHeader = ['#', 'Type', 'Purpose', `Price ${coin2}`, `Amount ${coin1}`, `Quote ${coin2}`, '~USD', `Cum (${coin1}/${coin2})`];

    const tableContent = [
      ...result.asks
          .map((ask, index) => [
            result.asks.length - 1 - index,
            'Ask',
            getPurpose('ask', ask.price),
            ask.price,
            ask.amount,
            (ask.price * ask.amount).toFixed(coin2Decimals),
            exchangerUtils.convertCryptos(coin1, 'USD', ask.amount).outAmount.toFixed(2),
            orderBookInfo.cumulative.asks[result.asks.length - 1 - index].amount.toFixed(coin1Decimals),
          ]),
      ['---', '---', '---', '---', '---', '---', '---', '---'],
      ...result.bids
          .map((bid, index) => [
            index,
            'Bid',
            getPurpose('bid', bid.price),
            bid.price,
            bid.amount,
            (bid.price * bid.amount).toFixed(coin2Decimals),
            exchangerUtils.convertCryptos(coin2, 'USD', bid.price * bid.amount).outAmount.toFixed(2),
            orderBookInfo.cumulative.bids[index].quote.toFixed(coin2Decimals),
          ]),
    ];

    let output = `Orderbook for ${pair}@${config.exchangeName} ${type}:\n`;
    output += `\`\`\`\n` + utils.generateTable(tableHeader, tableContent) + `\n\`\`\``;

    return formSendBackMessage(output);
  } else {
    return formSendBackMessage(`Unable to get orderbook for ${pair} ${type}. Check params and try again.`);
  }
}


/**
 * Get trades
 * @param {string[]} params Param list
 * @returns {Promise<CommandReply>}
 */
async function trades(params) {
  const DEFAULT_RECORDS = 10;
  const MAX_RECORDS = 30;

  const commandExample = `Example: */trades ADM/USDT ${DEFAULT_RECORDS}*`;

  // Parse command params

  const parsedParams = utils.parseCommandParams(params, 0);

  const recordsParam = parsedParams?.more?.[0];
  const records = String(recordsParam?.param ?? DEFAULT_RECORDS);

  const verify = utils.verifyParam('records', records, 'positive integer');

  if (!verify.success || Number(records) > MAX_RECORDS) {
    return formSendBackMessage(`Wrong arguments. ${verify.message ? verify.message + '. ' : ''}A range between 1–${MAX_RECORDS} is allowed. ${commandExample}.`);
  }

  // Verify pair/contract

  const pair = parsedParams?.pair || config.defaultPair;

  if (utils.isPerpetual(pair) && !perpetualApi) {
    return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
  }

  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

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

          if (trade.side === 'buy') {
            trade.usd = exchangerUtils.convertCryptos(coin1, 'USD', trade.coin1Amount).outAmount.toFixed(2);
          } else {
            trade.usd = exchangerUtils.convertCryptos(coin2, 'USD', trade.price * trade.coin1Amount).outAmount.toFixed(2);
          }

          return trade;
        });

    const tableHeader = ['Date', 'Side', `Price ${coin2}`, `Amount ${coin1}`, `Quote ${coin2}`, '~USD'];
    const tableContent = [
      ...result.map((trade) => [trade.date, trade.side, trade.price, trade.coin1Amount, trade.coin2Amount, trade.usd]),
    ];

    let output = `Public trades for ${pair}@${config.exchangeName} ${type}:\n`;
    output += `\`\`\`\n` + utils.generateTable(tableHeader, tableContent) + `\n\`\`\``;

    return formSendBackMessage(output);
  }
}


/**
 * Get ticker
 * @param {string[]} params Param list
 * @returns {Promise<CommandReply>}
 */
async function ticker(params) {
  const commandExample = `Try */ticker ${config.defaultPair}*`;

  const parsedParams = utils.parseCommandParams(params, 0);

  if (parsedParams?.pairErrored) {
    return formSendBackMessage(`Wrong market or perpetual contract ticker '${parsedParams.paramString}'. ${commandExample}.`);
  }

  const { pair = config.defaultPair } = parsedParams;

  let type;
  let ticker;

  if (utils.isPerpetual(pair)) {
    type = 'perpetual contract';

    if (!perpetualApi) {
      return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
    }

    ticker = await perpetualApi.getTickerInfo(pair, true);
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


/**
 * Get market statistics: 24h ticker, order book depth, estimated trading volume, and executed order stats
 * @param {string[]} params Param list; optionally accepts a trading pair or perpetual contract ticker
 * @returns {Promise<CommandReply>}
 */
async function stats(params) {
  const commandExample = `Try */stats ${config.defaultPair}*`;

  // Parse command params

  const parsedParams = utils.parseCommandParams(params, 0);

  if (parsedParams?.pairErrored) {
    return formSendBackMessage(`Wrong market or perpetual contract ticker '${parsedParams.paramString}'. ${commandExample}.`);
  }

  // Verify pair/contract

  const pair = parsedParams?.pair || config.defaultPair;

  if (utils.isPerpetual(pair) && !perpetualApi) {
    return formSendBackMessage(`Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);
  }

  const pairObj = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

  if (!pairObj?.isParsed) {
    return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}.`);
  }

  const { coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = pairObj;

  const isDefaultPair = pair === config.defaultPair;

  let output = '';

  try {
    // Section 1: 24h ticker — volume, low/high range, bid/ask spread, last price

    let exchangeRates;

    if (pairObj.perpetual) {
      exchangeRates = await perpetualApi.getTickerInfo(pairObj.pair, true);
    } else {
      exchangeRates = await traderapi.getRates(pairObj.pair);
    }

    const totalVolume24 = +exchangeRates?.volume;

    if (exchangeRates) {
      output += `${config.exchangeName} 24h stats for ${pairObj.pair} pair:\n`;

      let volumeInCoin2String = '';
      if (exchangeRates.volumeInCoin2) {
        volumeInCoin2String = ` & ${utils.formatNumber(+exchangeRates.volumeInCoin2.toFixed(coin2DecimalsForStable), true)} ${coin2}`;
      }

      let delta = exchangeRates.high - exchangeRates.low;
      let average = (exchangeRates.high + exchangeRates.low) / 2;
      let deltaPercent = delta / average * 100;

      output += `\nVol: ${utils.formatNumber(+exchangeRates.volume.toFixed(coin1Decimals), true)} ${coin1}${volumeInCoin2String}.`;

      if (exchangeRates.low && exchangeRates.high) {
        output += `\nLow: ${exchangeRates.low.toFixed(coin2Decimals)}, high: ${exchangeRates.high.toFixed(coin2Decimals)}, delta: _${(delta).toFixed(coin2Decimals)}_ ${coin2} (${(deltaPercent).toFixed(2)}%).`;
      } else {
        output += '\nNo low and high rates available.';
      }

      delta = exchangeRates.ask - exchangeRates.bid;
      average = (exchangeRates.ask + exchangeRates.bid) / 2;
      deltaPercent = delta / average * 100;

      output += `\nBid: ${exchangeRates.bid.toFixed(coin2Decimals)}, ask: ${exchangeRates.ask.toFixed(coin2Decimals)}, spread: **${(delta).toFixed(coin2Decimals)}** ${coin2} (**${(deltaPercent).toFixed(2)}%**).`;

      if (exchangeRates.last) {
        output += `\nLast price: _${(exchangeRates.last).toFixed(coin2Decimals)}_ ${coin2}.`;
      }
    } else {
      output += `Unable to get ${config.exchangeName} stats for ${pairObj.pair}. Try again later.`;
    }

    // Section 2: Order book — smart spread, full depth, ±2% depth, fair price

    const obInfoString = await composeOrderBookInfoString(pairObj.pair);
    if (obInfoString) {
      output += '\n\n**Order book information**:\n\n';
      output += obInfoString;
    } else {
      output += `\n\nUnable to get ${config.exchangeName} order book information for ${pairObj.pair}. Try again later.`;
    }

    // Section 3: Target estimated daily trading volume from mm_trader parameters

    const isMmEnabled = tradeParams.mm_isActive;
    const isTraderEnabled = isMmEnabled && tradeParams.mm_isTraderActive;

    const mmDisabledNote = isMmEnabled ? '' : ' [Note: Market-Making is disabled]';

    if (isDefaultPair) {
      const currentDailyTradeVolumeString = `~${exchangerUtils.getVolumeInfoString(exchangerUtils.estimateCurrentDailyTradeVolume())}`;

      output += '\n\n**Target estimated trading volume**:\n\n';

      if (isTraderEnabled) {
        if (tradeParams.mm_Policy === 'depth') {
          // In depth policy the trader only maintains order books — no trades are generated for volume
          output += 'I am currently using the **depth** trading policy to maintain the order book, without executing trades for price movement or volume generation.';
          output += ` If you switch the policy, I will generate ${currentDailyTradeVolumeString} per day with the current parameters.`;
        } else {
          output += `With the current parameters, I generate ${currentDailyTradeVolumeString} per day`;
          if (tradeParams.mm_isPriceChangeVolumeActive) {
            output += ' plus extra volume from the Price Maker and Price Watcher. The amount depends on the liquidity set with the _/enable liq_ command.';
          } else {
            output += ', and extra volume from the Price Maker and Price Watcher is disabled.';
          }
        }
      } else {
        output += '_Trader module is disabled_.';
        output += ` If you enable it, I will generate ${currentDailyTradeVolumeString} per day with the current parameters.`;
      }
    }

    // Section 4: Executed order statistics per purpose and totals

    if (isDefaultPair) {
      // 'pm', 'pw', 'cl', 'qh', 'man' fills currently aren't processed via fillsEngine.processFills() and not marked as isExecuted
      const { statList, statTotal } = await orderStats.getAllOrderStats(['t', 'ld', 'liq'], pairObj.pair);

      /**
       * Compose a human-readable order stats block for a single purpose or totals
       * @param {object} stats Result item from getAllOrderStats()
       * @returns {string}
       */
      const composeOrderStats = function(stats) {
        /**
         * Format a single time-range line; omits the line if the count is 0
         * @param {'Hour'|'Day'|'Month'|'All'} time Stats accumulation period key
         * @param {string} [label] Display label override (defaults to time)
         * @returns {string}
         */
        const composeLine = function(time, label) {
          if (stats[`coin1AmountTotal${time}Count`]) {
            // Show % of 24h exchange volume only for the Day period
            const percentString = (totalVolume24 && time === 'Day') ? ` (${(stats[`coin1AmountTotal${time}`] / totalVolume24 * 100).toFixed(2)}%)` : '';
            return `\n${label || time} — ${stats[`coin1AmountTotal${time}Count`]} orders with ${utils.formatNumber(stats[`coin1AmountTotal${time}`].toFixed(coin1Decimals), true)} ${coin1} and ${utils.formatNumber(stats[`coin2AmountTotal${time}`].toFixed(coin2DecimalsForStable), true)} ${coin2}${percentString}`;
          } else {
            return `\n${label || time} — No orders`;
          }
        };

        let orderStatsString = `_${stats.purposeName} (${stats.purpose})_:`;

        if (stats.coin1AmountTotalHourCount) {
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
        output += `\n\nThe bot has not executed any orders on the ${pairObj.pair} pair so far.`;
      }
    }

    // Section 5: Additional notes

    if (isDefaultPair) {
      output += '\n\n**Notes**:';
      output += `\n\nTo view liquidity stats, use the _/orders liq full_ command.`;
    }
  } catch (e) {
    log.error(`commandTxs: Error in stats() of ${moduleName} module: ${e}`);
  }

  return formSendBackMessage(output);
}


/**
 * Shows trading pair or contract info
 * @param {string[]} params Expected to receive trading pair or contract ticker
 * @returns {Promise<CommandReply>}
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
    output = `Error in pair() of ${moduleName} module: ${e}`;

    log.error(output);
  }

  return formSendBackMessage(output);
}


/**
 * Converts an amount of one currency into another.
 * Example: `/calc 2.05 BTC to USDT`
 *
 * @param {string[]} params Command parameters
 * @param {Object} tx Incoming ADM transaction for an in-chat command
 * @param {boolean} isWebApi When `true`, the response format may differ for the Web API
 * @returns {Promise<CommandReply>}
 */
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
    log.error(`commandTxs: Error in calc() of ${moduleName} module: ${e}`);
  }

  return {
    msgNotify: '',
    msgSendBack: output,
    notifyType: 'log',
  };
}


/**
 * Retrieves information about a coin on the exchange, including supported networks.
 * @param {string[]} params Command parameters
 * @param {Object} tx Incoming ADM transaction for an in-chat command
 * @param {boolean} isWebApi When `true`, the response format may differ for the Web API
 * @returns {Promise<CommandReply>}
 */
async function info(params, tx, isWebApi = false) {
  const commandExample = 'Example: */info USDT*';

  try {
    const coin = params[0]?.toUpperCase() || '';
    if (coin?.length < 2) {
      return formSendBackMessage(`Specify a coin to view its details. ${commandExample}.`);
    }

    if (traderapi.features().getCurrencies && traderapi.currencies) {
      await traderapi.getCurrencies(coin, true); // Force coin info update

      const currency = await traderapi.currencyInfo(coin);
      if (!currency) {
        return formSendBackMessage(`It seems that ${config.exchangeName} does not support the ${coin} coin. ${commandExample}.`);
      }

      let msgSendBack = `_${coin}_ on ${config.exchangeName} details:\n`;
      msgSendBack += coinInfoString(currency);

      return formSendBackMessage(msgSendBack);
    }

    return formSendBackMessage(`It appears that ${config.exchangeName} does not provide information about coins.`);
  } catch (e) {
    log.error(`commandTxs: Error in info() of ${moduleName} module: ${e}`);
  }
}


/**
 * Creates a string about coin info
 * @param {Object} coin
 * @returns {string} Coin info markdown block
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
 * @returns {string} Network-specific coin info markdown block
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
 * @param {Object} coinOrNetwork
 * @return {string}
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
 * @returns {string} Supported networks list for a coin
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

module.exports = {
  rates,
  orderbook,
  trades,
  ticker,
  stats,
  pair,
  calc,
  info,
  supportedNetworksString,
};
