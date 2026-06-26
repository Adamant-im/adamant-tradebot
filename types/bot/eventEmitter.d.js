/**
 * types/bot/eventEmitter.d.js
 *
 * Type definitions for the in-process event bus (`modules/eventEmitter.js`).
 */

/**
 * @typedef {'parameters_update'} BotEventName
 */

/**
 * Map of logical event keys to the strings passed to `emitter.emit()`.
 * The `parameters:update` key is fired when trade parameters are saved to disk.
 *
 * @typedef {{ 'parameters:update': 'parameters_update' }} BotEventsMap
 */

/**
 * Shared process-wide event emitter used by WebUI and trade-parameter updates.
 *
 * @typedef {import('events').EventEmitter} BotEventEmitter
 */

/**
 * Module export from `modules/eventEmitter.js`.
 *
 * @typedef {Object} EventEmitterModule
 * @property {BotEventEmitter} emitter Shared `EventEmitter` singleton
 * @property {BotEventsMap} events Map of logical event keys to emitted event names
 */

module.exports = {};
