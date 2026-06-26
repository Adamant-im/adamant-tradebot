/**
 * @module modules/admTxChecker
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').AdmTxCheckerQueryParams} AdmTxCheckerQueryParams
 * @typedef {import('types/bot/adamant.d.js').StartAdmTxChecker} StartAdmTxChecker
 */

const Store = require('./Store');
const txParser = require('./admTxParser');
const log = require('../helpers/log');
const config = require('./configReader');
const constants = require('../helpers/const');
const utils = require('../helpers/utils');

const adamantApi = require('./adamantApi');
const api = adamantApi();
const { TransactionType } = require('adamant-api');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

log.log(`Module ${moduleName} is loaded.`);

/**
 * Fetches ADM transactions newer than the last processed block height and
 * forwards each one to `admTxParser`.
 *
 * REST only (additional to socket support which is enabled in app.js).
 *
 * Skips the iteration when the block cursor is unavailable or the API request fails.
 *
 * @returns {Promise<void>}
 */
async function check() {
  try {
    const processedHeight = await Store.getLastProcessedBlockHeight();

    if (!processedHeight) {
      log.warn(
          `ADM tx checker: Failed to read the last processed ADM block height in check() ` +
          `of the ${moduleName} module. Retrying on the next iteration.`,
      );
      return;
    }

    /** @type {AdmTxCheckerQueryParams} */
    const queryParams = {
      recipientId: config.address,
      types: [TransactionType.SEND, TransactionType.CHAT_MESSAGE],
      fromHeight: processedHeight + 1,
      returnAsset: 1, // Include chat message payloads
      orderBy: 'timestamp:desc', // Process newest transactions first
    };

    const response = await api.getTransactions(queryParams);

    if (!response.success) {
      const details = 'errorMessage' in response ? response.errorMessage : 'No details.';
      log.warn(
          `ADM tx checker: Failed to retrieve new ADM transactions in check() ` +
          `of the ${moduleName} module. ${details || 'No details.'}`,
      );
      return;
    }

    const { transactions } = response;

    if (!transactions?.length) {
      log.trace(`ADM tx checker: No new ADM transactions since block ${processedHeight + 1}.`);
      return;
    }

    log.debug(
        `ADM tx checker: Retrieved ${transactions.length} new ADM transaction(s) ` +
        `starting from block ${processedHeight + 1}.`,
    );

    for (const tx of transactions) {
      await txParser(/** @type {AdamantIncomingTx} */ (tx));
    }
  } catch (error) {
    log.error(`Error in check() of the ${moduleName} module: ${error}`);
  }
}

/**
 * Starts the periodic ADM transaction scanner.
 *
 * @type {StartAdmTxChecker}
 */
module.exports = () => {
  setInterval(check, constants.ADM_TX_CHECKER_INTERVAL);
};
