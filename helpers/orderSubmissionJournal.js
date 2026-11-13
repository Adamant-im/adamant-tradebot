// @ts-check
'use strict';

/**
 * @typedef {Object} SubmissionEvent
 * @property {'pending'|'acknowledged'|'recovered'|'uncertain'|'rejected'} state Submission lifecycle state; rejected means a definitive refusal without an exchange order
 * @property {string} clientOrderId Original unique reference; never used as an exchange order ID
 * @property {string} pair Readable pair
 * @property {'buy'|'sell'} side Direction
 * @property {'LIMIT'|'MARKET'} type Order type
 * @property {string} [price] Submitted limit price
 * @property {string} [quantity] Submitted base quantity
 * @property {string} [quoteQuantity] Submitted market-buy quote quantity
 * @property {string} [orderId] Exchange ID from an acknowledgement or reconciliation; unverified when state is uncertain
 *
 * @typedef {Object} JournalRotation
 * @property {number} maxBytes Maximum segment size in bytes
 * @property {number} archives Number of rotated segments to retain
 *
 * @typedef {Object} JournalOptions
 * @property {JournalRotation} [rotation] Size-based retention; omit for an append-only journal
 * @property {string} [stream] Filename suffix for a separate stream, using letters, digits, underscores or hyphens
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Roll a size-limited journal while retaining recent evidence
 * @param {string} file Active journal path
 * @param {number} bytes Next entry size
 * @param {JournalRotation} rotation Segment size and archive count
 * @returns {void}
 */
function rotateJournal(file, bytes, { maxBytes, archives }) {
  const size = fs.statSync(file, { throwIfNoEntry: false })?.size || 0;
  if (size + bytes <= maxBytes) return;

  for (let index = archives; index >= 1; index--) {
    const previous = index === 1 ? file : `${file}.${index - 1}`;
    try {
      fs.renameSync(previous, `${file}.${index}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
}

/**
 * Durably retain uncertain submissions independently of a caller's order-ID-only return handling
 * The journal contains normalized intent and recovery evidence, never API credentials.
 * @param {string} exchange Lowercase connector name
 * @param {string} accountReference Non-secret credential fingerprint
 * @param {SubmissionEvent} event Recovery evidence
 * @param {string} [directory] Override; defaults to ./logs/order-submissions in the working directory, alongside bot.log
 * @param {JournalOptions} [options] Optional stream and size-based retention
 * @returns {void} Throws on storage failure so the caller can report the missing durable evidence
 */
function appendSubmissionEvent(exchange, accountReference, event, directory = path.resolve('logs/order-submissions'), options = {}) {
  const { rotation, stream } = options;
  if (!/^[a-z0-9_-]+$/.test(exchange) || !/^[a-f0-9]{16}$/.test(accountReference) ||
      (stream !== undefined && !/^[a-z0-9_-]+$/.test(stream))) {
    throw new Error('Invalid order submission journal identity');
  }

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const file = path.join(directory, `${exchange}-${accountReference}${stream ? `-${stream}` : ''}.jsonl`);
  const line = JSON.stringify({ timestamp: Date.now(), exchange, ...event }) + '\n';
  if (rotation) rotateJournal(file, Buffer.byteLength(line), rotation);

  const descriptor = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(descriptor, line);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { appendSubmissionEvent };
