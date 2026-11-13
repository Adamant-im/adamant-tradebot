'use strict';

/**
 * Keeps market-making module loops alive when one iteration throws or never settles.
 *
 * Module loops used to `await` the iteration body and only then call `setTimeout`.
 * A rejected promise skipped the next tick. A promise that never settled (exchange
 * request whose outer Promise was left pending) stopped that module until process restart.
 * Other modules kept running, so the process looked healthy.
 *
 * @module helpers/moduleIteration
 */

const constants = require('./const');

const IDLE_INTERVAL_MS = 3000;

/** Backstop for a stuck iteration. Normal ticks finish in seconds. */
const ITERATION_TIMEOUT_MS = 10 * constants.MINUTE;

/**
 * Two timed-out iterations that have not settled may stay in flight.
 * The count is since process start, not a streak of consecutive timeouts.
 * The third unsettled timeout restarts the process.
 */
const MAX_ABANDONED_ITERATIONS = 2;

/**
 * Gives the priority notification time to leave, and gives in-flight exchange calls
 * a chance to finish writing their orders, before the process exits. Best effort only:
 * requests use a 10 s HTTP timeout plus a DB write, so a call can still be cut off.
 * New iterations are already blocked.
 */
const RESTART_DELAY_MS = 10 * 1000;

/** Restart reports only need unsettled attempts plus a few recent late failures. */
const MAX_ABANDONED_LOG_ENTRIES = 20;

/** At most one timeout notification per module per hour. */
const TIMEOUT_NOTIFY_INTERVAL_MS = constants.HOUR;

/** @type {Map<string, number>} */
const lastTimeoutNotifyAt = new Map();

/**
 * Set when any module has scheduled a process restart, so other module loops do not start new work.
 * Only runExclusiveIteration() callers check it. Manual commands and orderCollector intervals still run until exit.
 */
let restartScheduled = false;

/**
 * Overlap lock shared by a module loop and any out-of-band run of the same work.
 *
 * @typedef {Object} IterationLock
 * @property {boolean} finished True when this lock does not own an in-flight iteration
 * @property {number} generation Increments when an iteration starts. A timed-out call must not release a newer owner.
 * @property {number} startedAt Unix ms when the current owner started. `0` when idle.
 * @property {number} timeoutMs Timeout of the current owner. Staleness uses this, not the next caller's timeout.
 * @property {number} abandoned Timed-out iterations that have not settled yet
 * @property {boolean} restarting True after the third timeout has scheduled a process restart
 * @property {AbandonedIteration[]} abandonedLog Timed-out iterations, including ones that later settled
 */

/**
 * One timed-out iteration, kept so a later restart can show why the module wedged.
 *
 * @typedef {Object} AbandonedIteration
 * @property {number} generation Iteration number on this lock
 * @property {string} moduleName Module that started the iteration
 * @property {number} startedAt Unix ms when the iteration started
 * @property {number} timeoutMs Timeout used for this iteration
 * @property {string} entryStack Stack captured when the iteration started. A hung await has no stack of its own.
 * @property {number} [timedOutAt] Unix ms when the timeout fired
 * @property {number} [settledAt] Unix ms when the abandoned call later settled
 * @property {string} [lateError] Error text when the abandoned call later rejected
 */

/**
 * @returns {IterationLock} Idle lock
 */
function createIterationLock() {
  return {
    finished: true,
    generation: 0,
    startedAt: 0,
    timeoutMs: 0,
    abandoned: 0,
    restarting: false,
    abandonedLog: [],
  };
}

/**
 * @param {object} [log]
 * @returns {{ error: (message: string) => void }}
 */
function resolveLog(log) {
  if (log && typeof log.error === 'function') {
    return log;
  }

  return require('./log');
}

/**
 * Runs `work` when `lock` is free.
 * Always releases the lock when `work` throws or exceeds `timeoutMs`, then resolves.
 * A timed-out `work` may still finish later. It must not clear a lock owned by a newer generation.
 *
 * @param {object} options
 * @param {string} options.moduleName Name used in error logs
 * @param {IterationLock} options.lock Overlap lock for this module instance
 * @param {() => (Promise<void>|void)} options.work One iteration body
 * @param {() => void} [options.onBusy] Called when a previous iteration is still inside the timeout window
 * @param {number} [options.timeoutMs] Abandon the in-flight call after this many milliseconds
 * @param {{ error: (message: string) => void }} [options.log] Logger override for tests
 * @param {((message: string, type: string, silent?: boolean, isPriority?: boolean) => void) | false} [options.notify] Timeout alert. Omitted uses helpers/notify. `false` disables it.
 * @param {((code: number) => void) | false} [options.exit] Process exit used after the third unsettled timeout. Omitted uses `process.exit`. Pass `false` to skip the exit.
 * @param {number} [options.restartDelayMs] Delay before exit so priority notifications can be sent. `0` exits immediately.
 * @returns {Promise<boolean>} True when `work` finished without throwing
 */
