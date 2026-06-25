/**
 * Processor for user commands received via ADM chat, Telegram, CLI, or Web UI.
 */

/**
 * @module modules/commandTxs
 * @typedef {import('types/bot/commandTxs.d.js').ProcessCommand} ProcessCommand
 * @typedef {import('types/bot/commandTxs.d.js').CommandTx} CommandTx
 * @typedef {import('types/bot/commandTxs.d.js').CommandItx} CommandItx
 * @typedef {import('types/bot/commandTxs.d.js').CommandHandler} CommandHandler
 * @typedef {import('types/bot/commandTxs.d.js').CommandsRegistry} CommandsRegistry
 * @typedef {import('types/bot/commandTxs.d.js').CommandAliasesRegistry} CommandAliasesRegistry
 * @typedef {import('types/bot/commandTxs.d.js').BotFeatureKey} BotFeatureKey
 * @typedef {import('types/bot/commandTxs.d.js').BotFeatureDefinition} BotFeatureDefinition
 * @typedef {import('types/bot/commandTxs.d.js').BotFeaturesRegistry} BotFeaturesRegistry
 * @typedef {import('types/bot/commandTxs.d.js').PendingConfirmationState} PendingConfirmationState
 * @typedef {import('types/bot/commandTxs.d.js').CoinRatesInfoResult} CoinRatesInfoResult
 * @typedef {import('types/bot/commandTxs.d.js').ExchangeRatesInfoResult} ExchangeRatesInfoResult
 * @typedef {import('types/bot/commandTxs.d.js').TraderOrderStatsAgg} TraderOrderStatsAgg
 * @typedef {import('types/bot/commandTxs.d.js').CommandListResult} CommandListResult
 * @typedef {import('types/bot/commandTxs.d.js').BalancesScope} BalancesScope
 * @typedef {import('types/bot/commandTxs.d.js').FundHistoryMode} FundHistoryMode
 * @typedef {import('types/bot/commandTxs.d.js').PreviousBalancesCache} PreviousBalancesCache
 * @typedef {import('types/bot/commandTxs.d.js').PreviousOrdersCache} PreviousOrdersCache
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/assets.d').ResultWithTimestamp} AssetsResultWithTimestamp
 * @typedef {import('../types/rates.d').RatesResult} RatesResult
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/paramVerifyResult.d').VerificationTypes} VerificationTypes
 * @typedef {import('types/bot/paramVerifyResult.d').ParsedPositiveSmartNumber} ParsedPositiveSmartNumber
 * @typedef {import('types/bot/paramVerifyResult.d').ParsedSmartTime} ParsedSmartTime
 * @typedef {import('types/bot/paramVerifyResult.d').ParamVerifyResult} ParamVerifyResult
 * @typedef {import('types/bot/featureValidateResult.d').FeatureValidateResult} FeatureValidateResult
 * @typedef {import('types/bot/orderBookInfo.d').OrderBookInfo} OrderBookInfo
 * @typedef {import('types/bot/orderMetrics.d').FillsDbRecord} FillsDbRecord
*/

'use strict';

const utils = require('../helpers/utils');
const log = require('../helpers/log');
const notify = require('../helpers/notify');

const { timeToConfirm, pendingConfirmation, moduleName } = require('./commands/context');
const { formSendBackMessage } = require('./commands/helpers');
const base = require('./commands/base');
const features = require('./commands/features');
const trade = require('./commands/trade');
const orders = require('./commands/orders');
const account = require('./commands/account');
const info = require('./commands/info');

/** Optional command packs — omitted in trimmed/free bot builds. */
const remoteModule = utils.softRequire('./commands/remote');
const twapModule = utils.softRequire('./commands/twap');
const assetsModule = utils.softRequire('./commands/assets');
const makeModule = utils.softRequire('./commands/make');
const perpetualModule = utils.softRequire('./commands/perpetual');


/**
 * Confirms and executes a command previously queued with {@link setPendingConfirmation}.
 *
 * Format: `/y`
 *
 * @param {string[]} params Command params (unused)
 * @param {CommandTx} tx Initiator transaction
 * @returns {Promise<CommandReply | undefined>}
 */
async function y(params, tx) {
  try {
    if (pendingConfirmation.command) {
      let commandResult;

      if (Date.now() - pendingConfirmation.timestamp > timeToConfirm) {
        log.log(`commandTxs: Expired pending command '${pendingConfirmation.command}'`);
        commandResult = formSendBackMessage(`I will not confirm the command '${pendingConfirmation.command}' because it has expired. Please try again.`);
      } else {
        log.log(`commandTxs: Confirming pending command '${pendingConfirmation.command}'`);
        commandResult = await module.exports(`${pendingConfirmation.command} -y`, tx);
        commandResult.msgNotify = ''; // Command itself will notify, we need only msgSendBack
      }

      pendingConfirmation.command = '';

      return commandResult;
    } else {
      return formSendBackMessage('There is no pending command to confirm.');
    }
  } catch (e) {
    log.error(`commandTxs: Error in y()-confirmation of ${moduleName} module: ${e}`);
  }
}

