/**
 * @module modules/dbMigrations
 * @typedef {import('types/bot/dbMigrations.d.js').MigrateTypeToSide} MigrateTypeToSide
 * @typedef {import('types/bot/dbMigrations.d.js').RunDbMigrations} RunDbMigrations
 */

const log = require('../helpers/log');

/**
 * Renames field `type` → `side` in a given collection, but only when:
 * - `side` does not exist yet, and
 * - `type` is either `'buy'` or `'sell'`.
 *
 * This limits the migration to legacy order documents.
 *
 * @type {MigrateTypeToSide}
 * @param {import('mongodb').Db} db Mongo database handle
 * @param {string} collectionName Collection to migrate (e.g. `'orders'`)
 * @returns {Promise<number>} Number of documents updated
 */
async function migrateTypeToSide(db, collectionName) {
  const collection = db.collection(collectionName);

  const filter = {
    side: { $exists: false },
    type: { $in: ['buy', 'sell'] },
  };

  const update = {
    $rename: {
      type: 'side',
    },
  };

  const result = await collection.updateMany(filter, update);

  return result.modifiedCount;
}

/**
 * Runs all registered database migrations in order.
 *
 * Add new one-off migrations here so they execute once on every bot startup
 * until the underlying data no longer matches the migration filter.
 *
 * @type {RunDbMigrations}
 * @param {import('mongodb').Db} db Mongo database handle
 * @returns {Promise<void>}
 */
async function runMigrations(db) {
  try {
    log.log('[DB migration] Checking whether database migrations are required…');

    const modifiedCount = await migrateTypeToSide(db, 'orders');

    if (modifiedCount) {
      log.log(`[DB migration] Orders: renamed 'type' → 'side' for ${modifiedCount} document(s).`);
    } else {
      log.log(`[DB migration] Orders: no legacy 'type' fields found; nothing to migrate.`);
    }

    log.log('[DB migration] Database schema is up to date.');

    // Add future migrations below as needed
    // await anotherMigration(db);
  } catch (error) {
    log.error(`[DB migration] Migration failed: ${error}`);

    throw error; // An error should stop the app
  }
}

module.exports = {
  runMigrations,
};
