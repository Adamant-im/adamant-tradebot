const Store = require('./Store');
const api = require('./api');
const txParser = require('./incomingTxsParser');
const log = require('../helpers/log');
const config = require('./configReader');
const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const { TransactionType } = require('adamant-api');

async function check() {

  try {

    const lastProcessedBlockHeight = await Store.getLastProcessedBlockHeight();
    if (!lastProcessedBlockHeight) {
      log.warn(`Unable to get last processed ADM block in check() of ${utils.getModuleName(module.id)} module. Will try next time.`);
      return;
    }

    const queryParams = {
      and: {
        recipientId: config.address,
        types: [TransactionType.SEND, TransactionType.CHAT_MESSAGE],
        fromHeight: lastProcessedBlockHeight + 1,
      },
      returnAsset: 1, // get messages' contents
      orderBy: 'timestamp:desc', // latest Txs
    };

    const txTrx = await api.getTransactions(queryParams);
    if (txTrx.success) {
      for (const tx of txTrx.transactions) {
        await txParser(tx);
      }
    } else {
      log.warn(`Failed to get Txs in check() of ${utils.getModuleName(module.id)} module. ${txTrx.errorMessage}.`);
    }

  } catch (e) {
    log.error('Error while checking new transactions: ' + e);
  }

}

module.exports = () => {
  setInterval(check, constants.TX_CHECKER_INTERVAL);
};
