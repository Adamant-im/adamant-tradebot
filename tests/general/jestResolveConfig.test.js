'use strict';

/* global describe, test, expect, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { listConfigNames, resolveJestConfigName } = require('../../scripts/jest-resolve-config');

/** @type {string} */
let rootDir;
/** @type {string | undefined} */
let originalConfigName;

/**
 * Writes a minimal named config under the temp project root.
 *
 * @param {string} relativeDir Directory relative to the temp project root, `.` for the root itself
 * @param {string} name Config suffix
 * @param {string} exchange Value of the `exchange` field
 * @returns {void}
 */
function writeConfig(relativeDir, name, exchange) {
  const dir = path.join(rootDir, relativeDir);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `config.${name}.jsonc`), `{\n  // Comment\n  "exchange": "${exchange}"\n}\n`);
}

/**
 * Creates an empty connector file under the temp project root.
 *
 * @param {string} relativeDir Directory relative to the temp project root
 * @param {string} slug Exchange slug, e.g. `binance`
 * @returns {void}
 */
function writeConnector(relativeDir, slug) {
  const dir = path.join(rootDir, relativeDir);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `trader_${slug}.js`), '');
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-jest-config-'));
  originalConfigName = process.env.JEST_CONFIG_NAME;

  delete process.env.JEST_CONFIG_NAME;
});

afterEach(() => {
  if (originalConfigName === undefined) {
    delete process.env.JEST_CONFIG_NAME;
  } else {
    process.env.JEST_CONFIG_NAME = originalConfigName;
  }

  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('resolveJestConfigName', () => {
  test('selects a named config from config/', () => {
    writeConfig('config', 'bot', 'Binance');
    writeConnector('trade/trader', 'binance');

    expect(resolveJestConfigName({ rootDir })).toBe('bot');
  });

  test('selects a named config from the project root', () => {
    writeConfig('.', 'bot', 'Binance');
    writeConnector('trade/trader', 'binance');

    expect(resolveJestConfigName({ rootDir })).toBe('bot');
  });

  test('reads the exchange from config/ when both locations have the config', () => {
    writeConfig('config', 'bot', 'Binance');
    writeConfig('.', 'bot', 'Removedexchange');
    writeConnector('trade/trader', 'binance');

    expect(resolveJestConfigName({ rootDir })).toBe('bot');
  });

  test('skips configs without a connector in trade/trader/', () => {
    writeConfig('config', 'alpha', 'Removedexchange');
    writeConfig('config', 'bot', 'Binance');
    writeConnector('trade/trader', 'binance');

    expect(resolveJestConfigName({ rootDir })).toBe('bot');
  });

  test('does not accept a connector in the old trade/ location', () => {
    writeConfig('config', 'bot', 'Binance');
    writeConnector('trade', 'binance');

    expect(() => resolveJestConfigName({ rootDir })).toThrow('No Jest config found');
  });

  test('falls back to config.default.jsonc in the project root', () => {
    writeConfig('.', 'default', 'Binance');
    writeConnector('trade/trader', 'binance');

    expect(resolveJestConfigName({ rootDir })).toBe('default');
  });

  test('accepts an override from config/', () => {
    writeConfig('config', 'pinned', 'Removedexchange');

    expect(resolveJestConfigName({ rootDir, override: 'pinned' })).toBe('pinned');
  });

  test('names both locations when the override is missing', () => {
    expect(() => resolveJestConfigName({ rootDir, override: 'missing' }))
        .toThrow('config.missing.jsonc was not found in config/ or the project root');
  });
});

describe('listConfigNames', () => {
  test('lists configs from both locations', () => {
    writeConfig('config', 'bot', 'Binance');
    writeConfig('.', 'default', 'Binance');

    expect(listConfigNames(rootDir)).toEqual(['bot', 'default']);
  });
});
