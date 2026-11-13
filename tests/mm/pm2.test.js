'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const mockPm2 = {
  connect: jest.fn((callback) => callback()),
  start: jest.fn((options, callback) => callback()),
};

jest.mock('pm2', () => mockPm2);

const { startProcess } = require('../../modules/mm/pm2');

/** @type {string | undefined} */
let originalMmCli;

beforeEach(() => {
  jest.clearAllMocks();

  originalMmCli = process.env.MM_CLI;
  process.env.MM_CLI = '1';
});

afterEach(() => {
  if (originalMmCli === undefined) {
    delete process.env.MM_CLI;
  } else {
    process.env.MM_CLI = originalMmCli;
  }
});

describe('mm on', () => {
  test('clears MM_CLI for the bot and keeps the given env', async () => {
    await startProcess('mm-app', '/package/app.js', {
      cwd: '/work',
      env: {
        MM_CONFIG_PATH: '/work/config.jsonc',
      },
    });

    expect(mockPm2.start.mock.calls[0][0]).toMatchObject({
      name: 'mm-app',
      script: '/package/app.js',
      cwd: '/work',
      env: {
        MM_CONFIG_PATH: '/work/config.jsonc',
        MM_CLI: '',
      },
    });
  });

  test('leaves MM_CLI set for the `mm` process itself', async () => {
    await startProcess('mm-app', '/package/app.js', { cwd: '/work' });

    expect(process.env.MM_CLI).toBe('1');
  });
});