async function runExclusiveIteration(options) {
  const {
    moduleName,
    lock,
    work,
    onBusy,
    timeoutMs = ITERATION_TIMEOUT_MS,
    log: logOption,
    notify: notifyOption,
    exit: exitOption,
    restartDelayMs = RESTART_DELAY_MS,
  } = options;
  const log = resolveLog(logOption);
  const notify = resolveNotify(notifyOption);
  const exit = resolveExit(exitOption);

  if (restartScheduled || lock.restarting) {
    return false;
  }

  if (!lock.finished) {
    const ownerTimeoutMs = lock.timeoutMs || timeoutMs;
    const heldFor = lock.startedAt ? Date.now() - lock.startedAt : ownerTimeoutMs;

    if (heldFor < ownerTimeoutMs) {
      if (typeof onBusy === 'function') {
        onBusy();
      }

      return false;
    }
  }

  if (!lock.finished) {
    const heldFor = lock.startedAt ? Date.now() - lock.startedAt : (lock.timeoutMs || timeoutMs);

    log.error(
        `${moduleName}: previous iteration is still running after ${heldFor} ms. ` +
        'Starting a new one so the module does not stay stopped. The abandoned call may still finish later.',
    );
  }

  const generation = ++lock.generation;
  lock.finished = false;
  lock.startedAt = Date.now();
  lock.timeoutMs = timeoutMs;

  const entryError = new Error(`${moduleName} iteration ${generation} started`);
  /** @type {AbandonedIteration} */
  const attempt = {
    generation,
    moduleName,
    startedAt: lock.startedAt,
    timeoutMs,
    entryStack: '',
  };

  let timedOut = false;
  let timer;
  const startedAt = lock.startedAt;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      attempt.timedOutAt = Date.now();
      attempt.entryStack = entryError.stack || '';
      lock.abandonedLog.push(attempt);
      if (lock.abandonedLog.length > MAX_ABANDONED_LOG_ENTRIES) {
        // Unsettled entries are needed for the restart report. Drop the oldest settled one.
        const settledIndex = lock.abandonedLog.findIndex((entry) => entry.settledAt);
        lock.abandonedLog.splice(settledIndex === -1 ? 0 : settledIndex, 1);
      }
      lock.abandoned += 1;
      reject(new Error(
          `${moduleName} iteration ${generation} timed out after ${timeoutMs} ms. ` +
          `${lock.abandoned} abandoned iteration(s) are still in flight.`,
      ));
    }, timeoutMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  const workPromise = Promise.resolve().then(() => work());
  workPromise.then(
      () => {
        if (!timedOut) return;

        attempt.settledAt = Date.now();
        lock.abandoned = Math.max(0, lock.abandoned - 1);
        log.error(`${moduleName}: abandoned iteration ${generation} finished after ${Date.now() - startedAt} ms.`);
      },
      (error) => {
        if (!timedOut) return;

        attempt.settledAt = Date.now();
        attempt.lateError = String(error);
        lock.abandoned = Math.max(0, lock.abandoned - 1);
        log.error(`${moduleName}: abandoned iteration ${generation} failed after ${Date.now() - startedAt} ms: ${error}`);
      },
  );

  try {
    await Promise.race([workPromise, timeout]);
    return true;
  } catch (error) {
    log.error(`Error in ${moduleName} iteration: ${error}`);

    if (timedOut && lock.abandoned > MAX_ABANDONED_ITERATIONS) {
      restartAfterRepeatedTimeouts(log, notify, exit, lock, moduleName, restartDelayMs);
    } else if (timedOut) {
      notifyTimeout(notify, moduleName, `${moduleName}: iteration ${generation} timed out after ${timeoutMs} ms and was abandoned.`);
    }

    return false;
  } finally {
    clearTimeout(timer);

    if (lock.generation === generation) {
      lock.finished = true;
      lock.startedAt = 0;
      lock.timeoutMs = 0;
    }
  }
}

/**
 * @param {((message: string, type: string, silent?: boolean, isPriority?: boolean) => void) | false | undefined} notifyOption
 * @returns {((message: string, type: string, silent?: boolean, isPriority?: boolean) => void) | null}
 */
