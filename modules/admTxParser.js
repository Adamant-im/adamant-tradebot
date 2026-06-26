/**
 * @module modules/admTxParser
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').IncomingAdmTxDbRecord} IncomingAdmTxDbRecord
 * @typedef {import('types/bot/adamant.d.js').ProcessedAdmTxCacheEntry} ProcessedAdmTxCacheEntry
 * @typedef {import('types/bot/adamant.d.js').AdmMessageDirective} AdmMessageDirective
 * @typedef {import('types/bot/adamant.d.js').ParseAdmTx} ParseAdmTx
 * @typedef {import('types/bot/general.d.js').CommandReply} CommandReply
 */

const db = require('./DB');
const log = require('../helpers/log');
const utils = require('../helpers/utils');
const config = require('./configReader');
const constants = require('../helpers/const');

const transferTxs = require('./transferTxs');
const commandTxs = require('./commandTxs');
const unknownTxs = require('./unknownTxs');
const Store = require('./Store');

const adamantApi = require('./adamantApi');
const { decodeMessage } = require('adamant-api');

/** @type {Record<string, ProcessedAdmTxCacheEntry>} */
const processedTxs = {};

/** ADM addresses that already received the non-admin auto-reply in this process. */
const nonAdmins = [];

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

log.log(`Module ${moduleName} is loaded.`);

/**
 * Parses one incoming ADM transaction and dispatches it to transfer, command,
 * or unknown-message handlers.
 *
 * Deduplicates by in-memory cache and `incomingtxs` collection. Socket-first
 * deliveries may lack block height until the REST checker enriches the record.
 *
 * @type {ParseAdmTx}
 */
