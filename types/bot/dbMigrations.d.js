/**
 * types/bot/dbMigrations.d.js
 *
 * Type definitions for one-off MongoDB schema migrations (`modules/dbMigrations.js`).
 */

/**
 * Runs all registered database migrations against the connected database.
 *
 * @typedef {(db: import('mongodb').Db) => Promise<void>} RunDbMigrations
 */

/**
 * Renames legacy `type` → `side` on order documents that still use the old field.
 *
 * @typedef {(db: import('mongodb').Db, collectionName: string) => Promise<number>} MigrateTypeToSide
 */

module.exports = {};