function resolveNotify(notifyOption) {
  if (notifyOption === false) return null;
  if (typeof notifyOption === 'function') return notifyOption;

  return /** @type {(message: string, type: string, silent?: boolean, isPriority?: boolean) => void} */ (require('./notify'));
}

/**
 * @param {((code: number) => void) | false | undefined} exitOption
 * @returns {((code: number) => void) | null}
 */
function resolveExit(exitOption) {
  if (exitOption === false) return null;
  if (typeof exitOption === 'function') return exitOption;

  return (code) => process.exit(code);
}

/**
 * Logs every abandoned iteration and restarts the process.
 * The hung await itself has no stack. Entry stacks show which iteration started.
 *
 * @param {{ error: (message: string) => void }} log
 * @param {((message: string, type: string, silent?: boolean, isPriority?: boolean) => void) | null} notify
 * @param {((code: number) => void) | null} exit
 * @param {IterationLock} lock
 * @param {string} moduleName
 * @param {number} restartDelayMs
 * @returns {void}
 */
function restartAfterRepeatedTimeouts(log, notify, exit, lock, moduleName, restartDelayMs) {
  if (lock.restarting || restartScheduled) return;

  if (typeof exit !== 'function') {
    log.error(
        `${moduleName}: ${lock.abandoned} unsettled timed-out iterations. ` +
        'Process restart was not scheduled because no exit function is available.',
    );
    return;
  }

  restartScheduled = true;
  lock.restarting = true;

  const pending = lock.abandonedLog.filter((attempt) => attempt.timedOutAt && !attempt.settledAt);
  const lateFailures = lock.abandonedLog.filter((attempt) => attempt.lateError);
  const lines = [
    `${moduleName}: ${pending.length} iterations timed out and have not settled. Restarting the process.`,
    'A hung await does not provide its own stack. Entry stacks show which iteration started.',
  ];

  for (const attempt of pending) {
    const ageMs = Date.now() - attempt.startedAt;
    lines.push(`#${attempt.generation} ${attempt.moduleName} started ${ageMs} ms ago, timeout ${attempt.timeoutMs} ms.`);
    if (attempt.entryStack) lines.push(attempt.entryStack);
  }

  for (const attempt of lateFailures) {
    lines.push(`#${attempt.generation} ${attempt.moduleName} later failed: ${attempt.lateError}`);
  }

  const report = lines.join('\n');
  log.error(report);

  if (typeof notify === 'function') {
    const latest = pending[pending.length - 1];
    const ageMs = latest ? Date.now() - latest.startedAt : 0;
    notify(
        `${moduleName}: ${pending.length} iterations timed out without settling. ` +
        `Latest #${latest ? latest.generation : '?'} has been running for ${ageMs} ms. Restarting. ` +
        'Entry stacks are in the error log.',
        'error',
        false,
        true,
    );
  }

  if (typeof exit !== 'function') return;

  const delay = Number.isFinite(restartDelayMs) && restartDelayMs > 0 ? restartDelayMs : 0;
  if (delay === 0) {
    exit(1);
    return;
  }

  setTimeout(() => exit(1), delay);
}

/**
 * @param {((message: string, type: string, silent?: boolean, isPriority?: boolean) => void) | null} notify
 * @param {string} moduleName
 * @param {string} message
 * @returns {void}
 */
function notifyTimeout(notify, moduleName, message) {
  if (typeof notify !== 'function') return;

  const now = Date.now();
  const lastAt = lastTimeoutNotifyAt.get(moduleName) || 0;

  if (now - lastAt < TIMEOUT_NOTIFY_INTERVAL_MS) return;

  lastTimeoutNotifyAt.set(moduleName, now);
  notify(message, 'error');
}

/**
 * Schedules the next loop tick.
 * The tick function must itself reschedule from a `finally` block, including when setup code throws.
 *
 * @param {() => (Promise<void>|void)} again Next tick
 * @param {number} delayMs Delay before `again`. Non-finite values fall back to the idle poll interval.
 * @returns {void}
 */
function rescheduleIteration(again, delayMs) {
  const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : IDLE_INTERVAL_MS;

  setTimeout(() => {
    again();
  }, delay);
}

/**
 * Clears the process-wide restart flag. Tests use this between cases.
 * @returns {void}
 */
function clearScheduledRestart() {
  restartScheduled = false;
}

module.exports = {
  IDLE_INTERVAL_MS,
  ITERATION_TIMEOUT_MS,
  RESTART_DELAY_MS,
  MAX_ABANDONED_ITERATIONS,
  MAX_ABANDONED_LOG_ENTRIES,
  createIterationLock,
  runExclusiveIteration,
  rescheduleIteration,
  clearScheduledRestart,
};