module.exports = async (tx) => {
  try {
    // First deduplication layer: in-memory cache for the current process.
    if (processedTxs[tx.id]) {
      // Transactions received via socket have no `height` until confirmed via REST.
      if (!processedTxs[tx.id].height) {
        log.debug(
            `ADM tx parser: Transaction ${tx.id} was already processed via socket; ` +
            `updating with block height ${tx.height} from REST.`,
        );
        await updateProcessedTx(tx, null, true);
      }
      return;
    }

    // Second deduplication layer: persistent DB record from a previous run.
    const { incomingTxsDb } = db;
    const knownTx = await incomingTxsDb.findOne({ _id: tx.id });
    if (knownTx !== null) {
      if (!knownTx.height || !processedTxs[tx.id]) {
        if (!knownTx.height && tx.height) {
          log.debug(
              `ADM tx parser: Transaction ${tx.id} was already processed via socket; ` +
              `updating with block height ${tx.height} from REST.`,
          );
        }
        await updateProcessedTx(tx, knownTx, Boolean(knownTx.height && processedTxs[tx.id]));
      }
      return;
    }

    const deliveryChannel = tx.height ? 'REST' : 'socket';
    log.log(
        `ADM tx parser: Processing new incoming transaction ${tx.id} ` +
        `from ${tx.senderId} via ${deliveryChannel}.`,
    );

    let decryptedMessage = '';
    const chat = tx.asset ? tx.asset.chat : '';
    if (chat) {
      decryptedMessage = decodeMessage(
          chat.message,
          tx.senderPublicKey,
          config.passPhrase,
          /** @type {string | undefined} */ (chat.own_message),
      ).trim();
    }

    // Normalize common user typos before routing.
    let commandFix = '';
    if (decryptedMessage.toLowerCase() === 'help') {
      decryptedMessage = '/help';
      commandFix = 'help';
    }
    if (decryptedMessage.toLowerCase() === '/balance') {
      decryptedMessage = '/balances';
      commandFix = 'balance';
    }

    /** @type {AdmMessageDirective} */
    let messageDirective = 'unknown';
    if (decryptedMessage.includes('_transaction') || tx.amount > 0) {
      messageDirective = 'transfer';
    } else if (decryptedMessage.startsWith('/')) {
      messageDirective = 'command';
    }

    /** @type {IncomingAdmTxDbRecord} */
    const itx = new incomingTxsDb({
      _id: tx.id,
      txid: tx.id,
      date: utils.unixTimeStampMs(),
      timestamp: tx.timestamp,
      amount: tx.amount,
      fee: tx.fee,
      type: messageDirective,
      senderId: tx.senderId,
      senderPublicKey: tx.senderPublicKey,
      recipientPublicKey: tx.recipientPublicKey,
      messageDirective, // 'command', 'transfer' or 'unknown'
      encrypted_content: decryptedMessage,
      spam: false,
      isProcessed: false,
      isNonAdmin: false,
      commandFix,
      // Undefined for socket-first delivery; stored when REST enriches the record.
      blockId: tx.blockId,
      height: tx.height,
      block_timestamp: tx.block_timestamp,
      confirmations: tx.confirmations,
      // Present only for socket-first delivery.
      relays: tx.relays,
      receivedAt: tx.receivedAt,
    });

    if (!config.admin_accounts.includes(tx.senderId)) {
      log.warn(
          `${config.notifyName} received a message from non-admin user _${tx.senderId}_. ` +
          `Ignoring. Incoming ADAMANT tx: https://explorer.adamant.im/tx/${tx.id}.`,
      );

      itx.update({
        isProcessed: true,
        isNonAdmin: true,
      }, true);

      if (config.notify_non_admins && !nonAdmins.includes(tx.senderId)) {
        const notAdminMsg = 'I won\'t execute your commands as you are not an admin. Connect with my master.';

        const api = adamantApi();
        api.sendMessage(config.passPhrase, tx.senderId, notAdminMsg).then((response) => {
          if (!response.success) {
            const details = 'errorMessage' in response ? response.errorMessage : 'No details.';
            log.warn(
                `ADM tx parser: Failed to send non-admin reply to ${tx.senderId}. ` +
                `${details || 'No details.'}`,
            );
          } else {
            nonAdmins.push(tx.senderId);
            log.log(`ADM tx parser: Sent non-admin reply to ${tx.senderId}.`);
          }
        });
      }

      await updateProcessedTx(tx, itx, true);
      return;
    }

    await updateProcessedTx(tx, itx, true);

    switch (messageDirective) {
      case 'transfer': {
        transferTxs(itx, tx);
        break;
      }

      case 'command': {
        /** @type {CommandReply | undefined} */
        const commandResult = await commandTxs(decryptedMessage, tx, itx);

        if (commandResult?.msgSendBack) {
          const chunks = utils.chunkString(commandResult.msgSendBack, constants.MAX_ADM_MESSAGE_LENGTH);
          const api = adamantApi();

          for (const chunk of chunks) {
            const response = await api.sendMessage(config.passPhrase, tx.senderId, chunk);
            if (response && !response.success) {
              const details = 'errorMessage' in response ? response.errorMessage : 'No details.';
              log.warn(
                  `ADM tx parser: Failed to send command reply chunk to ${tx.senderId}. ` +
                  `${details || 'No details.'}`,
              );
            }
          }
        }

        break;
      }

      default: {
        unknownTxs(tx, itx);
        break;
      }
    }
  } catch (error) {
    log.error(`Error in admTxParser for transaction ${tx?.id || 'unknown'}: ${error}`);
  }
};

/**
 * Marks a transaction as processed in the in-memory cache and optionally
 * persists block metadata to `incomingtxs`.
 *
 * Also advances the ADM block cursor in `Store` when a height is available.
 *
 * @param {AdamantIncomingTx} tx Incoming ADM transaction
 * @param {IncomingAdmTxDbRecord | null} itx Existing DB record, if any
 * @param {boolean} updateDb Whether to persist block metadata to the database
 * @returns {Promise<void>}
 */
async function updateProcessedTx(tx, itx, updateDb) {
  processedTxs[tx.id] = {
    updated: utils.unixTimeStampMs(),
    height: tx.height,
  };

  if (updateDb && !itx) {
    itx = await db.incomingTxsDb.findOne({ txid: tx.id });
  }

  if (updateDb && itx) {
    await itx.update({
      blockId: tx.blockId,
      height: tx.height,
      block_timestamp: tx.block_timestamp,
      confirmations: tx.confirmations,
    }, true);
  }

  await Store.updateLastProcessedBlockHeight(tx.height);
}
