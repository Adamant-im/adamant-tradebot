/**
 * types/bot/db.d.js
 *
 * Type definitions for the MongoDB access layer (`modules/DB.js`).
 */

/**
 * Minimal ORM wrapper returned by `helpers/dbModel.js` for one collection.
 *
 * @template T
 * @typedef {T & {
 *   save: () => Promise<any>,
 *   update: (obj: Partial<T>, shouldSave?: boolean) => Promise<any>
 * }} DbModelRecord
 */

/**
 * Static methods exposed on a `dbModel` collection class (see `helpers/dbModel.js`).
 *
 * @template T
 * @typedef {Object} DbModelCollectionStatics
 * @property {(req?: import('mongodb').Filter<T>) => Promise<DbModelRecord<T>[]>} find
 * @property {(req?: import('mongodb').Document[]) => Promise<DbModelRecord<T>[]>} aggregate
 * @property {(req?: import('mongodb').Filter<T>) => Promise<DbModelRecord<T> | null>} findOne
 * @property {(req?: import('mongodb').Filter<T>) => Promise<number>} deleteOne
 * @property {(req: { filter: import('mongodb').Filter<T>, update: import('mongodb').UpdateFilter<T>, options?: import('mongodb').UpdateOptions }) => Promise<import('mongodb').UpdateResult>} updateOne
 * @property {(req?: import('mongodb').Filter<T>) => Promise<number>} count
 * @property {import('mongodb').Collection<T>} db Underlying native MongoDB collection
 */

/**
 * `dbModel` collection class — static query methods plus `new` for document instances.
 *
 * @template T
 * @typedef {DbModelCollectionStatics<T> & (new (data?: Partial<T> | import('mongodb').Document, shouldSave?: boolean) => DbModelRecord<T>)} DbModelCollection
 */

/**
 * MongoDB collections and models exposed after `DB.ready` resolves.
 *
 * @typedef {Object} DbCollections
 * @property {import('mongodb').Db} db Native MongoDB database handle
 * @property {DbModelCollection<import('types/bot/orderMetrics.d.js').FillsDbRecord>} fillsDb Fills collection model
 * @property {DbModelCollection<import('types/bot/ordersDb.d.js').BotOrder>} ordersDb Orders collection model
 * @property {DbModelCollection<any>} incomingTgTxsDb Telegram incoming transactions
 * @property {DbModelCollection<import('types/bot/adamant.d.js').IncomingAdmTxRecord>} incomingTxsDb ADAMANT incoming transactions
 * @property {DbModelCollection<import('types/bot/cli.d.js').IncomingCliTxRecord>} incomingCLITxsDb CLI incoming transactions
 * @property {DbModelCollection<any>} systemDb Singleton `systems` document model
 * @property {import('mongodb').Collection<any>} webTerminalMessages Web terminal message log
 * @property {import('mongodb').Collection<any>} balancesHistory Balance snapshots history
 * @property {DbModelCollection<any>} filledStatsDb Cumulative fill statistics (VWAP accumulators)
 * @property {DbModelCollection<any>} chartCandlesDb Chart candle documents model
 * @property {import('mongodb').Collection<any>} chartCandlesCollection Raw chart candles collection
 */

/**
 * Module export shape: collections are attached after `ready` resolves.
 *
 * @typedef {Partial<DbCollections> & {
 *   ready: Promise<DbCollections>
 * }} DbModule
 */

module.exports = {};
