'use strict';

/* global describe, test, expect, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { findNamedConfigPath, listNamedConfigs } = require('../../modules/configPaths');

/** @type {string} */
let rootDir;

/**
 * Creates an empty file under the temp project root.
 *
 * @param {string} relativePath Path relative to the temp project root
 * @returns {string} Absolute path to the file
 */
function touch(relativePath) {
  const filePath = path.join(rootDir, relativePath);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{}');

  return filePath;
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-config-paths-'));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('findNamedConfigPath', () => {
  test('finds a config in config/', () => {
    const configPath = touch('config/config.bot.jsonc');

    expect(findNamedConfigPath('bot', rootDir)).toBe(configPath);
  });

  test('falls back to the project root', () => {
    const configPath = touch('config.bot.jsonc');

    expect(findNamedConfigPath('bot', rootDir)).toBe(configPath);
  });

  test('prefers config/ when both locations have the config', () => {
    const configPath = touch('config/config.bot.jsonc');

    touch('config.bot.jsonc');

    expect(findNamedConfigPath('bot', rootDir)).toBe(configPath);
  });

  test('returns undefined when the config does not exist', () => {
    touch('config/config.other.jsonc');

    expect(findNamedConfigPath('bot', rootDir)).toBeUndefined();
  });
});

describe('listNamedConfigs', () => {
  test('merges both locations into a sorted list without duplicates', () => {
    touch('config/config.zeta.jsonc');
    touch('config/config.both.jsonc');
    touch('config.both.jsonc');
    touch('config.alpha.jsonc');

    expect(listNamedConfigs(rootDir)).toEqual(['alpha', 'both', 'zeta']);
  });

  test('works without a config/ directory', () => {
    touch('config.alpha.jsonc');

    expect(listNamedConfigs(rootDir)).toEqual(['alpha']);
  });

  test('skips files that are not named configs', () => {
    touch('config.jsonc');
    touch('config/config.jsonc');
    touch('config/notes.txt');
    touch('config/.gitkeep');

    expect(listNamedConfigs(rootDir)).toEqual([]);
  });
});
