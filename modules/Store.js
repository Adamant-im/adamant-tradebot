const db = require('./DB');
const log = require('../helpers/log');
const utils = require('../helpers/utils');

module.exports = {
  lastProcessedBlockHeight: undefined,

  /**
   * Returns the lastProcessedBlockHeight
   * If the bot runs the first time, stores the current blockchain height as the lastProcessedBlockHeight
   * @returns {number|undefined}
   */
  async getLastProcessedBlockHeight() {
    try {
      if (this.lastProcessedBlockHeight) {
        return this.lastProcessedBlockHeight;
      }

      // Try getting the lastProcessedBlockHeight from the DB
      const systemDbData = await db.systemDb.findOne();

      if (systemDbData?.lastProcessedBlockHeight) {
        this.lastProcessedBlockHeight = systemDbData.lastProcessedBlockHeight;
      } else {
        // The bot runs the first time
        const exchangerUtils = require('../helpers/cryptos/exchanger');
        const lastBlock = await exchangerUtils.ADM.getLastBlockHeight();

        if (lastBlock) {
          await this.updateSystemDbField('lastProcessedBlockHeight', lastBlock);
        } else {
          log.warn(`Store: Unable to get the last ADM block from the blockchain, the request result is ${JSON.stringify(lastBlock)}. Will try next time.`);
        }
      }

      return this.lastProcessedBlockHeight;
    } catch (e) {
      log.error(`Error in getLastProcessedBlockHeight() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },

  /**
   * Loads data from the systemsDb
   * @param {string} field Field name
   * @returns {any}
   */
  async getSystemDbField(field) {
    try {
      const systemDbData = await db.systemDb.findOne();

      return systemDbData?.[field];
    } catch (e) {
      log.error(`Error in getLiqLimits() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },

  /**
   * Stores the data into the systemDb and updates the local variable
   * @param {string} field Field name
   * @param {any} data Data to store
   */
  async updateSystemDbField(field, data) {
    try {
      const $set = {};
      $set[field] = data;

      await db.systemDb.db.updateOne({}, { $set }, { upsert: true });

      this[field] = data;
    } catch (e) {
      log.error(`Error in updateSystemDbField() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },

  /**
   * Stores the lastProcessedBlockHeight into the systemDb
   * @param {number} height Block height
   */
  async updateLastProcessedBlockHeight(height) {
    if (height) {
      if (!this.lastProcessedBlockHeight || height > this.lastProcessedBlockHeight) {
        await this.updateSystemDbField('lastProcessedBlockHeight', height);
      }
    }
  },
};
