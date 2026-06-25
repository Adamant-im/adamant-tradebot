'use strict';

/**
 * @module modules/commands/base
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 */

const {
  config, log, notify, tradeParams, traderapi2, moduleName, utils, exchangerUtils,
} = require('./context');
const { formSendBackMessage, formSendBackAndNotify, validateTraderMinAmount } = require('./helpers');
const { composeFeatureList, getNiceChartIntervalWarning } = require('./features');

/**
 * Starts (or resumes) market-making and runs all enabled bot modules
 * Format: /start
 * @see https://marketmaking.app/cex-mm/command-reference#start
 * @param {string[]} params This command does not accept parameters
 * @returns {CommandReply}
 */
function start(params) {
  const commandExample = `It works as follows: */start*`;

  try {
    const pair = config.defaultPair;

    // Parse parameters
    const parsedParams = utils.parseCommandParams(params);
    if (parsedParams?.paramCount > 0) {
      return formSendBackMessage(`The command doesn't accept parameters. ${commandExample}.`);
    }

    let enabledFeaturesString;

    const enabledFeatures = composeFeatureList();

    if (enabledFeatures) {
      enabledFeaturesString = ' Enabled features:\n';
      enabledFeaturesString += enabledFeatures;
    } else {
      enabledFeaturesString = '\nAll market-making features are currently inactive. Enable any of them using the **/enable** command.\n';
    }

    if (tradeParams.mm_isActive) {
      return formSendBackMessage(`Market-making is already active.${enabledFeaturesString}`);
    }

    tradeParams.mm_isActive = true;

    const msgNotify = `${config.notifyName} started market-making for ${pair}.`;
    const msgSendBack = `Starting market-making for ${pair}.${enabledFeaturesString}`;

    return formSendBackAndNotify(msgSendBack, msgNotify);
  } catch (e) {
    log.error(`commandTxs: Error in start() of ${moduleName} module: ${e}`);
  }
}


/**
 * Pauses market-making and all bot modules
 * Format: /stop mm
 * @see https://marketmaking.app/cex-mm/command-reference#stop
 * @param {string[]} params This command ignores parameters
 * @returns {CommandReply}
 */
function stop(params) {
  try {
    const pair = config.defaultPair;

    let msgNotify;
    let msgSendBack;

    let enabledFeaturesString;

    const enabledFeatures = composeFeatureList();

    if (enabledFeatures) {
      enabledFeaturesString = ' Paused features:\n';
      enabledFeaturesString += enabledFeatures;
    } else {
      enabledFeaturesString = '\nNo bot features were enabled.\n';
    }


    if (tradeParams.mm_isActive) {
      msgNotify = `${config.notifyName} paused market-making for ${pair}.`;
      msgSendBack = `Market-making for ${pair} is paused now.`;
      msgSendBack += enabledFeaturesString;
      msgSendBack += '\n\nYou can resume with the same features and parameters anytime later using the */start* command.';

      tradeParams.mm_isActive = false;
    } else {
      msgNotify = '';
      msgSendBack = `Market-making for ${pair} is not active.`;
    }

    return formSendBackAndNotify(msgSendBack, msgNotify);
  } catch (e) {
    log.error(`commandTxs: Error in stop() of ${moduleName} module: ${e}`);
  }
}


/**
 * Emergency-pauses market-making and sends a priority operator notification.
 * Called by runtime modules (balance watcher, order utils, etc.) on critical failures.
 *
 * @param {string} callerName Calling module name (used in config save reason)
 * @param {string} details Short description of the emergency (no leading punctuation)
 */
function emergencyStop(callerName, details) {
  try {
    if (tradeParams.mm_isActive) {
      tradeParams.mm_isActive = false;
      utils.saveConfig(false, `commandTxs/${callerName}-EmergencyStop`);
      log.warn(`commandTxs/emergencyStop: Market-making paused by ${callerName}. ${details}`);

      let generalMessage = `You can restart operations with **/start**. Before doing so, verify that the bot’s parameters fit current market conditions. Disabling modules that are sensitive to the order list, such as ladder and liquidity, may be reasonable. Additionally, you can close all open orders with the **/clear all** command. `;
      generalMessage += `See the logs for more details.`;

      notify(`${config.notifyName}: ${details}.\n\n${generalMessage}`, 'error', undefined, true); // Priority notification
    }
  } catch (e) {
    log.error(`commandTxs: Error in emergencyStop() of ${moduleName} module: ${e}`);
  }
}


/**
 * Set percent of buy-side trades for the Trader module
 * Format: /buyPercent 65
 * @see https://marketmaking.app/cex-mm/command-reference#amount
 * @param {string[]} params Expected: interval min-max, coin1
 * @returns {CommandReply}
 */
function buypercent(params) {
  const commandExample = `Try: */buyPercent 65*`;

  try {
    const parsedParams = utils.parseCommandParams(params, 1);

    // Validate trading amounts

    const buyPercentParam = parsedParams?.getFirst();
    const buyPercent = buyPercentParam?.paramNumber;

    if (!buyPercent || buyPercent <= 0 || buyPercent >= 100) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    // Save Trader parameters

    tradeParams.mm_buyPercent = buyPercent / 100;

    // Prepare informational message

    let msgSendBack = `The bot now trades on the buy side in _${buyPercent}%_ of cases on ${config.defaultPair}.`;

    if (!tradeParams.mm_isActive || !tradeParams.mm_isTraderActive) {
      msgSendBack += `\n\nNote: Market-making or Trader feature is currently inactive.`;
    }

    return formSendBackMessage(msgSendBack);
  } catch (e) {
    log.error(`commandTxs: Error in buypercent() of ${moduleName} module: ${e}`);
  }
}


