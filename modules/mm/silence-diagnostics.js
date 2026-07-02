'use strict';

/**
 * Suppresses noisy bot startup logs during `mm` CLI runs.
 *
 * Enabled when `MM_CLI=1` (set in bin/mm.js). Set `MM_VERBOSE=1` to see all logs.
 *
 * @module modules/mm/silence-diagnostics
 */

/** @type {RegExp[]} */
const DIAGNOSTIC_PATTERNS = [
  /^\[ADAMANT js-api\]/,
  /^Config reader:/,
  /^Watching external changes in the trade config file:/,
];

const ANSI_ESCAPE = String.fromCharCode(27);

/**
 * @param {unknown[]} args console.* arguments
 * @returns {boolean}
 */
function shouldSilence(args) {
  const message = args.map(String).join(' ').replace(new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g'), '');
  return DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

/** Patches console.log/info/warn to hide bot diagnostic noise during mm CLI. */
function installDiagnosticSilence() {
  if (process.env.MM_CLI !== '1' || process.env.MM_VERBOSE === '1') {
    return;
  }

  for (const method of ['log', 'info', 'warn']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      if (shouldSilence(args)) {
        return;
      }
      original(...args);
    };
  }
}

module.exports = { installDiagnosticSilence };
