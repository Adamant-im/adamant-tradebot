const db = require('./DB');
const log = require('../helpers/log');
const utils = require('../helpers/utils');

module.exports = {

  lastProcessedBlockHeight: undefined,

  async getLastProcessedBlockHeight() {

    const exchangerUtils = require('../helpers/cryptos/exchanger');
    if (this.lastProcessedBlockHeight) {
      return this.lastProcessedBlockHeight;
    }
    // try to get lastProcessedBlockHeight from DB
    const systemDbData = await db.systemDb.findOne();
    if (systemDbData && systemDbData.lastProcessedBlockHeight) {
      this.lastProcessedBlockHeight = systemDbData.lastProcessedBlockHeight;
      return this.lastProcessedBlockHeight;
    }
    // it seems we run for a first time
    const lastBlock = await exchangerUtils.ADM.getLastBlockHeight();
    if (lastBlock) {
      await this.updateSystemDbField('lastProcessedBlockHeight', lastBlock);
      return this.lastProcessedBlockHeight;
    }
    log.warn(`Unable to store last ADM block in getLastProcessedBlockHeight() of ${utils.getModuleName(module.id)} module. Will try next time.`);

  },

  async updateSystemDbField(field, data) {
    const $set = {};
    $set[field] = data;
    await db.systemDb.db.updateOne({}, { $set }, { upsert: true });
    this[field] = data;
  },

  async updateLastProcessedBlockHeight(height) {
    if (height) {
      if (!this.lastProcessedBlockHeight || height > this.lastProcessedBlockHeight) {
        await this.updateSystemDbField('lastProcessedBlockHeight', height);
      }
    }
  },

};
