/**
 * @module modules/eventEmitter
 * @typedef {import('types/bot/eventEmitter.d.js').BotEventEmitter} BotEventEmitter
 * @typedef {import('types/bot/eventEmitter.d.js').BotEventsMap} BotEventsMap
 * @typedef {import('types/bot/eventEmitter.d.js').EventEmitterModule} EventEmitterModule
 */

const Emitter = require('events');

/** @type {BotEventEmitter} */
const emitter = new Emitter();

/**
 * Logical event keys mapped to the strings passed to `emitter.emit()`.
 * Use the object keys in application code so renames stay centralized.
 *
 * @type {BotEventsMap}
 */
const events = {
  'parameters:update': 'parameters_update',
};

/** @type {EventEmitterModule} */
module.exports = { emitter, events };
