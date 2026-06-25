// @ts-nocheck — thin wrappers around commandTxs markdown commands.
'use strict';

const config = require('../../modules/configReader');
const log = require('../../helpers/log');
const notify = require('../../helpers/notify');
const { commands } = require('../../modules/commandTxs');
const { BadRequestError } = require('../lib/errors');
const { resolvePair } = require('./market');

const {
  saveConfig,
  start,
  stop,
  clear,
  buy,
  sell,
  fill,
  make,
  balances,
  stats,
  orders,
  rates,
  calc,
  deposit,
  show,
  info,
  transfer,
} = commands;

/**
 * @param {string} login
 * @param {string} msgNotify
 * @param {string} notifyType
 */
function notifyAction(login, msgNotify, notifyType) {
  if (msgNotify) {
    notify(`${msgNotify} Action is executed by ${login}.`, notifyType);
  }
}

/**
 * @param {string} login
 * @param {string} strategy
 */
function runStart(login, strategy) {
  log.log(`Processing start command from ${login}…`);
  const { msgSendBack, msgNotify, notifyType } = start(['mm', strategy]);
  notifyAction(login, msgNotify, notifyType);
  saveConfig(true, 'WebUI-commands-start()');
  return { message: msgSendBack };
}

/**
 * @param {string} login
 */
function runStop(login) {
  log.log(`Processing stop command from ${login}…`);
  const { msgSendBack, msgNotify, notifyType } = stop(['mm']);
  notifyAction(login, msgNotify, notifyType);
  saveConfig(true, 'WebUI-commands-stop()');
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {{ market: string, type: string, force: boolean }} body
 */
async function runClear(login, body) {
  const market = resolvePair(body.market);
  log.log(`Processing clear command from ${login}…`);
  const { msgNotify, msgSendBack, notifyType } = await clear([
    market,
    body.type,
    body.force ? 'force' : '',
  ]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runPlaceOrder(login, body) {
  const market = resolvePair(body.market);

  if (body.side !== 'buy' && body.side !== 'sell') {
    throw new BadRequestError('side must be buy or sell');
  }

  const args = [
    market,
    body.baseAmount ? `amount=${body.baseAmount}` : `quote=${body.quoteAmount}`,
    body.type === 'limit' ? `price=${body.price}` : '',
  ];

  log.log(`Processing ${body.side} command from ${login}…`);
  const commandResult = body.side === 'buy' ?
    await buy(args) :
    await sell(args);

  notifyAction(login, commandResult.msgNotify, commandResult.notifyType);
  return { message: commandResult.msgSendBack };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runFill(login, body) {
  const market = resolvePair(body.market);
  log.log(`Processing fill command from ${login}…`);

  const { msgSendBack, msgNotify, notifyType } = await fill([
    market,
    body.side,
    body.side === 'sell' ? `amount=${body.baseAmount}` : `quote=${body.quoteAmount}`,
    `low=${body.price.from}`,
    `high=${body.price.to}`,
    `count=${body.count}`,
  ]);

  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runMake(login, body) {
  log.log(`Processing make command from ${login}…`);

  let commandResult;

  if (body.when === 'now') {
    commandResult = await make(
        ['price', String(body.price), config.coin2, body.when, body.confirm && '-y'],
        {},
        true,
    );
  } else {
    commandResult = await make([
      'price',
      String(body.price),
      config.coin2,
      'in',
      String(body.period),
      body.periodType,
      body.confirm && '-y',
    ], {}, true);
  }

  notifyAction(login, commandResult.msgNotify, commandResult.notifyType);
  saveConfig(true, 'WebUI-commands-make()');

  if (body.confirm) {
    return { message: commandResult.msgSendBack };
  }

  return { confirmMessage: commandResult.msgSendBack };
}

/**
 * @param {string} login
 */
async function runStopMakingPrice(login) {
  log.log(`Processing stop making price command from ${login}…`);
  const { msgSendBack, msgNotify, notifyType } = await make(['price', 'stop']);
  notifyAction(login, msgNotify, notifyType);
  saveConfig(true, 'WebUI-commands-stopMakingPrice()');
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} authUser
 */
async function runBalances(login, authUser) {
  log.log(`Processing balances command from ${login}…`);
  const { msgNotify, msgSendBack, notifyType } = await balances({}, {}, authUser, true);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string | undefined} marketInput
 */
async function runStats(login, marketInput) {
  const market = resolvePair(marketInput);
  log.log(`Processing stats command from ${login}…`);
  const { msgNotify, msgSendBack, notifyType } = await stats([market]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string | undefined} marketInput
 */
async function runOrders(login, marketInput) {
  const market = resolvePair(marketInput);
  log.log(`Processing orders command from ${login}…`);
  const { msgSendBack, msgNotify, notifyType } = await orders([market]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string | undefined} marketInput
 */
async function runRates(login, marketInput) {
  const market = resolvePair(marketInput);
  log.log(`Processing rates command from ${login}…`);
  const { msgSendBack, msgNotify, notifyType } = await rates([market]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} query
 */
async function runCalc(login, query) {
  log.log(`Processing calc command from ${login}…`);
  const { msgSendBack, msgNotify, notifyType } = await calc(
      [String(query.amount), query.coinFrom, 'in', query.coinTo],
      {},
      true,
  );
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string} coin
 */
async function runDeposit(login, coin) {
  log.log(`Processing deposit command from ${login}…`);
  const { msgNotify, msgSendBack, notifyType } = await deposit([coin]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} query
 */
async function runShow(login, query) {
  log.log(`Processing show command from ${login}…`);
  const { msgSendBack } = await show([query.mode, query.coin, query.count]);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string} coin
 */
async function runInfo(login, coin) {
  log.log(`Processing info command from ${login}…`);
  const { msgSendBack } = await info([coin]);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} query
 */
async function runTransfer(login, query) {
  log.log(`Processing transfer command from ${login}…`);
  const { msgSendBack } = await transfer([
    String(query.amount),
    query.coin,
    'from',
    query.from,
    'to',
    query.to,
  ]);
  return { message: msgSendBack };
}

module.exports = {
  runStart,
  runStop,
  runClear,
  runPlaceOrder,
  runFill,
  runMake,
  runStopMakingPrice,
  runBalances,
  runStats,
  runOrders,
  runRates,
  runCalc,
  runDeposit,
  runShow,
  runInfo,
  runTransfer,
};
