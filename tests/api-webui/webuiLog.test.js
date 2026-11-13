'use strict';

/* global jest, describe, test, expect */

jest.mock('../../helpers/log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
}));

const log = require('../../helpers/log');
const webuiLog = require('../../api/lib/webuiLog');

describe('WebUI log helpers', () => {
  test('warnThrottled warns once per key and window, then logs repeats at debug', () => {
    webuiLog.warnThrottled('viewer|GET|/api/v1/messages', 'denied', 1_000, 10_000);
    webuiLog.warnThrottled('viewer|GET|/api/v1/messages', 'denied', 1_000, 10_500);
    webuiLog.warnThrottled('viewer|GET|/api/v1/logs', 'denied logs', 1_000, 10_600);
    webuiLog.warnThrottled('viewer|GET|/api/v1/messages', 'denied', 1_000, 11_000);

    expect(log.warn.mock.calls).toEqual([
      ['WebUI: denied'],
      ['WebUI: denied logs'],
      ['WebUI: denied'],
    ]);
    expect(log.debug.mock.calls).toEqual([
      ['WebUI: denied'],
    ]);
  });

  test('warnThrottled keeps its key map bounded', () => {
    log.warn.mockClear();
    log.debug.mockClear();

    webuiLog.warnThrottled('bounded|first', 'first', 60_000, 0);

    for (let i = 0; i < 10_000; i++) {
      webuiLog.warnThrottled(`bounded|ip-${i}`, 'flood', 60_000, 1);
    }

    // The map was reset when it filled up, so the first key warns again inside its window
    webuiLog.warnThrottled('bounded|first', 'first', 60_000, 2);

    expect(log.warn.mock.calls.filter(([msg]) => msg === 'WebUI: first')).toHaveLength(2);
    expect(log.debug).not.toHaveBeenCalled();
  });
});
