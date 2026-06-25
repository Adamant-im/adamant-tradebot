'use strict';

/**
 * @module modules/commands/orders
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/bot/commandTxs.d.js').CommandTx} CommandTx
 */

const {
  config, log, tradeParams, traderapi, traderapi2, perpetualApi,
  orderUtils, orderCollector, moduleName, utils,
} = require('./context');
const { formSendBackMessage } = require('./helpers');
const { validateFeature } = require('./features');
const { composeLiquidityStats, composeTraderOrdersFull, composeOrdersDetails, composeOrderSummary } = require('./compose');

/**
 * Cancels orders on a spot trading pair or a contract
 * Format: /clear [pair] [purpose] {buy/sell} [condition] {force}
 * @see https://marketmaking.app/cex-mm/command-reference#clear
 * @param {string[]} params Expected to receive a coin, trading pair, or a contract ticker
 * @returns {Promise<CommandReply>}
 */
async function clear(params) {
  const commandExample = `Try: */clear man sell >0.5 ${config.coin2}*`;
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

    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExampleSimple}.`);
    }

    const side = parsedParams.orderSide;
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
      api = perpetualApi;
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
    const sideString = side ? `**${side}**-` : '';

    if (purpose === 'all') {
      clearedInfo = await orderCollector.clearAllOrders(formattedPair.pair, doForce, side, 'User command', `${sideString}orders`, api);
    } else { // Closing orders of specified purposes only
      let filterString = '';

      if (purpose === 'unk') {
        clearedInfo = await orderCollector.clearUnknownOrders(formattedPair.pair, doForce, side, 'User command', `**${purposeString}** ${sideString}orders${filterString}`, api, true);
      } else {
        if (filter) {
          filterString = ` with price ${conditionString} ${config.coin2}`;
        }

        clearedInfo = await orderCollector.clearLocalOrders([purpose], formattedPair.pair, doForce, side, filter, 'User command', `**${purposeString}** ${sideString}orders${filterString}`, api, moduleIndexString);
      }
    }

    output = clearedInfo.logMessage;

    return formSendBackMessage(output);
  } catch (e) {
    log.error(`commandTxs: Error in clear() of ${moduleName} module: ${e}`);
  }
}


/**
 * Cancel order
 * Format: /cancel [trading pair] {id}
 * Works both for Spot and for Contracts
 * @see https://marketmaking.app/cex-mm/command-reference#cancel
 * @param {string[]} params Command parameters
 * @returns {Promise<CommandReply>}
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

    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

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
      api = perpetualApi; // Currently, checks if it's a contract and uses perpetualApi independently of this param
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
          `Probably, it doesn't exist or is already closed. Local order database didn't include this order either.`;
      return formSendBackMessage(`Unable to cancel order ${orderId}${onWhichAccount}. ${note}`);
    } else {
      return formSendBackMessage(`Unable to cancel order ${orderId}${onWhichAccount} on ${pair}: ${config.exchangeName} failed to process the request. Try again.${orderDbInfo}`);
    }
  } catch (e) {
    log.error(`commandTxs: Error in cancel() of ${moduleName} module: ${e}`);
  }
}


/**
 * Get order details
 * Format: /order [trading pair] {id}
 * Works both for Spot and for Contracts
 * @see https://marketmaking.app/cex-mm/command-reference#order
 * @param {string[]} params Command parameters
 * @returns {Promise<CommandReply>}
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

    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

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
      api = perpetualApi; // Currently, checks if it's a contract and uses perpetualApi independently of this param
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
      output += 'Note: The reported pair may differ due to implementation specifics.';

      return formSendBackMessage(output);
    } else {
      return formSendBackMessage(`Unable to retrieve details for order ${orderId}${onWhichAccount} on ${pair}. Does it exist?`);
    }
  } catch (e) {
    log.error(`commandTxs: Error in order() of ${moduleName} module: ${e}`);
  }
}


/**
 * Get open order list or their details
 * Works both for Spot and Contracts
 * Format: /orders [trading pair] [purpose] {full}
 * @see https://marketmaking.app/cex-mm/command-reference#orders
 * @param {string[]} params Command parameters
 * @param {Object} tx Income ADM transaction for in-chat command
 * @returns {Promise<CommandReply>}
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

    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

    if (!formattedPair?.isParsed) {
      return formSendBackMessage(`Market or perpetual contract ticker '${pair}' is not found on ${config.exchangeName}. ${commandExample}.`);
    }

    const isDefaultPair = pair === config.defaultPair;

    const showFull = parsedParams.is('full');
    const detailsPurpose = parsedParams.purpose;
    const moduleIndexString = parsedParams.moduleIndexString;

    if (parsedParams.paramCountUnknown && !detailsPurpose) {
      return formSendBackMessage(`Unknown order type: '${parsedParams.more[0].param}'. ${commandExample}.`);
    }

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

        const purposeIndexed = `${detailsPurpose}${moduleIndexString}`;

        caption = orderList.count ?
            `${config.exchangeName} ${purposeIndexed}-orders for ${formattedPair.pair}${accountNoString}: ${orderList.count}.` :
            `No ${purposeIndexed}-orders opened on ${config.exchangeName} for ${formattedPair.pair}${accountNoString}.\n`;

        output += caption + orderList.output;

        // Add feature state (disabled or enabled, paused or not)

        const featureInfo = validateFeature(detailsPurpose);
        let tradeParamActiveName = featureInfo?.tradeParamActiveName;

        if (tradeParamActiveName) {
          tradeParamActiveName = `${tradeParamActiveName}${moduleIndexString}`;

          const featureState = tradeParams[tradeParamActiveName] ? 'enabled' : 'disabled';
          output += `\n\nThe feature _${purposeIndexed}_ (${featureInfo.description}) is currently _${featureState}_`;

          const tradeParamPausedName = tradeParamActiveName.replace('Active', 'Paused');

          output += tradeParams[tradeParamPausedName] ? ', but _paused_.' : '.';
        }
      }

      // Append liquidity stats tables for /orders liq
      if (detailsPurpose === 'liq' && showFull && !moduleIndexString && isDefaultPair) {
        output += '\n\n' + await composeLiquidityStats(pair);
      }

      // Append trader stats tables for /orders t
      if (detailsPurpose === 't' && showFull && !moduleIndexString && isDefaultPair && accountNumber === 1) {
        output += '\n\n' + await composeTraderOrdersFull(pair);
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
    const errorDetails = `Error in orders() of ${moduleName} module: ${e}`;

    log.error(errorDetails);

    return formSendBackMessage(`Unable to process the command, try again later. ${errorDetails}`);
  }
}

module.exports = {
  clear,
  cancel,
  order,
  orders,
};
