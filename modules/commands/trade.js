'use strict';

/**
 * @module modules/commands/trade
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/paramVerifyResult.d').ParsedPositiveSmartNumber} ParsedPositiveSmartNumber
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 */

const {
  constants, config, log, traderapi, traderapi2, perpetualApi,
  orderUtils, moduleName, utils, exchangerUtils,
} = require('./context');
const {
  formSendBackMessage, formSendBackAndNotify, setPendingConfirmation,
} = require('./helpers');

/**
 * Places several orders within a price range on spot or contract trading pair
 * Format: /fill [pair] {buy/sell} [amount= or quote=] [low=] [high=] [count=]
 * @see https://marketmaking.app/cex-mm/command-reference#fill
 * @param {string[]} params Command parameters
 * @returns {Promise<CommandReply>}
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

    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    // Verify parameters

    const side = parsedParams.orderSide;

    if (side !== 'buy' && side !== 'sell') {
      return formSendBackMessage(`Specify _buy_ or _sell_ orders to fill. ${commandExample}.`);
    }

    // Name : verification type to parse and verify
    const paramMap = {
      count: 'positive integer',
      low: 'positive number',
      high: 'positive number',
    };

    if (side === 'buy') {
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

    const low = parsedParams.lowParsed;
    const high = parsedParams.highParsed;

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
      api = perpetualApi; // Currently, orderCollector checks if a contract and uses perpetualApi independently of this param
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

    const balanceCheck = await orderUtils.isEnoughCoins(side, pair, qty, qty, 'fill', undefined, moduleName, api);

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
          ` to ${side} ${formattedPair.coin1} worth ~${totalUsdString} USD` :
          ` to ${side} ${qty} ${formattedPair.coin1} (worth ~${totalUsdString} USD)`;
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
      if (side === 'buy') {
        coin2Amount = orderQty;
        orderQty = orderQty / orderPrice;
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
      order = await orderUtils.addGeneralOrder(side, formattedPair.pair, orderList[i].price, orderList[i].amount, 1, null, 'man', api);

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
      output = `${placedOrders} orders${onWhichAccount} on ${pair} to ${side} ${totalAmountString} ${formattedPair.coin1} for ${totalQuoteString} ${formattedPair.coin2}.`;

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
    log.error(`commandTxs: Error in fill() of ${moduleName} module: ${e}`);
  }
}


/**
 * Places a buy order on spot or contract trading pair
 * Format: /{buy/sell} [pair] [amount= or quote=] [price=]
 * @see https://marketmaking.app/cex-mm/command-reference#buy-sell
 * @param {string[]} params Command parameters
 * @returns {Promise<CommandReply>}
 */
async function buy(params) {
  const parsedParams = parseBuySellParams(params, 'buy');

  return buy_sell(parsedParams, 'buy');
}


/**
 * Places a sell order on spot or contract trading pair
 * Format: /{buy/sell} [pair] [amount= or quote=] [price=]
 * @see https://marketmaking.app/cex-mm/command-reference#buy-sell
 * @param {string[]} params Command parameters
 * @returns {Promise<CommandReply>}
 */
async function sell(params) {
  const parsedParams = parseBuySellParams(params, 'sell');

  return buy_sell(parsedParams, 'sell');
}


/**
 * Parameters parser for /buy and /sell commands
 * Works both for Spot and Contracts
 * WARNING: We don't validate perpetual parameters currently
 * @param {string[]} params Command parameters
 * @param {'buy' | 'sell'} side Order side
 * @returns {Object} Parsed command parameters
 */
