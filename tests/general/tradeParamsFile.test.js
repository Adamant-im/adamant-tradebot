'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonminify = require('jsonminify');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config.default.jsonc');
const SETTINGS_DIR = path.join(__dirname, '../../trade/settings');

/** How long to wait for an `fs.watch()` event. Must stay below the Jest test timeout. */
const WATCH_TIMEOUT_MS = 3000;

/** On macOS, kqueue starts watching on the next event loop iteration, so a same-tick write goes unseen */
const WATCH_START_DELAY_MS = 50;

const mockLog = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
};

/** @type {string} */
let tempDir;
/** @type {string} */
let workDir;
/** @type {string} */
let tradeParamsPath;
/** @type {string} */
let originalCwd;
/** @type {string | undefined} */
let originalMmCli;
/** @type {string | undefined} */
let originalConfigPath;
/** @type {Array<import('fs').FSWatcher>} */
let watchers;

/**
 * Writes a trade params file in the format of `utils.saveConfig()`.
 *
 * @param {Record<string, unknown>} params Trade params
 */
function writeTradeParams(params) {
  fs.writeFileSync(
      tradeParamsPath,
      'module.exports = ' + JSON.stringify(params, null, 2).replace(/"/g, '\'').replace(/\n\}/g, ',\n};\n'),
  );
}

/**
 * Loads `helpers/utils` against a temporary trade params file.
 *
 * @returns {{ utils: Record<string, any>, tradeParams: Record<string, any> }}
 */
function loadUtils() {
  const tradeParams = { mm_isActive: true };
  const mockedConfig = {
    exchange: 'tradeparamstest',
    file: 'tradeParams_tradeparamstest.js',
    fileWithPath: tradeParamsPath,
    volumes_thresholds_usd: {},
  };

  let utils;

  writeTradeParams(tradeParams);

  jest.isolateModules(() => {
    jest.doMock('../../modules/configReader', () => mockedConfig);
    jest.doMock('../../helpers/log', () => mockLog);
    jest.doMock('../../trade/settings/tradeParams_tradeparamstest', () => tradeParams, { virtual: true });

    utils = require('../../helpers/utils');
  });

  return { utils, tradeParams };
}

/**
 * Starts the watcher and waits until it sees file changes.
 *
 * @param {Record<string, any>} utils `helpers/utils` instance
 * @returns {Promise<void>}
 */
async function startWatcher(utils) {
  utils.watchConfig();

  await new Promise((resolve) => setTimeout(resolve, WATCH_START_DELAY_MS));
}

/**
 * Waits until a condition holds, or fails the test.
 *
 * @param {() => boolean} condition Condition to poll
 * @returns {Promise<void>}
 */
async function waitFor(condition) {
  const deadline = Date.now() + WATCH_TIMEOUT_MS;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the trade params watcher');
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-trade-params-'));
  workDir = path.join(tempDir, 'work');
  tradeParamsPath = path.join(tempDir, 'package', 'trade', 'settings', 'tradeParams_tradeparamstest.js');

  fs.mkdirSync(workDir);
  fs.mkdirSync(path.dirname(tradeParamsPath), { recursive: true });

  originalCwd = process.cwd();
  originalMmCli = process.env.MM_CLI;
  originalConfigPath = process.env.MM_CONFIG_PATH;

  delete process.env.MM_CLI;
  delete process.env.MM_CONFIG_PATH;

  // The bot runs in the work dir under `mm on`, which is not the package root
  process.chdir(workDir);

  watchers = [];

  const realWatch = fs.watch;

  jest.spyOn(fs, 'watch').mockImplementation((...args) => {
    const watcher = realWatch(...args);

    watchers.push(watcher);

    return watcher;
  });

  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock('../../modules/configReader');
  jest.dontMock('../../helpers/log');

  watchers.forEach((watcher) => watcher.close());

  process.chdir(originalCwd);

  if (originalMmCli === undefined) {
    delete process.env.MM_CLI;
  } else {
    process.env.MM_CLI = originalMmCli;
  }

  if (originalConfigPath === undefined) {
    delete process.env.MM_CONFIG_PATH;
  } else {
    process.env.MM_CONFIG_PATH = originalConfigPath;
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('config.fileWithPath', () => {
  test('points to the file the bot loads, from any working directory', () => {
    const configPath = path.join(tempDir, 'config.jsonc');
    const defaultConfig = JSON.parse(jsonminify(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8')));

    fs.writeFileSync(configPath, JSON.stringify({
      ...defaultConfig,
      cli: true,
      pair: 'ADM/USDT',
    }));

    process.env.MM_CONFIG_PATH = configPath;

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});

    let loaded;

    jest.isolateModules(() => {
      loaded = jest.requireActual('../../modules/configReader');
    });

    expect(path.isAbsolute(loaded.fileWithPath)).toBe(true);
    expect(loaded.fileWithPath).toBe(path.join(SETTINGS_DIR, `tradeParams_${loaded.exchange}.js`));
  });
});

describe('utils.saveConfig', () => {
  test('saves to the trade params file when the working directory is not the package root', () => {
    const { utils, tradeParams } = loadUtils();

    tradeParams.mm_isActive = false;
    utils.saveConfig(false, 'test');

    expect(mockLog.warn).not.toHaveBeenCalled();
    expect(fs.readFileSync(tradeParamsPath, 'utf8')).toContain('\'mm_isActive\': false');
    expect(fs.existsSync(path.join(workDir, 'trade'))).toBe(false);
  });

  test('saved params read back through utils.readTradeConfig', () => {
    const { utils, tradeParams } = loadUtils();

    tradeParams.mm_minAmount = 5;
    utils.saveConfig(false, 'test');

    expect(JSON.parse(utils.readTradeConfig())).toEqual({
      mm_isActive: true,
      mm_minAmount: 5,
    });
  });
});

describe('utils.watchConfig', () => {
  test('does not start when utils is loaded', () => {
    loadUtils();

    expect(fs.watch).not.toHaveBeenCalled();
  });

  test.each([
    ['an `mm` command', '1'],
    ['the bot', undefined],
  ])('does not depend on MM_CLI: not started for %s without the explicit call', (name, mmCli) => {
    if (mmCli) {
      process.env.MM_CLI = mmCli;
    }

    loadUtils();

    expect(fs.watch).not.toHaveBeenCalled();
  });

  test('picks up external changes when the working directory is not the package root', async () => {
    const { utils, tradeParams } = loadUtils();

    await startWatcher(utils);

    writeTradeParams({
      mm_isActive: false,
      mm_minAmount: 7,
    });

    await waitFor(() => tradeParams.mm_minAmount === 7);

    expect(tradeParams.mm_isActive).toBe(false);
  });

  test('keeps watching after editors replace the file atomically', async () => {
    const { utils, tradeParams } = loadUtils();

    /**
     * Saves the file the way `sed -i` and atomic-save editors do: write a new file, rename it over the old one.
     *
     * @param {number} amount New `mm_minAmount`
     */
    const saveAtomically = (amount) => {
      const original = tradeParamsPath;

      tradeParamsPath = `${original}.tmp`;
      writeTradeParams({
        mm_isActive: true,
        mm_minAmount: amount,
      });
      tradeParamsPath = original;

      fs.renameSync(`${original}.tmp`, original);
    };

    await startWatcher(utils);

    saveAtomically(1);
    await waitFor(() => tradeParams.mm_minAmount === 1);
    await new Promise((resolve) => setTimeout(resolve, WATCH_START_DELAY_MS));

    saveAtomically(2);
    await waitFor(() => tradeParams.mm_minAmount === 2);
    await new Promise((resolve) => setTimeout(resolve, WATCH_START_DELAY_MS));

    writeTradeParams({
      mm_isActive: true,
      mm_minAmount: 3,
    });
    await waitFor(() => tradeParams.mm_minAmount === 3);
  });

  test('watches the file again after it was deleted and created anew', () => {
    jest.useFakeTimers();

    try {
      const { utils, tradeParams } = loadUtils();

      utils.watchConfig();

      const [[, onChange]] = fs.watch.mock.calls;

      fs.rmSync(tradeParamsPath);
      onChange('rename');

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('is missing'));

      writeTradeParams({
        mm_isActive: true,
        mm_minAmount: 4,
      });

      // One failed attempt so far. The retry must wait, so a missing file does not spin the event loop.
      jest.advanceTimersByTime(4999);
      expect(fs.watch).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1);
      expect(fs.watch).toHaveBeenCalledTimes(3);
      expect(tradeParams.mm_minAmount).toBe(4);
    } finally {
      jest.useRealTimers();
    }
  });

  test('starts a single watcher when called twice', () => {
    const { utils } = loadUtils();

    utils.watchConfig();
    utils.watchConfig();

    expect(fs.watch).toHaveBeenCalledTimes(1);
  });

  test('keeps the in-memory params when the file becomes invalid', async () => {
    const { utils, tradeParams } = loadUtils();

    await startWatcher(utils);

    fs.writeFileSync(tradeParamsPath, 'module.exports = {');

    await waitFor(() => mockLog.warn.mock.calls.length > 0);

    expect(mockLog.warn.mock.calls[0][0]).toContain('not valid JSON');
    expect(tradeParams).toEqual({ mm_isActive: true });
  });

  test('logs a failure to watch and does not throw', () => {
    const { utils } = loadUtils();

    fs.rmSync(tradeParamsPath);

    expect(() => utils.watchConfig()).not.toThrow();
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Failed to watch'));
  });
});

describe('utils.syncTradeConfig', () => {
  test('applies the file, so the CLI instance does not save stale params over the bot', () => {
    const { utils, tradeParams } = loadUtils();

    // The bot paused market-making while the CLI instance was open
    writeTradeParams({ mm_isActive: false });

    utils.syncTradeConfig();

    tradeParams.mm_minAmount = 3;
    utils.saveConfig(false, 'cli');

    expect(JSON.parse(utils.readTradeConfig())).toEqual({
      mm_isActive: false,
      mm_minAmount: 3,
    });
  });

  test('does not throw when the file is missing', () => {
    const { utils, tradeParams } = loadUtils();

    fs.rmSync(tradeParamsPath);

    expect(() => utils.syncTradeConfig()).not.toThrow();
    expect(tradeParams).toEqual({ mm_isActive: true });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to read'));
  });
});
