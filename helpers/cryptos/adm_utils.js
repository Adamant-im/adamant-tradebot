const api = require('../../modules/api');
const log = require('../../helpers/log');
const constants = require('../const');
const config = require('../../modules/configReader');
const utils = require('../utils');
const { MessageType } = require('adamant-api');

const baseCoin = require('./baseCoin');

module.exports = class admCoin extends baseCoin {
  constructor() {
    super();
    this.token = 'ADM';
    this.cache.lastBlock = { lifetime: 5000 };
    this.cache.balance = { lifetime: 10000 };
    this.account.passPhrase = config.passPhrase;
    this.account.keyPair = config.keyPair;
    this.account.address = config.address;
    if (this.account.passPhrase) {
      this.getBalance().then((balance) => {
        log.log(`Initial ${this.token} balance: ${balance ? balance.toFixed(constants.PRINT_DECIMALS) : 'unable to receive'}`);
      });
    }
  }

  get FEE() {
    return 0.5;
  }

  /**
   * Returns last block from cache, if it's up to date. If not, makes an API request and updates cached data.
   * @return {Object} or undefined, if unable to fetch data
   */
  async getLastBlock() {
    const cached = this.cache.getData('lastBlock');
    if (cached) {
      return cached;
    }
    const blocks = await api.getBlocks({ limit: 1 });
    if (blocks.success) {
      this.cache.cacheData('lastBlock', blocks.blocks[0]);
      return blocks.blocks[0];
    } else {
      log.warn(`Failed to get last block in getLastBlock() of ${utils.getModuleName(module.id)} module. ${blocks.errorMessage}.`);
    }
  }

  /**
   * Returns last block height from cache, if it's up to date. If not, makes an API request and updates cached data.
   * @return {Number} or undefined, if unable to fetch data
   */
  async getLastBlockHeight() {
    const block = await this.getLastBlock();
    return block ? block.height : undefined;
  }

  /**
   * Returns balance in ADM from cache, if it's up to date. If not, makes an API request and updates cached data.
   * @return {Promise<Number>} or outdated cached value, if unable to fetch data; it may be undefined also
   */
  async getBalance() {
    const cached = this.cache.getData('balance');
    if (cached) {
      return utils.satsToADM(cached);
    }
    const account = await api.getAccountBalance(config.address);
    if (account.success) {
      this.cache.cacheData('balance', account.balance);
      return utils.satsToADM(account.balance);
    } else {
      log.warn(`Failed to get account info in getBalance() of ${utils.getModuleName(module.id)} module; returning outdated cached balance. ${account.errorMessage}.`);
      return utils.satsToADM(cached);
    }
  }

  /**
   * Returns balance in ADM from cache. It may be outdated.
   * @return {Number} cached value; it may be undefined
   */
  get balance() {
    return utils.satsToADM(this.cache.getData('balance'));
  }

  /**
   * Updates balance in ADM manually from cache. Useful when we don't want to wait for network update.
   * @param {Number} value New balance in ADM
   */
  set balance(value) {
    if (utils.isPositiveOrZeroNumber(value)) {
      this.cache.cacheData('balance', utils.AdmToSats(value));
    }
  }

  /**
   * Returns Tx status and details from the blockchain
   * @param {String} txid Tx ID to fetch
   * @return {Object}
   * Used for income Tx security validation (deepExchangeValidator): senderId, recipientId, amount, timestamp
   * Used for checking income Tx status (confirmationsCounter), exchange and send-back Tx status (sentTxChecker):
   * status, confirmations || height
   * Not used, additional info: hash (already known), blockId, fee
   */
  async getTransaction(txid) {
    const tx = await api.getTransaction(txid);
    if (tx.success) {
      log.log(`Tx status: ${this.formTxMessage(tx.transaction)}.`);
      return {
        status: tx.transaction.confirmations > 0 ? true : undefined,
        height: tx.transaction.height,
        blockId: tx.transaction.blockId,
        timestamp: utils.toTimestamp(tx.transaction.timestamp),
        hash: tx.transaction.id,
        senderId: tx.transaction.senderId,
        recipientId: tx.transaction.recipientId,
        confirmations: tx.transaction.confirmations,
        amount: utils.satsToADM(tx.transaction.amount), // in ADM
        fee: utils.satsToADM(tx.transaction.fee), // in ADM
      };
    } else {
      log.warn(`Unable to get Tx ${txid} in getTransaction() of ${utils.getModuleName(module.id)} module. It's expected, if the Tx is new. ${tx.errorMessage}.`);
      return null;
    }
  }

  async send(params) {
    const isAmountInADM = true; // Sending ADM

    params.try = params.try || 1;
    const tryString = ` (try number ${params.try})`;
    const { address, value, comment } = params;
    const payment = await api.sendMessage(config.passPhrase, address, comment, MessageType.Chat, value, isAmountInADM);
    if (payment.success) {
      log.log(`Successfully sent ${value} ADM to ${address} with comment '${comment}'${tryString}, Tx hash: ${payment.transactionId}.`);
      return {
        success: payment.success,
        hash: payment.transactionId,
      };
    } else {
      log.warn(`Failed to send ${value} ADM to ${address} with comment '${comment}'${tryString} in send() of ${utils.getModuleName(module.id)} module. ${payment.errorMessage}.`);
      return {
        success: false,
        error: payment.errorMessage,
      };
    }
  }

  formTxMessage(tx) {
    const senderId = tx.senderId.toLowerCase() === this.account.address.toLowerCase() ? 'Me' : tx.senderId;
    const recipientId = tx.recipientId.toLowerCase() === this.account.address.toLowerCase() ? 'Me' : tx.recipientId;
    const message = `Tx ${tx.id} for ${utils.satsToADM(tx.amount)} ADM from ${senderId} to ${recipientId} included at ${tx.height} blockchain height and has ${tx.confirmations} confirmations, ${utils.satsToADM(tx.fee)} ADM fee`;
    return message;
  }

};
