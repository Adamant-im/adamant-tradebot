/**
 * @module modules/Store
 * @typedef {import('types/bot/store.d.js').StoreModule} StoreModule
 * @typedef {import('types/bot/store.d.js').SystemDbRecord} SystemDbRecord
 */

const db = require('./DB');
const log = require('../helpers/log');
const utils = require('../helpers/utils');

const adamantApi = require('../modules/adamantApi');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

log.log(`Module ${moduleName} is loaded.`);

/** @type {StoreModule} */
module.exports = {
  lastProcessedBlockHeight: undefined,

  /**
   * Returns the last processed ADM block height.
   *
   * Used by `admTxChecker`. On the first run, reads the current chain height
   * from the ADAMANT API and stores it so only new blocks are scanned afterward.
   *
   * @returns {Promise<number | undefined>}
   */
  async getLastProcessedBlockHeight() {
    try {
      if (this.lastProcessedBlockHeight) {
        return this.lastProcessedBlockHeight;
      }

      const systemDbData = await db.systemDb.findOne();

      if (systemDbData?.lastProcessedBlockHeight) {
        this.lastProcessedBlockHeight = systemDbData.lastProcessedBlockHeight;
        log.log(`Store: Loaded last processed ADM block height ${this.lastProcessedBlockHeight} from the database.`);
      } else {
        const api = adamantApi();
        const response = await api.getHeight();

        if (response.success) {
          log.log(
              `Store: First run detected; saving the current ADM blockchain height ` +
              `(${response.height}) as the last processed block.`,
          );
          await this.updateSystemDbField('lastProcessedBlockHeight', response.height);
        } else {
          log.warn(
              `Store: Unable to retrieve the current ADM blockchain height; ` +
              `API response: '${JSON.stringify(response)}'. Retrying on the next iteration.`,
          );
        }
      }

      return this.lastProcessedBlockHeight;
    } catch (error) {
      log.error(`Error in getLastProcessedBlockHeight() of the ${moduleName} module: ${error}`);
    }
  },

  /**
   * Reads one field from the `systems` collection.
   *
   * @param {string} field Database field name
   * @returns {Promise<any>}
   */
  async getSystemDbField(field) {
    try {
      const systemDbData = await db.systemDb.findOne();

      return systemDbData?.[field];
    } catch (error) {
      log.error(`Error in getSystemDbField('${field}') of the ${moduleName} module: ${error}`);
    }
  },

  /**
   * Persists a field to `systems` and mirrors it on the in-memory store object.
   *
   * @param {string} field Database field name
   * @param {any} data Value to store
   * @returns {Promise<void>}
   */
  async updateSystemDbField(field, data) {
    try {
      const $set = {};
      $set[field] = data;

      await db.systemDb.db.updateOne({}, { $set }, { upsert: true });

      this[field] = data;
    } catch (error) {
      log.error(`Error in updateSystemDbField('${field}') of the ${moduleName} module: ${error}`);
    }
  },

  /**
   * Advances the ADM block cursor when a higher confirmed height is observed.
   *
   * @param {number} height Block height from a processed transaction
   * @returns {Promise<void>}
   */
  async updateLastProcessedBlockHeight(height) {
    if (height && height > (this.lastProcessedBlockHeight ?? 0)) {
      await this.updateSystemDbField('lastProcessedBlockHeight', height);
    }
  },
};
