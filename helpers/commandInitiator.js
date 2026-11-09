'use strict';

/**
 * Identifies who sent a bot command, over which channel, and whether ComServer may relay that sender.
 *
 * @module helpers/commandInitiator
 * @typedef {import('types/bot/commandTxs.d.js').CommandInitiator} CommandInitiator
 * @typedef {import('types/bot/commandTxs.d.js').CommandTx} CommandTx
 */

const config = require('../modules/configReader');
const constants = require('./const');
const utils = require('./utils');

/** Optional: `telegramBot/` is omitted from trimmed builds, and Telegram senders are then not trusted. */
const telegramAdminsModule = utils.softRequire('../telegramBot/admins');
const telegramAdmins = telegramAdminsModule?.parseTelegramAdmins(config.admin_telegram);

/** Prefix of tx ids built by the WebUI API, followed by the operator login */
const WEBUI_TX_PREFIX = 'webui:';

/** Extracts the username from a `senderTgUsername` label such as `@alice (id 123)` */
const TELEGRAM_USERNAME_REGEXP = /^@(\S+) \(id \d+\)$/;

/**
 * Resolves the channel a transaction was built for, ignoring how it reached this bot.
 *
 * @param {CommandTx | null} [tx] Command transaction
 * @returns {CommandInitiator | undefined} `undefined` when the sender cannot be identified
 */
function resolveInitiator(tx) {
  if (typeof tx?.id === 'string' && tx.id.startsWith(WEBUI_TX_PREFIX)) {
    const login = tx.id.slice(WEBUI_TX_PREFIX.length);

    return login ? { source: 'webui', initiatorId: login } : undefined;
  }

  if (tx?.senderTgUsername) {
    return Number.isSafeInteger(tx.senderId) ?
      { source: 'telegram', initiatorId: String(tx.senderId) } :
      undefined;
  }

  if (tx?.senderShellUsername) {
    return { source: 'cli', initiatorId: tx.senderShellUsername };
  }

  if (typeof tx?.senderId === 'string' && constants.REGEXP_ADM_ADDRESS.test(tx.senderId)) {
    return { source: 'adm', initiatorId: tx.senderId };
  }

  return undefined;
}

/**
 * Returns the sender of a command and its channel. Commands relayed by ComServer get their own channel.
 *
 * @param {CommandTx | null} [tx] Command transaction
 * @returns {CommandInitiator | undefined} `undefined` when the sender cannot be identified
 */
function getCommandInitiator(tx) {
  const initiator = resolveInitiator(tx);

  if (!initiator || !tx.viaComServer) {
    return initiator;
  }

  return {
    ...initiator,
    source: /** @type {CommandInitiator['source']} */ (`comserver-${initiator.source}`),
  };
}

/**
 * Checks a command relayed by ComServer against this bot's own operator lists.
 *
 * Applies the same allowlists as the direct ADAMANT and Telegram entry points. Only those two channels
 * can be relayed: the CLI instance never connects to ComServer, and the WebUI API sends no remote commands.
 *
 * @param {CommandTx | null} [tx] Transaction relayed in the `remote-command` payload
 * @returns {boolean} True when this bot lists the sender as an operator
 */
function isTrustedRemoteOperator(tx) {
  const initiator = resolveInitiator(tx);

  if (initiator?.source === 'adm') {
    return config.admin_accounts.includes(initiator.initiatorId);
  }

  if (initiator?.source === 'telegram' && telegramAdminsModule) {
    const username = TELEGRAM_USERNAME_REGEXP.exec(tx.senderTgUsername)?.[1];

    return Boolean(telegramAdminsModule.matchTelegramAdmin({ id: tx.senderId, username }, telegramAdmins));
  }

  return false;
}

module.exports = {
  getCommandInitiator,
  isTrustedRemoteOperator,
};
