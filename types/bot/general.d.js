'use strict';

/**
 * Common notifier callback used by bot modules and runtime wrappers.
 *
 * @typedef {import('types/bot/helpers.d.js').NotifyLevel} NotifyLevel
 * @typedef {(messageText: string, type: NotifyLevel, silent_mode?: boolean, isPriority?: boolean) => void} NotifyFunction
 */

/**
 * Random helper that returns a number inside the provided range.
 *
 * @typedef {(low: number, high: number, doRound?: boolean) => number} RandomValueFunction
 */

/**
 * Random helper that returns a number around the provided base value using a symmetric deviation.
 *
 * @typedef {(number: number, deviation: number, doRound?: boolean) => number} RandomDeviationFunction
 */

/**
 * Result of commandTxs call.
 * @typedef {Object} CommandReply
 * @prop {string} msgNotify Notifications message (Slack, ADAMANT, etc.). Notification functions also logs.
 * @prop {string} msgSendBack Reply to user
 * @prop {'error'|'warn'|'info'|'log'} notifyType error < warn < info < log
 * @prop {boolean} [isError] If some command parameter isn't correct. Used in WebUI.
 * @prop {'source'|'currency'} [errorField] Command parameter which isn't correct. Used in WebUI.
 */

module.exports = {};
