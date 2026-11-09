'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const {
  ITERATION_TIMEOUT_MS,
  RESTART_DELAY_MS,
  MAX_ABANDONED_ITERATIONS,
  MAX_ABANDONED_LOG_ENTRIES,
  clearScheduledRestart,
  createIterationLock,
  runExclusiveIteration,
  rescheduleIteration,
} = require('../../helpers/moduleIteration');

jest.mock('../../helpers/notify', () => jest.fn());
jest.mock('../../modules/configReader', () => require('./moduleIteration.trader.mocks').config);
jest.mock('../../modules/DB', () => require('./moduleIteration.trader.mocks').db);
jest.mock('../../trade/settings/tradeParams_iterationtest', () => require('./moduleIteration.trader.mocks').tradeParams, { virtual: true });
jest.mock('../../trade/trader/trader_iterationtest', () => require('./moduleIteration.trader.mocks').traderFactory, { virtual: true });
jest.mock('mongodb', () => ({
  MongoClient: jest.fn(() => {
    throw new Error('MongoClient must not be constructed in module iteration tests');
  }),
}));
jest.mock('axios', () => {
  const axios = /** @type {any} */ (jest.fn(() => Promise.reject(new Error('axios must not be called in module iteration tests'))));
  axios.get = axios;
  axios.post = axios;
  axios.request = axios;
  axios.create = () => axios;
  axios.interceptors = {
    request: { use() {} },
    response: { use() {} },
  };
  return axios;
});