function parseBuySellParams(params, side) {
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

    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    const commandExampleDepending = utils.isPerpetual(pair) ? commandExamplePerpetual : commandExample;

    // Verify parameters

    // Name : type to parse and verify
    const paramMap = {
      // price: 'positive number | '/market/i' | undefined',
    };

    if (side === 'buy') {
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
      api = perpetualApi; // Currently, orderCollector checks if a contract and uses perpetualApi independently of this param
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
          side === 'buy' && amountType === 'amount' ||
          side === 'sell' && amountType === 'quote'
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

    const { coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;

    // Calculate order volume in USD

    const totalUSD = amountType === 'amount' ?
        exchangerUtils.convertCryptos(coin1, 'USD', qty).outAmount :
        exchangerUtils.convertCryptos(coin2, 'USD', qty).outAmount;

    const totalUsdString = utils.formatNumber(totalUSD.toFixed(0), true);

    // Check for extreme price deviation regardless of order size
    // Catches typos like price=1122545 instead of price=0.01122545

    if (price !== 'market' && !isConfirmed) {
      const marketPrice = exchangerUtils.convertCryptos(coin1, coin2, 1).exchangePrice;

      if (utils.isPositiveNumber(marketPrice)) {
        // Express deviation as (price - market) / market * 100
        const deviationPct = utils.numbersDifferencePercentDirect(marketPrice, price);

        if (Math.abs(deviationPct) > constants.ORDER_PRICE_EXTREME_DEVIATION_PERCENT) { // Price is 10x+ from market
          setPendingConfirmation(`/${side} ${params.join(' ')}`);

          const directionWord = deviationPct > 0 ? 'above' : 'below';
          return formSendBackMessage(`**Extreme price warning:** order price _${price}_ is **${Math.abs(deviationPct).toFixed(0)}%** ${directionWord} market (${marketPrice.toFixed(coin2Decimals)} ${coin2}). Did you enter the price correctly?\n\nConfirm with **/y** or ignore.`);
        }
      }
    }

    // Ask confirmation

    if (totalUSD >= config.amount_to_confirm_usd && !isConfirmed) {
      setPendingConfirmation(`/${side} ${params.join(' ')}`);

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
          confirmationMessage += `Are you sure to ${side} ${qty} ${coin1} (worth ~${totalUsdString} USD) for ~${quoteCalculated} ${coin2} at _Market_ price on ${pair}?`;
        } else {
          // buy ~100 ADM for 1000 USDT (worth ~999 USD) at Market price
          // sell ~100 ADM for 1000 USDT (worth ~999 USD) at Market price
          confirmationMessage += `Are you sure to ${side} ~${amountCalculated} ${coin1} for ${qty} ${coin2} (worth ~${totalUsdString} USD) at _Market_ price on ${pair}?`;
        }
      } else {
        confirmationMessage += `Are you sure to place an order to ${side} ${amountCalculated} ${coin1} (worth ~${totalUsdString} USD) for _${quoteCalculated}_ ${coin2} at ${price} ${coin2} price on ${pair}?`;

        const marketPrice = exchangerUtils.convertCryptos(coin1, coin2, 1).exchangePrice;
        const priceDifference = utils.numbersDifferencePercentDirect(price, marketPrice);

        if (
          (priceDifference < -20 && side === 'buy') ||
          (priceDifference > 20 && side === 'sell')
        ) {
          confirmationMessage += `\n\n**Warning: ${side} price is ${Math.abs(priceDifference).toFixed(0)}% ${marketPrice > price ? 'less' : 'greater'} than market**.`;
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
    log.error(`commandTxs: Error in parseBuySellParams() of ${moduleName} module: ${e}`);
  }
}


/**
 * Executor for /buy and /sell commands on spot or contract trading pair
 * @param {Object} params Parsed command parameters
 * @param {'buy' | 'sell'} side Order side
 * @returns {Promise<CommandReply>}
 */
async function buy_sell(params, side) {
  let paramsInfo = `side=${side}, amount=${params?.amount}, quote=${params?.quote}, price=${params?.price}, pair=${params?.pair}, formattedPair=(${Boolean(params?.formattedPair)}), api=(${Boolean(params?.api)})`;

  if (params?.formattedPair?.perpetual) {
    paramsInfo += `, reduceOnly=${params?.reduceOnly}, takeProfitPrice=${params?.takeProfitPrice}, stopLossPrice=${params?.stopLossPrice}, timeInForce=${params?.timeInForce}, smpType=${params?.smpType}`;
  }

  try {
    if (!params) {
      return formSendBackMessage('Unable to process the command, try again later.');
    }

    if (params.msgSendBack) {
      return params; // Confirmation or error message
    }

    const isMarketOrder = params.price === 'market';

    const result = await orderUtils.addGeneralOrder(
        side,
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
    log.error(`commandTxs: Error in buy_sell(${paramsInfo}) of ${moduleName} module: ${e}`);
  }
}


/**
 * Converts one currency to another using a special endpoint, if an exchange supports it
 * Conversion fees may apply or not
 * Format: /convert amount coin1 to coin2
 * @see https://marketmaking.app/cex-mm/command-reference#convert
 * @param {string[]} params Command parameters
 * @returns {Promise<CommandReply>}
 */
async function convert(params) {
  const commandExample = `Try: */convert 100 USDC to USD*`;

  try {
    // Check if an exchange supports this command

    if (!traderapi.convert) {
      return formSendBackMessage(`${config.exchangeName} doesn't support coin conversion or it's not implemented.`);
    }

    // Parse parameters

    const parsedParams = utils.parseCommandParams(params, 4);

    if (!parsedParams?.exactParamsCount || !parsedParams.is('to')) {
      return formSendBackMessage(`Unexpected arguments. ${commandExample}.`);
    }

    const coin1AmountPlain = parsedParams.more[0].paramPlain;
    const coin1 = parsedParams.prevTo('to')?.paramUc;
    const coin2 = parsedParams.nextTo('to')?.paramUc;

    if (!coin1 || !coin2) {
      return formSendBackMessage(`Unexpected arguments. ${commandExample}.`);
    }

    const isStableCoin1 = utils.isStableCoin(coin1);

    // Verify parameters

    const verifyAmount = utils.verifyParam('amount', coin1AmountPlain, 'positive smart number');

    if (!verifyAmount.success) {
      return formSendBackMessage(`Wrong arguments. ${verifyAmount.message}. ${commandExample}.`);
    }

    const coin1Amount = /** @type {ParsedPositiveSmartNumber} */ (verifyAmount.parsed).number;

    const isConfirmed = parsedParams.isConfirmed;

    // Choose API

    let api;

    if (parsedParams.useSecondAccount) {
      if (traderapi2) {
        api = traderapi2;
      } else {
        return formSendBackMessage(`The second trader account is not set. Remove the _-2_ option to run the command for the first account. ${commandExample}.`);
      }
    } else {
      api = traderapi;
    }

    // Check if enough coin balance: Skipping

    // For big orders, ask for a confirmation

    const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

    const totalUsd = exchangerUtils.convertCryptos(coin1, 'USD', coin1Amount).outAmount;

    if (totalUsd >= config.amount_to_confirm_usd && !isConfirmed) {
      setPendingConfirmation(`/convert ${parsedParams.paramString}`);

      const amountString = utils.formatNumber(coin1Amount, true);
      const totalUsdString = utils.formatNumber(totalUsd.toFixed(0), true);

      let confirmationMessage = `Are you sure to convert ${amountString} ${coin1}${onWhichAccount}`;
      if (!isStableCoin1) {
        confirmationMessage += ` worth ~${totalUsdString} USD`;
      }
      confirmationMessage += ` to ${coin2}?`;
      confirmationMessage += ' Confirm with **/y** command or ignore.';

      return formSendBackMessage(confirmationMessage);
    }

    // Convert

    let msgNotify; let msgSendBack;

    const conversionString = `${coin1Amount} ${coin1} to ${coin2}${onWhichAccount}`;

    const conversionReq = await api.convert(coin1, coin2, coin1Amount);

    if (conversionReq?.conversionId) {
      msgSendBack = conversionReq.message;
      msgNotify = `${config.notifyName}: ${conversionReq.message}`;
    } else if (conversionReq === undefined) {
      msgSendBack = `Request to convert ${conversionString} with params [${parsedParams.paramString}] failed. It looks like an API temporary error. Try again.`;
      log.error(`Convert command: ${msgSendBack}`);
    } else {
      msgSendBack = conversionReq.message;
    }

    return formSendBackAndNotify(msgSendBack, msgNotify);
  } catch (e) {
    log.error(`commandTxs: Error in convert() of ${moduleName} module: ${e}`);
  }
}

module.exports = {
  fill,
  buy,
  sell,
  convert,
};
