// @ts-nocheck — thin wrappers around commandTxs markdown commands.
'use strict';

const config = require('../../modules/configReader');
const notify = require('../../helpers/notify');
const { commands } = require('../../modules/commandTxs');
const { BadRequestError } = require('../lib/errors');
const webuiLog = require('../lib/webuiLog');
const { resolvePair } = require('./market');
const { bumpParamsRevision } = require('./params');
const { broadcastParamsUpdated } = require('../ws');

/**
 * After a command mutates tradeParams via saveConfig(true), push a WS envelope
 * so WebUI clients refresh without waiting for the next poll.
 */
function broadcastWebUiParamsChange(requestId = null) {
  const payload = bumpParamsRevision('webui', requestId);
  broadcastParamsUpdated(undefined, payload);
}

/**
 * Command handlers often return 200 with an error sentence in `msgSendBack`.
 * Treat those as HTTP 400 so WebUI toasts and the console show them as failures.
 *
 * @param {string | undefined} msg
 * @returns {boolean}
 */
function looksLikeCommandError(msg) {
  const text = String(msg || '').replace(/[*_]/g, '').trim();
  return /^(Wrong|Unable|Set |Unknown|Incorrect|The feature|It seems|Depth|Trading pair|I don't|Specify |Not enough|Failed |Error |Request to place|Cannot )/i.test(text);
}

/**
 * @param {{ msgSendBack?: string, isError?: boolean } | undefined} result
 * @param {string} [fallback]
 * @returns {string}
 */
function requireCommandMessage(result, fallback = 'Command failed') {
  const message = result?.msgSendBack || fallback;
  if (!result || result.isError || looksLikeCommandError(message)) {
    throw new BadRequestError(message);
  }
  return message;
}

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
  withdraw,
  cancel,
  order,
  convert,
  account,
  volume,
  enable,
  disable,
  twap,
  pair,
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
 * Logs command intake in the classic `Processing … from …` form, with optional params.
 *
 * @param {'info'|'debug'} level
 * @param {string} name Command label (e.g. `start`, `buy`, `stop making price`)
 * @param {string} login Operator login
 * @param {Record<string, unknown> | undefined} [params] Compact request params
 */
function logProcessing(level, name, login, params) {
  let suffix = '';
  if (params && Object.keys(params).length) {
    try {
      suffix = ` ${JSON.stringify(params)}`;
    } catch {
      suffix = '';
    }
  }
  webuiLog[level](`Processing ${name}${suffix} command from ${login}…`);
}

/**
 * @param {string} login
 */
function runStart(login) {
  logProcessing('info', 'start', login);
  const { msgSendBack, msgNotify, notifyType } = start([]);
  notifyAction(login, msgNotify, notifyType);
  saveConfig(true, 'WebUI-commands-start()');
  broadcastWebUiParamsChange();
  return { message: msgSendBack };
}

/**
 * @param {string} login
 */
function runStop(login) {
  logProcessing('info', 'stop', login);
  const { msgSendBack, msgNotify, notifyType } = stop(['mm']);
  notifyAction(login, msgNotify, notifyType);
  saveConfig(true, 'WebUI-commands-stop()');
  broadcastWebUiParamsChange();
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {{ market: string, type: string, force: boolean, side?: 'buy' | 'sell', priceOp?: '<' | '>', price?: number }} body
 */
async function runClear(login, body) {
  const market = resolvePair(body.market);
  const args = [market, body.type];
  if (body.side) {
    args.push(body.side);
  }
  if (body.priceOp && body.price !== undefined) {
    args.push(`${body.priceOp}${body.price}`, config.coin2);
  }
  if (body.force) {
    args.push('force');
  }
  logProcessing('info', 'clear', login, {
    market,
    type: body.type,
    side: body.side,
    priceOp: body.priceOp,
    price: body.price,
    force: body.force,
  });
  const result = await clear(args);
  notifyAction(login, result?.msgNotify, result?.notifyType);
  return { message: requireCommandMessage(result) };
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

  logProcessing('info', body.side, login, {
    market,
    type: body.type,
    price: body.price,
    baseAmount: body.baseAmount,
    quoteAmount: body.quoteAmount,
  });
  const commandResult = body.side === 'buy' ?
    await buy(args) :
    await sell(args);

  notifyAction(login, commandResult?.msgNotify, commandResult?.notifyType);
  return { message: requireCommandMessage(commandResult, 'Unable to place order') };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runFill(login, body) {
  const market = resolvePair(body.market);
  logProcessing('info', 'fill', login, {
    market,
    side: body.side,
    from: body.price?.from,
    to: body.price?.to,
    baseAmount: body.baseAmount,
    quoteAmount: body.quoteAmount,
    count: body.count,
  });

  const result = await fill([
    market,
    body.side,
    body.side === 'sell' ? `amount=${body.baseAmount}` : `quote=${body.quoteAmount}`,
    `low=${body.price.from}`,
    `high=${body.price.to}`,
    `count=${body.count}`,
  ]);

  notifyAction(login, result?.msgNotify, result?.notifyType);
  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runMake(login, body) {
  logProcessing('info', 'make', login, {
    price: body.price,
    when: body.when,
    period: body.period,
    periodType: body.periodType,
    confirm: Boolean(body.confirm),
  });

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

  notifyAction(login, commandResult?.msgNotify, commandResult?.notifyType);

  if (!body.confirm) {
    const preview = commandResult?.msgSendBack || 'Confirm this command?';
    if (looksLikeCommandError(preview)) {
      throw new BadRequestError(preview);
    }
    return { confirmMessage: preview };
  }

  saveConfig(true, 'WebUI-commands-make()');
  broadcastWebUiParamsChange();
  return { message: requireCommandMessage(commandResult) };
}

/**
 * @param {string} login
 */
async function runStopMakingPrice(login) {
  logProcessing('info', 'stop making price', login);
  const { msgSendBack, msgNotify, notifyType } = await make(['price', 'stop']);
  notifyAction(login, msgNotify, notifyType);
  saveConfig(true, 'WebUI-commands-stopMakingPrice()');
  broadcastWebUiParamsChange();
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} authUser
 * @param {{ allCoins?: boolean, scope?: 'pair' | 'priority' | 'allcoins', accountType?: string }} [query]
 */
async function runBalances(login, authUser, query = {}) {
  const args = [];
  if (query.scope) {
    args.push(query.scope);
  } else if (query.allCoins) {
    args.push('allcoins');
  }
  if (query.accountType) {
    args.push(query.accountType);
  }
  logProcessing('debug', 'balances', login, query);
  const result = await balances(args, { id: `webui:${login}`, senderId: login }, authUser, true);
  notifyAction(login, result?.msgNotify, result?.notifyType);
  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {string | undefined} marketInput
 */
async function runStats(login, marketInput) {
  const market = resolvePair(marketInput);
  logProcessing('debug', 'stats', login, { market });
  const { msgNotify, msgSendBack, notifyType } = await stats([market]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {{ market?: string, type?: string, full?: boolean }} query
 */
async function runOrders(login, query = {}) {
  const market = resolvePair(query.market);
  const args = [market];
  if (query.type && query.type !== 'all') {
    args.push(query.type);
  }
  if (query.full) {
    args.push('full');
  }
  logProcessing('debug', 'orders', login, { market, type: query.type, full: Boolean(query.full) });
  const result = await orders(args);
  notifyAction(login, result?.msgNotify, result?.notifyType);
  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {string | undefined} marketInput
 */
async function runRates(login, marketInput) {
  const market = resolvePair(marketInput);
  logProcessing('debug', 'rates', login, { market });
  const { msgSendBack, msgNotify, notifyType } = await rates([market]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string | undefined} marketInput
 */
async function runPair(login, marketInput) {
  const market = resolvePair(marketInput);
  logProcessing('debug', 'pair', login, { market });
  const result = await pair([market]);
  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {object} query
 */
async function runCalc(login, query) {
  logProcessing('debug', 'calc', login, {
    amount: query.amount,
    coinFrom: query.coinFrom,
    coinTo: query.coinTo,
  });
  const result = await calc([String(query.amount), query.coinFrom, 'in', query.coinTo]);
  notifyAction(login, result?.msgNotify, result?.notifyType);
  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {string} coin
 */
async function runDeposit(login, coin) {
  logProcessing('debug', 'deposit', login, { coin });
  const { msgNotify, msgSendBack, notifyType } = await deposit([coin]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {object} query
 */
async function runShow(login, query) {
  logProcessing('debug', 'show', login, { mode: query.mode, coin: query.coin, count: query.count });
  const { msgSendBack } = await show([query.mode, query.coin, query.count]);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {string} coin
 */
async function runInfo(login, coin) {
  logProcessing('debug', 'info', login, { coin });
  const { msgSendBack } = await info([coin]);
  return { message: msgSendBack };
}

/**
 * Moves funds between exchange sub-accounts (`POST /commands/transfer`).
 *
 * @param {string} login Operator login
 * @param {{ amount: number, coin: string, from: string, to: string }} body Validated request body
 * @returns {Promise<{ message: string }>}
 */
async function runTransfer(login, body) {
  logProcessing('info', 'transfer', login, {
    amount: body.amount,
    coin: body.coin,
    from: body.from,
    to: body.to,
  });
  const result = await transfer([
    String(body.amount),
    body.coin,
    'from',
    body.from,
    'to',
    body.to,
  ]);
  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runWithdraw(login, body) {
  if (typeof withdraw !== 'function') {
    throw new BadRequestError('Withdraw command is not available in this build');
  }
  logProcessing('info', 'withdraw', login, {
    address: body.address,
    amount: body.amount,
    coin: body.coin,
    network: body.network,
    secondAccount: Boolean(body.secondAccount),
  });
  const args = [
    body.address,
    String(body.amount),
    body.coin,
    body.network || '',
    body.secondAccount ? '-2' : '',
    body.confirm ? '-y' : '',
  ].filter(Boolean);
  const result = await withdraw(args, {}, true);
  notifyAction(login, result?.msgNotify, result?.notifyType);

  if (!body.confirm && result?.msgSendBack && /^Are you sure/i.test(result.msgSendBack.replace(/[*_]/g, ''))) {
    return { confirmMessage: result.msgSendBack };
  }

  return { message: requireCommandMessage(result) };
}

/**
 * @param {string} login
 * @param {{ market?: string, id: string, side?: 'buy' | 'sell' }} body
 */
async function runCancel(login, body) {
  const market = body.market ? resolvePair(body.market) : config.pair;
  const side = body.side === 'buy' || body.side === 'sell' ? body.side : undefined;
  logProcessing('info', 'cancel', login, { market, id: body.id, side });
  const args = [market];
  if (side) {
    args.push(side);
  }
  args.push(body.id);
  const { msgSendBack, msgNotify, notifyType } = await cancel(args);
  notifyAction(login, msgNotify, notifyType);
  return { message: requireCommandMessage({ msgSendBack }) };
}

/**
 * @param {string} login
 * @param {{ market?: string, id: string }} query
 */
async function runOrder(login, query) {
  const market = query.market ? resolvePair(query.market) : config.pair;
  logProcessing('debug', 'order', login, { market, id: query.id });
  const { msgSendBack } = await order([market, query.id]);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {{ amount: number, coinFrom: string, coinTo: string }} body
 */
async function runConvert(login, body) {
  logProcessing('info', 'convert', login, body);
  const { msgSendBack, msgNotify, notifyType } = await convert([
    String(body.amount),
    body.coinFrom,
    'to',
    body.coinTo,
  ]);
  notifyAction(login, msgNotify, notifyType);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 */
async function runAccount(login) {
  logProcessing('debug', 'account', login);
  const { msgSendBack } = await account([], {}, true);
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {{ amount: number }} body
 */
function runVolume(login, body) {
  logProcessing('info', 'volume', login, { amount: body.amount });
  const { msgSendBack, isError, errorField } = volume([String(body.amount), config.coin1]);
  if (isError) {
    throw new BadRequestError({
      fields: { [errorField || 'volume']: msgSendBack },
    });
  }
  saveConfig(true, 'WebUI-commands-volume()');
  broadcastWebUiParamsChange();
  return { message: msgSendBack };
}

/**
 * @param {string} login
 * @param {{ feature: string, args?: string[] }} body
 */
async function runEnable(login, body) {
  const args = [body.feature, ...(body.args || [])];
  logProcessing('info', 'enable', login, { feature: body.feature, args: body.args });
  const reply = await enable(args, null, true);
  if (reply?.isError) {
    throw new BadRequestError({
      fields: { [reply.errorField || body.feature]: reply.msgSendBack },
    });
  }
  notifyAction(login, reply.msgNotify, reply.notifyType);
  saveConfig(true, 'WebUI-commands-enable()');
  broadcastWebUiParamsChange();
  return { message: reply.msgSendBack };
}

/**
 * @param {string} login
 * @param {{ feature: string, args?: string[] }} body
 */
function runDisable(login, body) {
  const args = [body.feature, ...(body.args || [])];
  logProcessing('info', 'disable', login, { feature: body.feature, args: body.args });
  const reply = disable(args);
  notifyAction(login, reply.msgNotify, reply.notifyType);
  saveConfig(true, 'WebUI-commands-disable()');
  broadcastWebUiParamsChange();
  return { message: reply.msgSendBack };
}

/**
 * @param {string} login
 * @param {object} body
 */
async function runTwap(login, body) {
  if (typeof twap !== 'function') {
    throw new BadRequestError('TWAP module is not available in this build');
  }

  if (body.stop) {
    logProcessing('info', 'twap stop', login);
    const result = await twap(['stop'], { id: `webui:${login}` });
    saveConfig(true, 'WebUI-commands-twap()');
    broadcastWebUiParamsChange();
    return { message: requireCommandMessage(result) };
  }

  const market = resolvePair(body.market);
  const args = [
    market,
    body.side,
    body.amount !== undefined ? `amount=${body.amount}` : '',
    body.minPrice !== undefined ? `minprice=${body.minPrice}` : '',
    body.maxPrice !== undefined ? `maxprice=${body.maxPrice}` : '',
    body.time ? `time=${body.time}` : '',
    body.interval ? `interval=${body.interval}` : '',
    body.strategy ? `strategy=${body.strategy}` : '',
    body.confirm ? '-y' : '',
  ].filter(Boolean);

  logProcessing('info', 'twap', login, body);
  const result = await twap(args, { id: `webui:${login}` }, true);
  notifyAction(login, result?.msgNotify, result?.notifyType);

  if (!body.confirm) {
    const preview = result?.msgSendBack || 'Confirm this command?';
    if (looksLikeCommandError(preview)) {
      throw new BadRequestError(preview);
    }
    return { confirmMessage: preview };
  }

  saveConfig(true, 'WebUI-commands-twap()');
  broadcastWebUiParamsChange();
  return { message: requireCommandMessage(result) };
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
  runPair,
  runCalc,
  runDeposit,
  runShow,
  runInfo,
  runTransfer,
  runWithdraw,
  runCancel,
  runOrder,
  runConvert,
  runAccount,
  runVolume,
  runEnable,
  runDisable,
  runTwap,
};
