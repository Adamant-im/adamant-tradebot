'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonminify = require('jsonminify');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config.default.jsonc');

/** @type {string} */
let tempDir;
/** @type {string | undefined} */
let originalConfigPath;

/**
 * Loads `modules/configReader` with `config.default.jsonc`, CLI mode on (no ADM passphrase needed),
 * and `changes` applied on top.
 *
 * @param {(config: Record<string, unknown>) => void} changes Edits the parsed default config
 * @returns {Record<string, any>} Loaded config
 * @throws {Error} `process.exit(<code>)` when configReader rejects the config
 */
function loadConfig(changes) {
  const config = JSON.parse(jsonminify(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8')));

  config.cli = true;
  changes(config);

  const configPath = path.join(tempDir, 'config.jsonc');

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  process.env.MM_CONFIG_PATH = configPath;

  let loaded;

  jest.isolateModules(() => {
    loaded = require('../../modules/configReader');
  });

  return loaded;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-config-'));
  originalConfigPath = process.env.MM_CONFIG_PATH;

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();

  if (originalConfigPath === undefined) {
    delete process.env.MM_CONFIG_PATH;
  } else {
    process.env.MM_CONFIG_PATH = originalConfigPath;
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('configReader coin_price_fallback', () => {
  const defaults = { enabled: true, priceSource: 'last', cacheMs: 30_000 };

  test('documents and loads the default section immediately after infoservice', () => {
    const raw = JSON.parse(jsonminify(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8')));
    const keys = Object.keys(raw);
    expect(keys[keys.indexOf('infoservice') + 1]).toBe('coin_price_fallback');
    expect(loadConfig(() => {}).coin_price_fallback).toEqual(defaults);
  });

  test('fills defaults for older configs', () => {
    expect(loadConfig((raw) => delete raw.coin_price_fallback).coin_price_fallback).toEqual(defaults);
  });

  test.each([
    [{ enabled: false }, { ...defaults, enabled: false }],
    [{ priceSource: 'MiD' }, { ...defaults, priceSource: 'mid' }],
    [{ cacheMs: 0 }, { ...defaults, cacheMs: 0 }],
    [{}, defaults],
  ])('normalizes partial section %p', (input, expected) => {
    expect(loadConfig((raw) => { raw.coin_price_fallback = input; }).coin_price_fallback).toEqual(expected);
  });

  test('warns about misspelled keys and omits them from the normalized config', () => {
    const loaded = loadConfig((raw) => { raw.coin_price_fallback = { priceSorce: 'bid', enabled: false }; });
    expect(loaded.coin_price_fallback).toEqual({ ...defaults, enabled: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('priceSorce'));
  });

  test.each([
    null, false, [], 'last',
    { enabled: 1 }, { enabled: 'false' }, { enabled: null },
    { priceSource: 'close' }, { priceSource: 1 }, { priceSource: null },
    { cacheMs: -1 }, { cacheMs: Infinity }, { cacheMs: '30000' }, { cacheMs: null },
  ])('rejects invalid section %p', (input) => {
    expect(() => loadConfig((raw) => { raw.coin_price_fallback = input; })).toThrow('process.exit(-1)');
    expect(process.exit).toHaveBeenCalledWith(-1);
  });
});
