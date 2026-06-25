/**
 * @module modules/DB
 * @typedef {import('types/bot/db.d.js').DbCollections} DbCollections
 * @typedef {import('types/bot/db.d.js').DbModule} DbModule
 */

const config = require('./configReader');
const log = require('../helpers/log');
const { MongoClient } = require('mongodb');
const model = require('../helpers/dbModel');
const { runMigrations } = require('./dbMigrations');

const { name, url, options } = config.db;
const mongoClient = new MongoClient(url, options);

/** @type {Partial<DbCollections>} */
const collections = {};

/**
 * Resolves when MongoDB is connected, migrations have run, indexes are created,
 * and collection models are ready for use.
 *
 * @type {Promise<DbCollections>}
 */
const ready = mongoClient.connect()
    .then(async (client) => {
      const db = client.db(name);

      // Run all DB migrations before exposing collections
      log.log(`DB: Connected to MongoDB at '${url}', database '${name}'. Running migrations…`);
      await runMigrations(db);

      collections.db = db;

      // === incomingTgTxs ===
      const incomingTgTxsCollection = db.collection('incomingtgtxs');
      incomingTgTxsCollection.createIndex([['date', 1], ['senderId', 1]]);
      // Optimized for: findOne({ senderId, isSpam: true, date: { $gt: ... } })
      incomingTgTxsCollection.createIndex({ senderId: 1, isSpam: 1, date: -1 }, { name: 'tg_sender_spam_date' });

      // === incomingTxs ===
      const incomingTxsCollection = db.collection('incomingtxs');
      incomingTxsCollection.createIndex([['date', 1], ['senderId', 1]]);
      // Optimized for: findOne({ senderId, isSpam: true, date: { $gt: ... } })
      incomingTxsCollection.createIndex({ senderId: 1, isSpam: 1, date: -1 }, { name: 'tx_sender_spam_date' });

      // === incomingCliTxs ===
      const incomingCliTxsCollection = db.collection('incomingclitxs');
      incomingCliTxsCollection.createIndex([['date', 1], ['senderId', 1]]);
      // Optimized for: findOne({ senderId, isSpam: true, date: { $gt: ... } })
      incomingCliTxsCollection.createIndex({ senderId: 1, isSpam: 1, date: -1 }, { name: 'cli_sender_spam_date' });

      // === orders ===
      const ordersCollection = db.collection('orders');
      ordersCollection.createIndex([['isProcessed', 1], ['purpose', 1]]);
      ordersCollection.createIndex([['pair', 1], ['exchange', 1]]);
      // Optimized for: { isProcessed: false, purpose, pair, exchange, isSecondAccountOrder: ... }
      ordersCollection.createIndex(
          { exchange: 1, pair: 1, isProcessed: 1, purpose: 1, isSecondAccountOrder: 1, date: -1 },
          { name: 'orders_main_idx' },
      );
      // Optimized for: { isProcessed: true, isExecuted: true, purpose, pair, exchange, date: { $gt: ... } }
      ordersCollection.createIndex(
          { exchange: 1, pair: 1, purpose: 1, isProcessed: 1, isExecuted: 1, date: -1 },
          { name: 'orders_exec_idx' },
      );
      // Optimized for recent-closed and full-purpose reports: { exchange, pair, purpose, isProcessed: true, date: { $gte: ... } }
      ordersCollection.createIndex(
          { exchange: 1, pair: 1, purpose: 1, isProcessed: 1, date: -1 },
          { name: 'orders_processed_recent_idx' },
      );

      // === fills ===
      const fillsCollection = db.collection('fills');
      fillsCollection.createIndex([['isProcessed', 1], ['purpose', 1]]);
      fillsCollection.createIndex([['pair', 1], ['exchange', 1]]);
      fillsCollection.createIndex(
          { isProcessed: 1, purpose: 1, pair: 1, exchange: 1, date: 1 },
          { name: 'fills_find_main' },
      );

      // === filledStats ===
      // Persistent cumulative (since-reset) stats for verified fills (VWAP accumulators, counters, etc.)
      // Used by helpers/fillsEngine.js to restore state after restart and to serve VWAP to other modules
      // _id is the primary key by default (statsId = `${exchange}:${pair}:${purpose}[:${subPurpose}]:${startTs}`), so findOne({ _id }) is already indexed
      const filledStatsCollection = db.collection('filledstats');
      // Optimized for: find({ exchange, pair, purpose }).sort({ startTs: -1 }) or cleanup by epoch
      filledStatsCollection.createIndex(
          { exchange: 1, pair: 1, purpose: 1, startTs: -1 },
          { name: 'filledstats_key_epoch' },
      );
      // Optimized for: housekeeping / monitoring (latest updated stats)
      filledStatsCollection.createIndex(
          { updatedAt: -1 },
          { name: 'filledstats_updatedAt' },
      );

      // === balanceshistory ===
      const balancesHistoryCollection = db.collection('balanceshistory');
      // Main index: per exchange, account, user, logical account type, walletType + time
      balancesHistoryCollection.createIndex(
          { exchange: 1, accountNo: 1, userId: 1, accountType: 1, walletType: 1, timestamp: -1 },
          { name: 'bh_exchange_acc_user_type_wallet_ts' },
      );
      // For global history per account/walletType (all getBalancesCached calls)
      balancesHistoryCollection.createIndex(
          { exchange: 1, accountNo: 1, walletType: 1, timestamp: -1 },
          { name: 'bh_exchange_acc_wallet_ts' },
      );
      // Simple time-based queries (history by timestamp)
      balancesHistoryCollection.createIndex(
          { exchange: 1, timestamp: -1 },
          { name: 'bh_exchange_ts' },
      );

      // === chartcandles ===
      const chartCandlesCollection = db.collection('chartcandles');
      chartCandlesCollection.createIndex(
          { exchange: 1, pair: 1, timeframe: 1, tsOpen: 1 },
          { unique: true, name: 'chartcandles_pair_tf_tsOpen' },
      );
      chartCandlesCollection.createIndex(
          { tsOpen: 1 },
          { name: 'chartcandles_tsOpen' },
      );

      // Wrap collections into the model helper
      collections.fillsDb = model(fillsCollection);
      collections.ordersDb = model(ordersCollection);
      collections.incomingTgTxsDb = model(incomingTgTxsCollection);
      collections.incomingTxsDb = model(incomingTxsCollection);
      collections.incomingCLITxsDb = model(incomingCliTxsCollection);
      collections.systemDb = model(db.collection('systems'));
      collections.webTerminalMessages = db.collection('webTerminalMessages');
      collections.balancesHistory = balancesHistoryCollection;
      collections.filledStatsDb = model(filledStatsCollection);
      collections.chartCandlesDb = model(chartCandlesCollection);
      collections.chartCandlesCollection = chartCandlesCollection;

      log.log(`${config.notifyName} successfully connected to MongoDB database '${name}'.`);

      return /** @type {DbCollections} */ (collections);
    })
    .catch((error) => {
      log.error(`DB: Unable to connect to MongoDB at '${url}': ${error}`);
      process.exit(-1);
    });

// Export collections object AND the ready promise
/** @type {DbModule} */
module.exports = collections;
module.exports.ready = ready;
