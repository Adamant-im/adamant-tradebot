'use strict';

/**
 * Encryption for ComServer payloads.
 *
 * Payload version 2 uses AES-256-GCM. The auth tag rejects tampered frames before anything parses them.
 * The additional authenticated data binds the sender role and the timestamp:
 * - The sender role stops a captured bot frame from being reflected back to a bot as if ComServer sent it
 * - The timestamp lets {@link decryptOnce} reject stale frames
 *
 * Frames of any other version are rejected, including legacy AES-256-CTR frames.
 *
 * @module helpers/encryption
 */

const crypto = require('crypto');
const config = require('../modules/configReader');
const constants = require('./const');
const log = require('./log');

/**
 * @typedef {import('types/bot/helpers.d.js').EncryptedPayload} EncryptedPayload
 */

const PAYLOAD_VERSION = 2;

const GCM_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** HKDF context of the GCM key. ComServer must use the same value. */
const GCM_KEY_INFO = 'adamant-tradebot/comserver/v2/aes-256-gcm';

/** Sender roles in the additional authenticated data. A bot writes `bot` frames and reads `server` frames. */
const SENDER_BOT = 'bot';
const SENDER_SERVER = 'server';

/** How far a single-use payload timestamp may differ from local time, in either direction */
const MAX_PAYLOAD_AGE_MS = 5 * constants.MINUTE;

const gcmSecretKey = Buffer.from(crypto.hkdfSync(
    'sha256',
    String(config.com_server_secret_key),
    Buffer.alloc(0),
    GCM_KEY_INFO,
    GCM_KEY_BYTES,
));

/** IVs of accepted single-use payloads, mapped to the time they leave the acceptance window */
const seenPayloads = new Map();

/**
 * Builds the additional authenticated data of a version 2 payload.
 *
 * @param {string} sender Sender role
 * @param {number} ts Payload timestamp in Unix ms
 * @returns {Buffer}
 */
const getAdditionalData = (sender, ts) => Buffer.from(`comserver:v${PAYLOAD_VERSION}:${sender}:${ts}`, 'utf8');

/**
 * Checks a value is lowercase hex, as `Buffer.toString('hex')` writes it.
 *
 * `Buffer.from()` silently stops at the first invalid character, and an uppercase IV
 * would decode to the same bytes under a different replay cache key.
 *
 * @param {unknown} value Value to check
 * @param {number} [bytes] Exact decoded length. Any length is accepted when omitted.
 * @returns {boolean}
 */
const isHex = (value, bytes) => {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) {
    return false;
  }

  return bytes === undefined || value.length === bytes * 2;
};

/**
 * Decrypts and authenticates a version 2 payload written by ComServer.
 *
 * @param {EncryptedPayload} payload Version 2 payload
 * @returns {string} Decrypted plain text
 * @throws {Error} When the payload is malformed or fails authentication
 */
const decryptGcm = (payload) => {
  const { iv, content, tag, ts } = payload;

  if (!isHex(iv, GCM_IV_BYTES) || !isHex(tag, GCM_TAG_BYTES) || !isHex(content) || !Number.isSafeInteger(ts)) {
    throw new Error('Malformed payload');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', gcmSecretKey, Buffer.from(iv, 'hex'), {
    authTagLength: GCM_TAG_BYTES,
  });

  decipher.setAAD(getAdditionalData(SENDER_SERVER, ts));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(content, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
};

/**
 * Rejects a stale or repeated payload, and remembers a new one.
 *
 * Call only after the payload is authenticated, so forged frames cannot fill the cache.
 *
 * @param {EncryptedPayload} payload Authenticated version 2 payload
 * @returns {void}
 * @throws {Error} When the payload is stale or was already accepted
 */
const assertFreshPayload = ({ iv, ts }) => {
  const now = Date.now();

  if (Math.abs(now - ts) > MAX_PAYLOAD_AGE_MS) {
    throw new Error(`Payload timestamp ${ts} is more than ${MAX_PAYLOAD_AGE_MS} ms away from local time ${now}`);
  }

  for (const [seenIv, expiresAt] of seenPayloads) {
    if (expiresAt < now) {
      seenPayloads.delete(seenIv);
    }
  }

  if (seenPayloads.has(iv)) {
    throw new Error('Payload was already processed');
  }

  seenPayloads.set(iv, ts + MAX_PAYLOAD_AGE_MS);
};

/**
 * Encrypts plain text for ComServer.
 *
 * @param {string} text Plain text to encrypt
 * @returns {EncryptedPayload}
 */
const encrypt = (text) => {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const ts = Date.now();

  const cipher = crypto.createCipheriv('aes-256-gcm', gcmSecretKey, iv, {
    authTagLength: GCM_TAG_BYTES,
  });

  cipher.setAAD(getAdditionalData(SENDER_BOT, ts));

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

  return {
    v: PAYLOAD_VERSION,
    iv: iv.toString('hex'),
    content: encrypted.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ts,
  };
};

/**
 * Decrypts a payload written by ComServer.
 *
 * An integrity failure throws: there is no fallback to unverified plain text.
 *
 * @param {EncryptedPayload} payload Encrypted payload
 * @returns {string} Decrypted plain text
 * @throws {Error} When the payload has another version, is malformed, or fails authentication
 */
const decrypt = (payload) => {
  try {
    if (payload?.v !== PAYLOAD_VERSION) {
      throw new Error('Unsupported payload version');
    }

    return decryptGcm(payload);
  } catch (err) {
    log.error(`encryption: Failed to decrypt payload. ${err}`);
    throw err;
  }
};

/**
 * Decrypts a payload that must be processed at most once, such as a remote command.
 *
 * @param {EncryptedPayload} payload Encrypted payload
 * @returns {string} Decrypted plain text
 * @throws {Error} When {@link decrypt} rejects the payload, or it is stale or already processed
 */
const decryptOnce = (payload) => {
  const decrypted = decrypt(payload);

  assertFreshPayload(payload);

  return decrypted;
};

module.exports = {
  encrypt,
  decrypt,
  decryptOnce,
};
