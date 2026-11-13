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

describe('configReader log_rotate', () => {
  test('loads the section from config.default.jsonc', () => {
    const config = loadConfig(() => {});

    expect(config.log_level).toBe('log');
    expect(config.log_rotate).toEqual({
      enabled: true,
      maxSize: '300M',
      retain: 5,
      compress: true,
      rotateInterval: '0 0 * * *',
      rotateOnRestart: false,
    });
  });

  test('uses the defaults when an older config has no log_rotate section', () => {
    const config = loadConfig((raw) => {
      delete raw.log_rotate;
    });

    expect(config.log_rotate).toEqual({
      enabled: true,
      maxSize: '300M',
      retain: 5,
      compress: true,
      rotateInterval: '0 0 * * *',
      rotateOnRestart: false,
    });
  });

  test('fills missing fields of a partial section', () => {
    const config = loadConfig((raw) => {
      raw.log_rotate = { maxSize: '50M', rotateInterval: false };
    });

    expect(config.log_rotate).toEqual(expect.objectContaining({
      maxSize: '50M',
      retain: 5,
      rotateInterval: '',
    }));
  });

  test.each([
    [{ maxSize: 'big' }, /log_rotate\.maxSize 'big' is not a size/],
    [{ retain: 0 }, /log_rotate\.retain must be a whole number of at least 1/],
    [{ rotateInterval: '0 0 0 1 *' }, /log_rotate\.rotateInterval '0 0 0 1 \*': day of month '0' is out of range 1-31/],
    [{ maxsize: '10M' }, /log_rotate has unknown field\(s\) maxsize/],
  ])('rejects %j and stops the bot', (section, message) => {
    expect(() => loadConfig((raw) => {
      raw.log_rotate = section;
    })).toThrow('process.exit(-1)');

    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^Config reader: Configuration for .+ is invalid: /));
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(message));
  });

  test('rejects a section that is not an object', () => {
    expect(() => loadConfig((raw) => {
      raw.log_rotate = true;
    })).toThrow('process.exit(-1)');

    expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/field 'log_rotate' has type Boolean, expected Object/),
    );
  });
});
