'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonminify = require('jsonminify');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config.default.jsonc');
const MODULES_DIR = path.join(__dirname, '../../modules');
const CONFIG_NAME = 'named_config_test';

/** @type {string} */
let tempDir;
/** @type {string[]} */
let originalArgv;
/** @type {string | undefined} */
let originalConfigPath;
/** @type {string | undefined} */
let originalMmCli;

/**
 * Writes `config.default.jsonc` to a temp file with CLI mode on, so no ADM passphrase is needed.
 *
 * @returns {string} Absolute path to the written config
 */
function writeConfig() {
  const config = JSON.parse(jsonminify(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8')));

  config.cli = true;
  config.pair = 'ADM/USDT';

  const configPath = path.join(tempDir, `config.${CONFIG_NAME}.jsonc`);

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return configPath;
}

/**
 * Loads `modules/configReader` for a named config, with the config lookup mocked.
 *
 * @param {string | undefined} foundPath Path the mocked lookup returns
 * @returns {{ loaded: Record<string, any>, findNamedConfigPath: jest.Mock }} Loaded config and the lookup mock
 * @throws {Error} `process.exit(<code>)` when configReader rejects the config
 */
function loadNamedConfig(foundPath) {
  const findNamedConfigPath = jest.fn(() => foundPath);
  let loaded;

  process.argv = [originalArgv[0], originalArgv[1], CONFIG_NAME];

  jest.isolateModules(() => {
    jest.doMock('../../modules/configPaths', () => ({ findNamedConfigPath }));
    loaded = require('../../modules/configReader');
  });

  return { loaded, findNamedConfigPath };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-named-config-'));
  originalArgv = process.argv;
  originalConfigPath = process.env.MM_CONFIG_PATH;
  originalMmCli = process.env.MM_CLI;

  delete process.env.MM_CONFIG_PATH;
  delete process.env.MM_CLI;

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock('../../modules/configPaths');

  process.argv = originalArgv;

  if (originalConfigPath === undefined) {
    delete process.env.MM_CONFIG_PATH;
  } else {
    process.env.MM_CONFIG_PATH = originalConfigPath;
  }

  if (originalMmCli === undefined) {
    delete process.env.MM_CLI;
  } else {
    process.env.MM_CLI = originalMmCli;
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('configReader named configs', () => {
  test('reads the config found by the lookup', () => {
    const { loaded, findNamedConfigPath } = loadNamedConfig(writeConfig());

    expect(findNamedConfigPath).toHaveBeenCalledWith(CONFIG_NAME);
    expect(loaded.configCustom).toBe(CONFIG_NAME);
    expect(loaded.pair).toBe('ADM/USDT');
  });

  test('keeps configFile relative to modules/, as WebUI config writes expect', () => {
    const configPath = writeConfig();
    const { loaded } = loadNamedConfig(configPath);

    expect(path.resolve(MODULES_DIR, loaded.configFile)).toBe(configPath);
  });

  test('names both locations when the config is missing', () => {
    expect(() => loadNamedConfig(undefined)).toThrow('process.exit(-1)');

    const message = console.error.mock.calls.flat().join('\n');

    expect(message).toContain(`config.${CONFIG_NAME}.jsonc`);
    expect(message).toContain(`'config/' or the project root`);
  });
});