describe('module iteration guard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    clearScheduledRestart();
    jest.useRealTimers();
  });

  test('releases the lock and resolves when work throws', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };

    const finished = await runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      work: async () => {
        throw new Error('placeOrder failed');
      },
    });

    expect(finished).toBe(false);
    expect(lock.finished).toBe(true);
    expect(lock.startedAt).toBe(0);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('placeOrder failed'));
  });

  test('abandons a hung iteration so the next one can run', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };
    let lateSettled = false;

    const hung = runExclusiveIteration({
      moduleName: 'Ladder2',
      lock,
      log,
      notify: false,
      exit: false,
      timeoutMs: 1000,
      work: () => new Promise((resolve) => {
        setTimeout(() => {
          lateSettled = true;
          resolve();
        }, 60 * 1000);
      }),
    });

    expect(lock.finished).toBe(false);

    await jest.advanceTimersByTimeAsync(1000);
    await hung;

    expect(lock.finished).toBe(true);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('timed out after 1000 ms'));

    let ranNext = false;
    const next = runExclusiveIteration({
      moduleName: 'Ladder2',
      lock,
      log,
      notify: false,
      exit: false,
      timeoutMs: 1000,
      work: async () => {
        ranNext = true;
      },
    });

    await next;

    expect(ranNext).toBe(true);
    expect(lock.finished).toBe(true);

    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(lateSettled).toBe(true);
    expect(lock.finished).toBe(true);
    expect(lock.abandoned).toBe(0);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('abandoned iteration 1 finished after'));
  });

  test('does not let a timed-out iteration release a newer lock', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };
    /** @type {((value?: void) => void) | undefined} */
    let releaseSecond;

    const hung = runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      notify: false,
      exit: false,
      timeoutMs: 5000,
      work: () => new Promise(() => {}),
    });

    // The next caller sees an expired owner before the first timeout fires.
    lock.startedAt = Date.now() - 60 * 1000;

    const second = runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      timeoutMs: 60 * 1000,
      work: () => new Promise((resolve) => {
        releaseSecond = resolve;
      }),
    });

    await jest.advanceTimersByTimeAsync(5000);
    await hung;

    expect(lock.generation).toBe(2);
    expect(lock.finished).toBe(false);

    if (typeof releaseSecond !== 'function') {
      throw new Error('Second iteration release callback was not assigned');
    }

    releaseSecond();
    await second;
    expect(lock.finished).toBe(true);
  });

  test('restarts the process on the third timed-out iteration', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };
    const notify = jest.fn();
    const exit = jest.fn();

    async function timeOutOnce() {
      const run = runExclusiveIteration({
        moduleName: 'Ladder-cap',
        lock,
        log,
        notify,
        exit,
        restartDelayMs: 0,
        timeoutMs: 1000,
        work: () => new Promise(() => {}),
      });

      await jest.advanceTimersByTimeAsync(1000);
      await run;
    }

    await timeOutOnce();
    expect(lock.abandoned).toBe(1);
    expect(exit).not.toHaveBeenCalled();

    await timeOutOnce();
    expect(lock.abandoned).toBe(2);
    expect(exit).not.toHaveBeenCalled();

    let thirdStarted = false;
    const third = runExclusiveIteration({
      moduleName: 'Ladder-cap',
      lock,
      log,
      notify,
      exit,
      restartDelayMs: 0,
      timeoutMs: 1000,
      work: () => {
        thirdStarted = true;
        return new Promise(() => {});
      },
    });

    await jest.advanceTimersByTimeAsync(1000);
    await third;

    expect(thirdStarted).toBe(true);
    expect(lock.abandoned).toBe(MAX_ABANDONED_ITERATIONS + 1);
    expect(lock.restarting).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
    expect(notify).toHaveBeenCalledWith(
        expect.stringContaining('Restarting'),
        'error',
        false,
        true,
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Entry stacks show which iteration started'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Ladder-cap iteration 1 started'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Ladder-cap iteration 3 started'));

    const blocked = await runExclusiveIteration({
      moduleName: 'Ladder-cap',
      lock,
      log,
      notify,
      exit,
      restartDelayMs: 0,
      timeoutMs: 1000,
      work: async () => {
        throw new Error('must not run after restart');
      },
    });

    expect(blocked).toBe(false);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  test('postpones overlapping work inside the timeout window', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };
    const onBusy = jest.fn();
    /** @type {((value?: void) => void) | undefined} */
    let releaseFirst;

    const first = runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      timeoutMs: 5000,
      work: () => new Promise((resolve) => {
        releaseFirst = resolve;
      }),
    });

    const skipped = await runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      timeoutMs: 5000,
      onBusy,
      work: async () => {
        throw new Error('must not run');
      },
    });

    expect(skipped).toBe(false);
    expect(onBusy).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();

    if (typeof releaseFirst !== 'function') {
      throw new Error('First iteration release callback was not assigned');
    }

    releaseFirst();
    await first;
    expect(lock.finished).toBe(true);
  });

  test('trader iteration runs again after a thrown step and after a hung step', async () => {
    const { createTraderRuntime } = require('../../trade/features/mm_trader');
    const log = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
    };
    const tradeParams = {
      mm_isActive: true,
      mm_isTraderActive: true,
      mm_Policy: 'optimal',
      mm_minInterval: 1000,
      mm_maxInterval: 1000,
    };
    const runtimeOptions = {
      log,
      notify: () => {},
      exit: jest.fn(),
      niceChart: undefined,
      randomValue: () => 1000,
      tradeParams,
      config: {
        nice_chart: { enabled: false },
        perpetual: '',
        pair: 'ADM/USDT',
        defaultPair: 'ADM/USDT',
      },
    };

    let thrownCalls = 0;
    const throwingRuntime = createTraderRuntime(runtimeOptions);
    throwingRuntime.executeMmOrder = async () => {
      thrownCalls += 1;
      throw new Error('trader step failed');
    };

    await throwingRuntime.iteration();
    expect(thrownCalls).toBe(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(thrownCalls).toBe(2);
    tradeParams.mm_isActive = false;

    const hangParams = { ...tradeParams, mm_isActive: true };
    let hungCalls = 0;
    const hangingRuntime = createTraderRuntime({
      ...runtimeOptions,
      tradeParams: hangParams,
    });
    hangingRuntime.executeMmOrder = () => {
      hungCalls += 1;
      return new Promise(() => {});
    };

    const hungIteration = hangingRuntime.iteration();
    await jest.advanceTimersByTimeAsync(ITERATION_TIMEOUT_MS);
    await hungIteration;
    expect(hungCalls).toBe(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(hungCalls).toBe(2);
    hangParams.mm_isActive = false;
  });

  test('trader restarts after three unsettled timeouts', async () => {
    const { createTraderRuntime } = require('../../trade/features/mm_trader');
    const exit = jest.fn();
    const notify = jest.fn();
    const log = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
    };
    let calls = 0;
    const runtime = createTraderRuntime({
      log,
      notify,
      exit,
      niceChart: undefined,
      randomValue: () => 1000,
      tradeParams: {
        mm_isActive: true,
        mm_isTraderActive: true,
        mm_Policy: 'optimal',
        mm_minInterval: 1000,
        mm_maxInterval: 1000,
      },
      config: {
        nice_chart: { enabled: false },
        perpetual: '',
        pair: 'ADM/USDT',
        defaultPair: 'ADM/USDT',
      },
    });

    runtime.executeMmOrder = () => {
      calls += 1;
      return new Promise(() => {});
    };

    const pending = runtime.iteration();
    await jest.advanceTimersByTimeAsync(ITERATION_TIMEOUT_MS * 3 + RESTART_DELAY_MS + 5000);
    await pending;

    expect(calls).toBe(3);
    expect(exit).toHaveBeenCalledWith(1);
    expect(require('axios')).not.toHaveBeenCalled();
    expect(require('mongodb').MongoClient).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
        expect.stringContaining('Restarting'),
        'error',
        false,
        true,
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Entry stacks show which iteration started'));
    runtime.deps.tradeParams.mm_isActive = false;
  });

  test('uses the owner timeout, not the caller timeout, to detect a stuck owner', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };
    const onBusy = jest.fn();

    const owner = runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      notify: false,
      exit: false,
      timeoutMs: 60 * 1000,
      work: () => new Promise(() => {}),
    });

    await jest.advanceTimersByTimeAsync(10 * 1000);

    const skipped = await runExclusiveIteration({
      moduleName: 'Liquidity',
      lock,
      log,
      notify: false,
      exit: false,
      timeoutMs: 5000,
      onBusy,
      work: async () => {
        throw new Error('must not run while the owner is inside its own timeout');
      },
    });

    expect(skipped).toBe(false);
    expect(onBusy).toHaveBeenCalledTimes(1);
    expect(lock.generation).toBe(1);

    await jest.advanceTimersByTimeAsync(50 * 1000);
    await owner;
  });

  test('successful iterations do not retain abandoned records', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };

    for (let i = 0; i < 5; i++) {
      await runExclusiveIteration({
        moduleName: 'Liquidity',
        lock,
        log,
        notify: false,
        exit: false,
        work: async () => {},
      });
    }

    expect(lock.abandoned).toBe(0);
    expect(lock.abandonedLog).toEqual([]);
  });

  test('abandonedLog drops the oldest settled entry before an older unsettled one', async () => {
    const lock = createIterationLock();
    const log = { error: jest.fn() };

    /**
     * @param {() => Promise<void>} work
     * @param {number} [timeoutMs]
     * @returns {Promise<void>}
     */
    async function timeOut(work, timeoutMs = 10) {
      const run = runExclusiveIteration({
        moduleName: 'Log-cap',
        lock,
        log,
        notify: false,
        exit: false,
        timeoutMs,
        work,
      });

      await jest.advanceTimersByTimeAsync(timeoutMs);
      await run;
    }

    /**
     * @param {number} settleAfterMs
     * @returns {Promise<void>}
     */
    async function timeOutThenSettle(settleAfterMs) {
      await timeOut(() => new Promise((resolve) => {
        setTimeout(resolve, settleAfterMs);
      }));
      await jest.advanceTimersByTimeAsync(settleAfterMs);
    }

    // Generation 1 stays unsettled and is older than every settled entry.
    await timeOut(() => new Promise(() => {}));
    // Generations 2 and 3 settle. Overflow must drop 2 and keep 3.
    await timeOutThenSettle(1000);
    await timeOutThenSettle(1000);

    expect(lock.abandonedLog.find((entry) => entry.generation === 1)?.settledAt).toBeUndefined();
    expect(lock.abandonedLog.find((entry) => entry.generation === 2)?.settledAt).toEqual(expect.any(Number));
    expect(lock.abandonedLog.find((entry) => entry.generation === 3)?.settledAt).toEqual(expect.any(Number));

    while (lock.abandonedLog.length < MAX_ABANDONED_LOG_ENTRIES) {
      await timeOut(() => new Promise(() => {}));
    }

    await timeOut(() => new Promise(() => {}));

    const generations = lock.abandonedLog.map((entry) => entry.generation);

    expect(lock.abandonedLog).toHaveLength(MAX_ABANDONED_LOG_ENTRIES);
    expect(generations[0]).toBe(1);
    expect(generations).not.toContain(2);
    expect(generations).toContain(3);
    expect(generations).toContain(MAX_ABANDONED_LOG_ENTRIES + 1);
  });

  test('rescheduleIteration invokes the next tick after the delay', async () => {
    const again = jest.fn();

    rescheduleIteration(again, 3000);

    await jest.advanceTimersByTimeAsync(2999);
    expect(again).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(again).toHaveBeenCalledTimes(1);
  });
});