/** Command aliases: shorthand tokens expanded before dispatch. @type {CommandAliasesRegistry} */
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
  rstopy: () => ('/remote stop all -y'),
  rstart: () => ('/remote start all'),

  f: (params) => (`/features ${params.join(' ')}`),

  b: (params) => (`/balances ${params.join(' ')}`),
  ba: () => (`/balances allcoins`),
  bf: () => (`/balances full`),
  baf: () => (`/balances allcoins full`),

  o: (params) => (`/orders ${params.join(' ')}`),
  position: (params) => (`/positions ${params.join(' ')}`),
  p: (params) => (`/positions ${params.join(' ')}`),

  coin: (params) => (`/info ${params.join(' ')}`),

  s: (params) => (`/stop ${params.join(' ')}`),
};

/** Registered command handlers keyed by command name. @type {CommandsRegistry} */
const commands = {
  help: base.help,
  rates: info.rates,
  orderbook: info.orderbook,
  trades: info.trades,
  ticker: info.ticker,
  stats: info.stats,
  pair: info.pair,
  orders: orders.orders,
  calc: info.calc,
  balances: account.balances,
  account: account.account,
  version: base.version,
  start: base.start,
  stop: base.stop,
  emergencyStop: base.emergencyStop,
  buypercent: base.buypercent,
  amount: base.amount,
  interval: base.interval,
  clear: orders.clear,
  fill: trade.fill,
  params: base.params,
  buy: trade.buy,
  sell: trade.sell,
  convert: trade.convert,
  enable: features.enable,
  disable: features.disable,
  features: features.features,
  cancel: orders.cancel,
  deposit: account.deposit,
  order: orders.order,
  y,
  volume: account.volume,
  info: info.info,
  saveConfig: utils.saveConfig,
  ...(twapModule ? { twap: twapModule.twap } : {}),
  ...(perpetualModule ? { perpetual: perpetualModule.perpetual, positions: perpetualModule.positions } : {}),
  ...(makeModule ? { make: makeModule.make } : {}),
  ...(assetsModule ? { transfer: assetsModule.transfer, withdraw: assetsModule.withdraw, show: assetsModule.show } : {}),
  ...(remoteModule ? { remote: remoteModule.remote } : {}),
};

/**
 * Processes a user command: normalizes input, resolves aliases, dispatches to a handler,
 * sends operator notifications, marks the incoming-tx record as processed, and persists config.
 *
 * @param {string} commandMsg Plain command text (may include a leading `/`)
 * @param {CommandTx} tx ADM or Telegram transaction object
 * @param {CommandItx} [itx] MongoDB `incomingtxs` / `incomingtgtxs` record
 * @returns {Promise<CommandReply | undefined>} Reply for the caller to send back; `undefined` on unhandled errors
 */
module.exports = async (commandMsg, tx, itx) => {
  let commandResult;

  try {
    const from = tx.senderTgUsername ?
      `${tx.senderTgUsername} (message ${tx.id})` :
      `${tx.senderId} (transaction ${tx.id})`;

    log.log(`commandTxs: Processing '${commandMsg}' from ${from}…`);

    let group = commandMsg
        .trim()
        .replace(/ {2,}/g, ' ')
        .split(' ');
    let commandName = group.shift().trim().toLowerCase().replace('/', '');

    const alias = aliases[commandName];
    if (alias) {
      const aliasedCommand = alias(group).trim();
      log.log(`commandTxs: Alias '${commandMsg}' resolved to '${aliasedCommand}'`);
      group = aliasedCommand
          .trim()
          .replace(/ {2,}/g, ' ')
          .split(' ');
      commandName = group.shift().trim().toLowerCase().replace('/', '');
    }

    const command = commands[commandName];

    if (command) {
      commandResult = await command(group, tx, itx?.commandFix); // commandFix is for /help only
    } else {
      return formSendBackMessage(`I don’t know */${commandName}* command. ℹ️ You can start with **/help**.`);
    }

    if (commandResult?.msgNotify) {
      notify(`${commandResult.msgNotify} Action is executed by ${from}.`, commandResult.notifyType);
    }

    log.debug(`commandTxs: Command /${commandName} completed for ${from}.`);

    if (itx) {
      await itx.update({ isProcessed: true }, true);
    }

    if (commandName !== 'y') {
      utils.saveConfig(false, `After-commandTxs(/${commandName})`);
    }
  } catch (e) {
    const failedTx = /** @type {CommandTx} */ (tx || { id: 'unknown', senderId: 'unknown' });

    if (failedTx.senderTgUsername) {
      log.error(`commandTxs: Error while processing ${commandMsg} from ${failedTx.senderTgUsername} (message ${failedTx.id}): ${e}`);
    } else {
      log.error(`commandTxs: Error while processing ${commandMsg} from ${failedTx.senderId} (transaction ${failedTx.id}): ${e}`);
    }
  }

  return commandResult;
};

module.exports.commands = commands;
