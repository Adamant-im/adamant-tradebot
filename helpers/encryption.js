'use strict';

/**
 * AES-256-CTR encryption for inter-bot communication payloads.
 *
 * @module helpers/encryption
 */

const crypto = require('crypto');
const config = require('../modules/configReader');
const log = require('./log');

/**
 * @typedef {import('types/bot/helpers.d.js').EncryptedPayload} EncryptedPayload
 */

const secretKey = crypto
    .createHash('sha256')
    .update(String(config.com_server_secret_key))
    .digest('base64')
    .slice(0, 32);

/**
 * Encrypts plain text with AES-256-CTR.
 *
 * @param {string} text Plain text to encrypt
 * @returns {EncryptedPayload}
 */
const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

  return {
    iv: iv.toString('hex'),
    content: encrypted.toString('hex'),
  };
};

/**
 * Decrypts a payload produced by {@link encrypt}.
 *
 * @param {EncryptedPayload} hash Encrypted payload with `iv` and `content` hex strings
 * @returns {string} Decrypted plain text
 */
const decrypt = (hash) => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-ctr', secretKey, Buffer.from(hash.iv, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(hash.content, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString();
  } catch (err) {
    log.error(`encryption: Failed to decrypt payload. ${err}`);
    throw err;
  }
};

module.exports = { encrypt, decrypt };