/**
 * Set trading amounts
 * Format: /amount [min-max] coin1
 * @see https://marketmaking.app/cex-mm/command-reference#amount
 * @param {string[]} params Expected: interval min-max, coin1
 * @returns {CommandReply}
 */
function amount(params) {
  const commandExample = `Try: */amount 1-10 ${config.coin1}*`;

  try {
    const parsedParams = utils.parseCommandParams(params, 2);

    // Validate trading amounts

    const amountIntervalParam = parsedParams?.getOtherInterval();

    if (!amountIntervalParam) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const interval = utils.parseRangeOrValue(amountIntervalParam.param);

    if (!interval.isRange) {
      return formSendBackMessage(`Unable to parse from–to trading amounts: _${amountIntervalParam.param}_. ${commandExample}.`);
    }

    const coinParam = parsedParams.nextTo(amountIntervalParam.param);

    if (coinParam?.paramUc !== config.coin1) {
      return formSendBackMessage(`Specify trading amounts in ${config.coin1}. ${commandExample}.`);
    }

    const minAmount = interval.from;
    const maxAmount = interval.to;

    const minAmountValidation = validateTraderMinAmount(minAmount, config.coin1, commandExample);
    if (minAmountValidation) {
      return minAmountValidation;
    }

    // Save Trader parameters

    const oldVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

    tradeParams.mm_minAmount = minAmount || tradeParams.mm_minAmount;
    tradeParams.mm_maxAmount = maxAmount || tradeParams.mm_maxAmount;

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

    const newVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

    // Prepare informational message

    const volumeChangePercent = Math.abs(utils.numbersDifferencePercentDirect(oldVolume.coin1, newVolume.coin1));
    const operator = oldVolume.coin1 > newVolume.coin1 ? '−' : '+';
    const volumeChangePercentString = `${operator}${volumeChangePercent.toFixed(2)}%`;

    let msgSendBack = `The bot now trades _${minAmount}–${maxAmount}_ ${config.coin1} on ${config.defaultPair}.`;
    if (tradeParams.mm_traderObLimitPercent) {
      msgSendBack += ` executeInOrderBook amount limit: _${tradeParams.mm_traderObLimitPercent}%_.`;
    }
    msgSendBack += ` Estimate daily trading volume changed _${volumeChangePercentString}_: ${exchangerUtils.getVolumeChangeInfoString(oldVolume, newVolume)}.`;

    if (!tradeParams.mm_isActive || !tradeParams.mm_isTraderActive) {
      msgSendBack += `\n\nNote: Market-making or Trader feature is currently inactive.`;
    }

    return formSendBackMessage(msgSendBack);
  } catch (e) {
    log.error(`commandTxs: Error in amount() of ${moduleName} module: ${e}`);
  }
}


/**
 * Set trading interval
 * Format: /amount [min-max] [unit]
 * @see https://marketmaking.app/cex-mm/command-reference#interval
 * @param {string[]} params Expected: interval min-max, time unit
 * @returns {CommandReply}
 */
function interval(params) {
  const commandExample = `Try: */interval 1-5 min*`;

  try {
    const parsedParams = utils.parseCommandParams(params, 2);

    // Validate trading time interval

    const timeIntervalParam = parsedParams?.getTimeInterval();

    if (!timeIntervalParam) {
      return formSendBackMessage(`Wrong arguments. ${commandExample}.`);
    }

    const interval = utils.parseRangeOrValue(timeIntervalParam.param);

    if (!interval.isRange) {
      return formSendBackMessage(`Unable to parse trading time interval: _${timeIntervalParam.param}_. ${commandExample}.`);
    }

    const timeUnit = parsedParams.nextTo(timeIntervalParam.param)?.param;

    const minInterval = interval.from;
    const maxInterval = interval.to;

    // Save Trader parameters

    const oldVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

    tradeParams.mm_minInterval = utils.getTimeInMs(minInterval, timeUnit) || tradeParams.mm_minInterval;
    tradeParams.mm_maxInterval = utils.getTimeInMs(maxInterval, timeUnit) || tradeParams.mm_maxInterval;

    const newVolume = exchangerUtils.estimateCurrentDailyTradeVolume();

    // Prepare informational message

    const volumeChangePercent = Math.abs(utils.numbersDifferencePercentDirect(oldVolume.coin1, newVolume.coin1));
    const operator = oldVolume.coin1 > newVolume.coin1 ? '−' : '+';
    const volumeChangePercentString = `${operator}${volumeChangePercent.toFixed(2)}%`;

    let msgSendBack = `The bot now trades every _${minInterval}–${maxInterval}_ ${timeUnit} on ${config.defaultPair}.`;
    msgSendBack += ` Estimate daily trading volume changed _${volumeChangePercentString}_: ${exchangerUtils.getVolumeChangeInfoString(oldVolume, newVolume)}.`;

    const niceChartIntervalWarning = getNiceChartIntervalWarning();
    if (niceChartIntervalWarning) {
      msgSendBack += `\n\n${niceChartIntervalWarning}`;
    }

    if (!tradeParams.mm_isActive || !tradeParams.mm_isTraderActive) {
      msgSendBack += `\n\nNote: Market-making or Trader feature is currently inactive.`;
    }

    return formSendBackMessage(msgSendBack);
  } catch (e) {
    log.error(`commandTxs: Error in interval() of ${moduleName} module: ${e}`);
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
 * Show tradebot software version
 * Format: /version
 * @see https://marketmaking.app/cex-mm/command-reference#version
 * @returns {CommandReply}
 */
function version() {
  return formSendBackMessage(`I am running on _adamant-tradebot_ software version _${config.version}_. Revise code on ADAMANT's GitHub.`);
}

module.exports = {
  start,
  stop,
  emergencyStop,
  buypercent,
  amount,
  interval,
  params,
  help,
  version,
};
