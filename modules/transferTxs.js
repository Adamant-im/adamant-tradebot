'use strict';

/**
 * @module modules/transferTxs
 * @typedef {import('types/bot/transferTxs.d.js').HandleTransferTx} HandleTransferTx
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').IncomingAdmTxDbRecord} IncomingAdmTxDbRecord
 */

const notify = require('../helpers/notify');
const config = require('./configReader');
const utils = require('../helpers/utils');
const adamantApi = require('./adamantApi');
const log = require('../helpers/log');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

const THANK_YOU_MESSAGE = 'I got your transfer. Thanks, bro.';

log.log(`Module ${moduleName} is loaded.`);

/**
 * Handles a bare ADM transfer sent to the bot (no chat command attached).
 *
 * Persists `isProcessed`, notifies operators, and replies to the sender.
 *
 * @param {IncomingAdmTxDbRecord} itx `incomingtxs` ORM record for this transaction
 * @param {AdamantIncomingTx} tx Incoming ADM transaction from the blockchain API
 * @returns {Promise<void>}
 */
async function handleTransferTx(itx, tx) {
  try {
    const msgNotify =
        `${config.notifyName} received a transfer transaction. ` +
        `Incoming ADM tx: https://explorer.adamant.im/tx/${tx.id}.`;
    const notifyType = 'log';

    log.log(
        `Transfer tx: Processing ADM transfer of ${tx.amount} sat from ${tx.senderId} ` +
        `(transaction ${tx.id}).`,
    );

    await itx.update({ isProcessed: true }, true);

    notify(msgNotify, notifyType);

    const api = adamantApi();
    const response = await api.sendMessage(config.passPhrase, tx.senderId, THANK_YOU_MESSAGE);

    if (!response.success) {
      const details = 'errorMessage' in response ? response.errorMessage : 'No details.';
      log.warn(
          `Transfer tx: Failed to send thank-you message to ${tx.senderId} ` +
          `for transaction ${tx.id}. ${details || 'No details.'}`,
      );
      return;
    }

    log.log(`Transfer tx: Sent thank-you message to ${tx.senderId} for transaction ${tx.id}.`);
  } catch (error) {
    log.error(`Error in handleTransferTx() of the ${moduleName} module: ${error}`);
  }
}

/** @type {HandleTransferTx} */
module.exports = handleTransferTx;
