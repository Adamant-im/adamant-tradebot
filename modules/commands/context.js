'use strict';

/**
 * @module modules/commands/context
 * @typedef {import('types/bot/commandTxs.d.js').PendingConfirmationState} PendingConfirmationState
 * @typedef {import('types/bot/commandTxs.d.js').PreviousBalancesCache} PreviousBalancesCache
 * @typedef {import('types/bot/commandTxs.d.js').PreviousOrdersCache} PreviousOrdersCache
 */

const constants = require('../../helpers/const');
const utils = require('../../helpers/utils');
const exchangerUtils = require('../../helpers/cryptos/exchanger');
const config = require('../configReader');
const log = require('../../helpers/log');
const notify = require('../../helpers/notify');
const adamantApi = require('../adamantApi');

/** @type {import('axios').AxiosInstance} */
// @ts-ignore: axios is a callable instance
const axios = require('axios');

const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
const orderCollector = require('../../trade/orderCollector');
const orderStats = require('../../trade/orderStats');
const orderUtils = require('../../trade/orderUtils');
const balancesHistory = require('../../helpers/balancesHistory');

const TraderApi = require('../../trade/trader_' + config.exchange);

const perpetualEnabled = Boolean(config.perpetual);
const perpetualApiModule = '../perpetualApi'; // Optional: perpetualApi module exists only in perpetual builds
const perpetualApiFactory = perpetualEnabled ? utils.softRequire(perpetualApiModule, __filename) : undefined;
const perpetualApi = perpetualApiFactory ? perpetualApiFactory() : undefined;

const botInterchangeModule = utils.softRequire('../botInterchange', __filename);
const botInterchange = botInterchangeModule?.botInterchange;
const { encrypt, decrypt } = require('../../helpers/encryption');

const telegramBot = utils.createTelegramBotApi(config.manageTelegramBotToken);
const escapeMarkdownTelegram = utils.escapeMarkdownTelegram.bind(utils);

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

/** @type {typeof traderapi | undefined} */
let traderapi2;
if (config.apikey2) {
  traderapi2 = TraderApi(
      config.apikey2,
      config.apisecret2,
      config.apipassword2,
      log,
      undefined,
      undefined,
      config.exchange_socket,
      config.exchange_socket_pull,
      1,
  );
  traderapi2.isSecondAccount = true;
}

const timeToConfirm = 1000 * 60 * 10; // 10 minutes to confirm a pending `/y` command

/** @type {PendingConfirmationState} */
const pendingConfirmation = {
  command: '',
  timestamp: 0,
};

/** @type {PreviousBalancesCache} */
const previousBalances = [
  {}, // balances of the first trade account
  {}, // balances of the second trade account
  {}, // sum of balances for both trade accounts
];
/**
 * accountNo -> userId -> balances object
 * {
 *   userId: {
 *     timestamp,
 *     balances: balances for userId/senderId @timestamp
 *   }
 * }
 */

/** @type {PreviousOrdersCache} */
const previousOrders = [
  {}, // orders of the first trade account
  {}, // orders of the second trade account
];

const moduleName = 'commandTxs';

log.log(`Module ${moduleName} is loaded.`);

module.exports = {
  constants,
  utils,
  exchangerUtils,
  config,
  log,
  notify,
  adamantApi,
  axios,
  tradeParams,
  orderCollector,
  orderStats,
  orderUtils,
  balancesHistory,
  TraderApi,
  traderapi,
  traderapi2,
  perpetualApi,
  perpetualEnabled,
  botInterchange,
  encrypt,
  decrypt,
  escapeMarkdownTelegram,
  telegramBot,
  timeToConfirm,
  pendingConfirmation,
  previousBalances,
  previousOrders,
  moduleName,
};
