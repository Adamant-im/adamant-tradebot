/**
 * Makes trades to create volume
 * Places two orders in the spread when 'executeInSpread', or one order in the order book when 'executeInOrderBook'
 * Optional mm_nice_chart integration can narrow the in-spread corridor to draw a smoother chart
 * Policies (mm_Policy): MM_POLICIES_VOLUME
 * - spread | wash: Trades only in the spread. If there is no spread, the bot will not trade
 * - orderbook: Trades only in the order book. Works well when the spread and liquidity are sufficient
 * - optimal: Combines spread and orderbook. Chooses based on several parameters
 * - depth: Avoids creating trading volume. Also skips restoring Pw's range, placing cl-orders, running fund balancer, and calculating volume volatility coefficient
 * If set in the config, the bot uses two exchange accounts to prevent SELF_TRADE
 * Supports perpetual contract trading (single account only)
*/

/**
 * @module trade/mm_trader
 * @typedef {import('types/bot/general.d.js').RandomValueFunction} RandomValueFunction
 * @typedef {import('types/bot/general.d.js').RandomDeviationFunction} RandomDeviationFunction
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/priceReq.d').MmCurrentAction} MmCurrentAction
 * @typedef {import('types/bot/priceReq.d').TraderPriceRequest} TraderPriceRequest
 * @typedef {import('types/bot/checkBalanceReq.d').CheckBalanceRequest} CheckBalanceRequest
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/bot/trader.d.js').TraderRuntime} TraderRuntime
 * @typedef {import('types/bot/trader.d.js').TraderRuntimeDeps} TraderRuntimeDeps
 * @typedef {import('types/bot/trader.d.js').TraderRuntimeOverrides} TraderRuntimeOverrides
 * @typedef {import('types/bot/trader.d.js').TraderRuntimeState} TraderRuntimeState
 * @typedef {import('types/bot/trader.d.js').TraderStepInput} TraderStepInput
 * @typedef {import('types/bot/trader.d.js').TraderTradeStepResult} TraderTradeStepResult
 * @typedef {import('types/bot/trader.d.js').TraderPriceWatcher} TraderPriceWatcher
 * @typedef {import('types/bot/trader.d.js').TraderNiceChartService} TraderNiceChartService
 * @typedef {import('types/bot/trader.d.js').TraderLiquidityProvider} TraderLiquidityProvider
 * @typedef {import('types/bot/trader.d.js').TraderSbwService} TraderSbwService
 * @typedef {import('types/bot/candlestickChart.d').NiceChartCloseWindowPlan} NiceChartCloseWindowPlan
 * @typedef {import('types/bot/orderMetrics.d.js').FillsByPurpose} FillsByPurpose
 * @typedef {import('types/bot/orderMetrics.d.js').FillOrder} FillOrder
 * @typedef {import('types/bot/orderMetrics.d.js').FillsDbRecord} FillsDbRecord
 * @typedef {import('types/order-info.d').Result} OrderInfoResult
 * @typedef {import('types/bot/ordersDb.d.js').BotOrderDbRecord} BotOrderDbRecord
*/

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const db = require('../modules/DB');
const orderCollector = require('./orderCollector');
const orderUtils = require('./orderUtils');
const fillsEngine = utils.softRequire('../helpers/fillsEngine', __filename);

/**
 * Fallback when `helpers/fillsEngine.js` is omitted from a trimmed build.
 *
 * Trader keeps placing and closing orders as usual; only fill accounting is disabled:
 * no `fillsDb` records from Trader steps, no third-party/VWAP stats for purpose `t`,
 * and `/orders t full` loses fillsEngine-based attribution (order-based stats still work).
 *
 * Safe Liquidity / SS are unaffected here — they require fillsEngine in their own modules.
 * `orderUtils.updateOrders()` also skips fillsDb writes when fillsEngine is missing.
 *
 * Nothing in the trading loop throws or stops: methods are no-ops with an empty fill shape.
 */
const noopFillsEngine = {
  emptyFill() {
    return {
      partlyFilledOrders: [],
      filledOrders: [],
      buyFilledAmount: 0,
      sellFilledAmount: 0,
      buyFilledQuote: 0,
      sellFilledQuote: 0,
    };
  },
  addFill() {},
  async addFillsDbRecord() {},
};

const TraderApi = require('./trader_' + config.exchange);
const isPerpetual = Boolean(config.perpetual);

const perpetualApiModule = '../modules/perpetualApi'; // Optional: perpetualApi module exists only in perpetual builds
const perpetualApiFactory = isPerpetual ? utils.softRequire(perpetualApiModule, __filename) : undefined;

if (isPerpetual && !perpetualApiFactory) {
  throw new Error('mm_trader: config.perpetual is set but modules/perpetualApi.js is missing from this build.');
}

const traderapi = isPerpetual ?
    perpetualApiFactory() :
    TraderApi(
        config.apikey,
        config.apisecret,
        config.apipassword,
        log,
        undefined,
        undefined,
        config.exchange_socket,
        config.exchange_socket_pull,
    );

let traderapi2;
if (config.apikey2) {
  traderapi2 = TraderApi(
      config.apikey2,
      config.apisecret2,
      config.apipassword2,
      log,
      undefined,
      undefined,
      config.exchange_socket,
      config.exchange_socket_pull,
      1,
  );
  traderapi2.isSecondAccount = true;
}

// Parameters for trading in the order book
const EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MIN = 0.6; // Minimum percentage for order book execution with liquidity enabled
const EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MAX = 0.8; // Maximum percentage for order book execution with liquidity enabled
const EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MIN = 0.2; // Minimum percentage for order book execution w/o liquidity enabled
const EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MAX = 0.5; // Maximum percentage for order book execution w/o liquidity enabled
const EXECUTE_IN_ORDER_BOOK_ORDER_SIDE_REPEAT_PERCENT = 80; // Probability to repeat the same order side (buy or sell) in the next trade

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);
const readableModuleName = 'Trader';

/** @type {TraderSbwService} */
const noopTraderSbw = {
  getInitialState(overrides = {}) {
    return {
      sbwCheckCount: overrides.sbwCheckCount ?? 0,
      sbwActivityCounters: Array.isArray(overrides.sbwActivityCounters) ? [...overrides.sbwActivityCounters] : [0, 0, 0],
    };
  },
  sniperBotCheck() {},
  sniperBotActivity() {},
  resetSniperBotCounters() {},
};

log.log(`Module ${moduleName} is loaded.`);

/**
 * Builds the mutable state object used by the trader runtime.
 *
 * The state is intentionally isolated from module globals so tests can inject
 * deterministic values and parallel runtimes can coexist without sharing counters.
 *
 * @param {Partial<TraderRuntimeState>} [overrides={}] Optional state overrides for tests or probes
 * @returns {TraderRuntimeState} Initialized trader runtime state
 */
function createInitialTraderState(overrides = {}) {
  const traderSbw = utils.softRequire('../trade/mm_trader_sbw') || noopTraderSbw;
  const sbwState = traderSbw.getInitialState(overrides);

  return {
    lastNotifyBalancesTimestamp: 0,
    lastNotifyPriceTimestamp: 0,
    isPreviousIterationFinished: true,
    lastOrderSide: 'buy',
    lastClosingTradeBucketTs: undefined,
    niceChartConsecutiveFailures: 0,
    ...sbwState,
    ...overrides,
  };
}

/**
 * Creates runtime-local random helpers backed by an injected random source.
 *
 * These wrappers mirror `utils.randomValue()` and `utils.randomDeviation()`, but
 * use the runtime's own random generator instead of the global `Math.random()`.
 * This keeps production behavior unchanged while allowing deterministic tests.
 *
 * Why this exists:
 * - Repeatable tests: the same inputs produce the same branch decisions, prices,
 *   amounts, and Nice Chart deviations instead of occasionally drifting because
 *   `Math.random()` advanced differently between runs
 * - Scenario debugging: once a bad path is reproduced with a specific seed, the
 *   exact sequence can be replayed step by step
 * - Refactor safety: before/after comparisons can hold randomness constant and
 *   verify that only logic changed
 *
 * Current concrete test source:
 * - `tests/features/nice_chart.test.js` injects `random: createSeededRandom(seed)`
 * - that helper is a deterministic multiplicative linear congruential generator
 *   using `state = (state * 48271) % 0x7fffffff`
 * - runtimes built with the same seed therefore consume the same pseudo-random
 *   stream and stay reproducible across repeated test runs
 *
 * @param {() => number} random Random generator returning a float in the [0, 1) range
 * @returns {{
 *   randomValue: RandomValueFunction,
 *   randomDeviation: RandomDeviationFunction
 * }} Runtime-local random helpers compatible with `utils.randomValue()` and `utils.randomDeviation()`
 */
function createRuntimeRandomHelpers(random) {
  /** @type {RandomValueFunction} */
  const randomValue = (low, high, doRound = false) => {
    let value = random() * (high - low) + low;

    if (doRound) {
      value = Math.round(value);
    }

    return value;
  };

  /** @type {RandomDeviationFunction} */
  const randomDeviation = (number, deviation, doRound = false) => {
    const min = number - number * deviation;
    const max = number + number * deviation;

    return randomValue(min, max, doRound);
  };

  return {
    randomValue,
    randomDeviation,
  };
}

/**
 * Creates an isolated trader runtime with injectable dependencies.
 *
 * This factory is the main seam for tests and custom builds. It wires the bot's
 * static dependencies, keeps mutable iteration state together, and exposes the
 * same public surface as the production singleton exported from this module.
 *
 * @param {TraderRuntimeOverrides} [overrides={}] Optional dependency and state overrides
 * @returns {TraderRuntime} Ready-to-run trader runtime
 */
function createTraderRuntime(overrides = {}) {
  const runtimeConfig = overrides.config || config;
  const runtimeTradeParams = overrides.tradeParams || tradeParams;
  const runtimeUtils = overrides.utils || utils;
  const runtimeLog = overrides.log || log;
  const runtimeNotify = overrides.notify || notify;
  const runtimeDb = overrides.db || db;
  const runtimeOrderCollector = overrides.orderCollector || orderCollector;
  const runtimeOrderUtils = overrides.orderUtils || orderUtils;
  const runtimeFillsEngine = overrides.fillsEngine || fillsEngine || noopFillsEngine;
  const runtimeTraderapi = overrides.traderapi || traderapi;
  const runtimeTraderapi2 = overrides.traderapi2 === undefined ? traderapi2 : overrides.traderapi2;
  const runtimeIsPerpetual = Boolean(overrides.isPerpetual ?? runtimeConfig.perpetual);
  const runtimeUseSecondAccount = Boolean(runtimeTraderapi2 && !runtimeIsPerpetual);
  // Keep one RNG contract per runtime instance. Production runtimes default to
  // Math.random(), while tests can inject a seeded generator and make all random
  // branches reproducible without patching helpers/utils.js globally.
  const runtimeRandom = overrides.random || Math.random;
  // utils.randomValue()/randomDeviation() are tied to global Math.random(). When
  // a test injects `random`, rebuild the companion helpers so setSide(), setAmount(),
  // setPrice(), and Nice Chart deviations all consume the same deterministic stream.
  const runtimeRandomHelpers = overrides.random ? createRuntimeRandomHelpers(runtimeRandom) : undefined;
  const runtimeRandomValue = overrides.randomValue ||
    runtimeRandomHelpers?.randomValue || runtimeUtils.randomValue.bind(runtimeUtils);
  const runtimeRandomDeviation = overrides.randomDeviation ||
    runtimeRandomHelpers?.randomDeviation || runtimeUtils.randomDeviation.bind(runtimeUtils);
  const runtimeFormattedPair = /** @type {ParsedMarket} */ (
    overrides.formattedPair || runtimeOrderUtils.parseMarket(runtimeConfig.defaultPair)
  );
  const runtimeState = createInitialTraderState(overrides.state);

  /** @type {TraderRuntimeDeps} */
  const deps = {
    constants: overrides.constants || constants,
    utils: runtimeUtils,
    config: runtimeConfig,
    log: runtimeLog,
    notify: runtimeNotify,
    tradeParams: runtimeTradeParams,
    db: runtimeDb,
    orderCollector: runtimeOrderCollector,
    orderUtils: runtimeOrderUtils,
    fillsEngine: runtimeFillsEngine,
    traderapi: runtimeTraderapi,
    traderapi2: runtimeTraderapi2,
    isPerpetual: runtimeIsPerpetual,
    useSecondAccount: runtimeUseSecondAccount,
    random: runtimeRandom,
    randomValue: runtimeRandomValue,
    randomDeviation: runtimeRandomDeviation,
    priceWatcher: overrides.priceWatcher,
    liquidityProvider: overrides.liquidityProvider,
    traderSbw: overrides.traderSbw,
  };

  if (Object.prototype.hasOwnProperty.call(overrides, 'niceChart')) {
    deps.niceChart = overrides.niceChart;
  }

  /** @type {TraderRuntime} */
  const runtime = {
    deps,
    state: runtimeState,
    formattedPair: runtimeFormattedPair,
    moduleName,
    readableModuleName,

    /**
     * Returns the mutable state bag owned by this trader runtime.
     *
     * The returned object is the live runtime state, not a cloned snapshot, so
     * callers can inspect counters and timestamps that change between iterations.
     *
     * @returns {TraderRuntimeState} Live mutable state for this runtime instance
     */
    getState() {
      return runtimeState;
    },

    /**
     * Starts the trader loop by scheduling the first iteration.
     *
     * The loop is self-rescheduling, so this method only needs to be called once
     * for a runtime instance.
     *
     * @returns {void}
     */
    run() {
      this.iteration();
    },

    /**
     * Executes one trader-loop tick and schedules the next one.
     *
     * Algorithm:
     * 1. Compute the next randomized (or calculated closing trade) pause from current trade parameters
     * 2. Check whether MM/trader are enabled and the policy is supported
     * 3. Skip overlapping work with `isPreviousIterationFinished`
     * 4. Run one `executeMmOrder()` attempt and always release the iteration lock
     * 5. Reschedule the next tick, or fall back to a short polling delay while disabled
     * 6. Update Sniper Bot Watcher state on each iteration end to prevent stale counters and enable timely resets when the bot is inactive for a while
     *
     * @returns {Promise<void>} Resolves after the current tick is processed and the next one is scheduled
     */
    async iteration() {
      const now = Date.now();
      const regularInterval = setPause(runtime);
      const closingTradePlan = resolveNiceChartCloseTradePlan(runtime, now, regularInterval);
      const interval = closingTradePlan.interval;
      const currentTradeParams = deps.tradeParams;

      if (
        interval &&
        currentTradeParams.mm_isActive &&
        currentTradeParams.mm_isTraderActive &&
        deps.constants.MM_POLICIES_VOLUME.includes(currentTradeParams.mm_Policy)
      ) {
        if (runtimeState.isPreviousIterationFinished) {
          runtimeState.isPreviousIterationFinished = false;

          try {
            if (closingTradePlan.isClosingTrade) {
              deps.log.debug(
                  `Trader: Executing planned closing candle trade for ${runtime.formattedPair.pair} ` +
                  `(remainingMs=${closingTradePlan.remainingMs}, closeTimestamp=${closingTradePlan.closeTimestamp}).`,
              );
            }

            await this.executeMmOrder({ now, isClosingTrade: closingTradePlan.isClosingTrade });
          } finally {
            runtimeState.isPreviousIterationFinished = true;
          }
        } else {
          deps.log.warn(`Trader: Postponing iteration for ${interval} ms. Previous iteration is still in progress.`);
        }

        if (closingTradePlan.plannedClosingTs) {
          deps.log.log(
              `Trader: Next iteration scheduled for Nice Chart close candle on ${runtime.formattedPair.pair} ` +
              `(plannedClosingTs=${closingTradePlan.plannedClosingTs}, in=${interval} ms, ` +
              `closeTimestamp=${closingTradePlan.closeTimestamp}).`,
          );
        }

        setTimeout(() => this.iteration(), interval);
        return;
      }

      setTimeout(() => this.iteration(), 3000);
      resolveTraderSbw(runtime).resetSniperBotCounters(runtime);
    },

    /**
     * Evaluates one potential MM step without placing any exchange orders.
     *
     * Uses runtime.deps. `tradeParams`, `utils`, `random*`,
     * `runtime.formattedPair`, and `runtime.state.lastOrderSide` through helper calls.
     *
     * Algorithm:
     * 1. Merge `marketState` into the top-level step input
     * 2. Resolve trade side from injected input or `setSide()`
     * 3. Resolve order amount from injected input or `setAmount()`
     * 4. Call `setPrice()` to decide price, MM action, and possible amount reduction
     * 5. Return a normalized step result with skip diagnostics for callers
     *
     * @param {TraderStepInput} [stepInput={}] Optional injected market snapshot and dependency overrides
     * @returns {Promise<TraderTradeStepResult>} Resolved trade-side, amount, price decision, and skip diagnostics
     */
    async evaluateTradeStep(stepInput = {}) {
      const resolvedStepInput = {
        ...(stepInput.marketState || {}),
        ...stepInput,
      };

      const side = resolvedStepInput.side === 'buy' || resolvedStepInput.side === 'sell' ?
        resolvedStepInput.side :
        setSide(runtime);
      const initialCoin1Amount = utils.isPositiveNumber(resolvedStepInput.coin1Amount) ?
        resolvedStepInput.coin1Amount :
        setAmount(runtime);
      const priceReq = await setPrice(runtime, side, initialCoin1Amount, resolvedStepInput);
      const finalCoin1Amount = priceReq.coin1Amount || initialCoin1Amount;

      return {
        side,
        coin1Amount: finalCoin1Amount,
        isClosingTrade: Boolean(resolvedStepInput.isClosingTrade),
        skipReason: priceReq.skipReason || (!priceReq.price ? (priceReq.message || 'do_not_execute') : undefined),
        ...priceReq,
      };
    },

    /**
     * Evaluates and executes one MM step, including balance checks, order placement,
     * post-placement reconciliation, fill persistence, and leftover cleanup.
     *
     * Uses `runtime.formattedPair`, runtime.deps. `config`, `notify`,
     * `log`, `traderapi`, `traderapi2`, `db`, `orderCollector`, `fillsEngine`,
     * and mutable notification/order-side fields from `runtime.state`.
     *
     * Algorithm:
     * 1. Run `evaluateTradeStep()` to get side, amount, price, and MM action
     * 2. Abort early on skipped steps or invalid order parameters
     * 3. Check balances for the chosen action and account layout
     * 4. Place one or two exchange orders depending on the selected MM action
     * 5. Read order details, persist fills/orders, update runtime state, and cancel leftovers
     *
     * @param {TraderStepInput} [stepInput={}] Optional injected market snapshot and dependency overrides
     * @returns {Promise<void>} Resolves after the attempt finishes or is skipped
     */
    async executeMmOrder(stepInput = {}) {
      const { pair, coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = runtimeFormattedPair;
      const {
        config: runtimeConfigLocal,
        notify: runtimeNotifyLocal,
        log: runtimeLogLocal,
      } = deps;

      try {
        const priceReq = await this.evaluateTradeStep(stepInput);
        // Reuse the same resolved Nice Chart instance for fill attribution that
        // was used while evaluating the step. Tests may inject a per-call stub,
        // and custom builds may omit the module entirely.
        const niceChart = resolveNiceChart(runtime, stepInput);

        const {
          side,
          price,
          coin1Amount,
          message: priceError,
          mmCurrentAction,
          isClosingTrade,
        } = /** @type {TraderTradeStepResult & { price: number }} */ (priceReq);

        if (!price) {
          if (priceError) {
            if (Date.now() - runtimeState.lastNotifyPriceTimestamp > deps.constants.HOUR) {
              runtimeNotifyLocal(`${runtimeConfigLocal.notifyName}: ${priceReq.message}`, 'warn');
              runtimeState.lastNotifyPriceTimestamp = Date.now();
            } else {
              runtimeLogLocal.log(`Trader: ${priceReq.message}`);
            }
          }

          return;
        }

        const coin2Amount = coin1Amount * price;
        const orderParamsString = `side=${side}, pair=${pair}, price=${price}, mmCurrentAction=${mmCurrentAction}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
        if (!side || !price || !coin1Amount || !coin2Amount) {
          runtimeLogLocal.warn(`Trader: Unable to run t-order with params: ${orderParamsString}.`);
          return;
        }

        if (isClosingTrade) {
          runtimeState.lastClosingTradeBucketTs = getNiceChartBaseBucketTs(getStepNow(stepInput));
        }

        runtimeLogLocal.log(`Trader: Placing the t-order with params ${orderParamsString}…`);

        const balances = await isEnoughCoins(runtime, coin1, coin2, coin1Amount, coin2Amount, side, mmCurrentAction);
        if (!balances.result) {
          if (balances.message) {
            if (Date.now() - runtimeState.lastNotifyBalancesTimestamp > deps.constants.HOUR) {
              runtimeNotifyLocal(`${runtimeConfigLocal.notifyName}: ${balances.message}`, 'warn', runtimeConfigLocal.silent_mode);
              runtimeState.lastNotifyBalancesTimestamp = Date.now();
            } else {
              runtimeLogLocal.log(`Trader: ${balances.message}`);
            }
          }

          return;
        }

        let output = '';
        let order1; let order2;
        let order1Details; let order2Details;
        let order1Status; let order2Status;

        const makerApi = deps.traderapi;
        const takerApi = deps.useSecondAccount ? deps.traderapi2 : deps.traderapi;
        const makerOrderSide = deps.orderUtils.crossSide(side);

        /**
         * Stores a synthetic fill record for the part of a trader step that was actually executed.
         * Computes the sniper bot filled amounts (what was actually executed from our perspective),
         * decides whether it was partial/full fill, then writes the fillsDb record via fillsEngine.
         *
         * Uses closed-over `price`, `coin1Amount`, `coin2Amount`, `makerApi`, `takerApi`,
         * and `deps.fillsEngine` from the current `executeMmOrder()` call.
         *
         * For executeInOrderBook there are two accounting modes:
         * - With Nice Chart attribution available, persist only the third-party
         *   slice that the visible match plan says was actually reached.
         * - Without Nice Chart, keep the legacy behavior and persist the full
         *   exchange-reported execution, because Trader then has no ownership
         *   breakdown for the matched book levels.
         *
         * @param {OrderInfoResult} orderDetails Exchange order details used to derive executed amounts (e.g., order2Details)
         * @param {BotOrderDbRecord} order Trader DB order record that owns the fill (pair/purpose/etc taken from it)
         * @param {boolean} [takerOrderFilled=false] Whether the taker leg, rather than the maker leg, is the filled one in an in-spread scenario
         * @returns {Promise<void>} Resolves after the fill fragment is persisted into fillsDb
         */
        async function addFillsDbRecord(orderDetails, order, takerOrderFilled = false) {
          let coin1AmountFilled; let coin2AmountFilled;
          let api;

          const volumeExecuted = orderDetails.volumeExecuted || orderDetails.amountExecuted * price;

          if (order.mmOrderAction === 'executeInOrderBook') {
            const attributedFill = typeof niceChart?.attributeThirdPartyFillFromMatchPlan === 'function' ?
              niceChart.attributeThirdPartyFillFromMatchPlan({
                executedAmount: Number(orderDetails.amountExecuted) || 0,
                volumeExecuted,
                price,
                priceReq,
              }) :
              {
                // Legacy fallback for runs without Nice Chart: we know only the
                // total exchange execution, not its own-vs-third-party split.
                coin1AmountFilled: Number(orderDetails.amountExecuted) || 0,
                coin2AmountFilled: volumeExecuted,
              };

            coin1AmountFilled = Math.max(Number(attributedFill?.coin1AmountFilled) || 0, 0);
            coin2AmountFilled = Math.max(Number(attributedFill?.coin2AmountFilled) || 0, 0);

            if (!utils.isPositiveNumber(coin1AmountFilled)) {
              return;
            }
            api = takerApi; // executeInOrderBook orders are always taker orders
          } else {
            // Calculate Sniper bot amounts = the delta between what we intended and what was executed.
            // In-spread MM places both legs itself, so the external fill is the part that did not
            // match against our own cross-order. That remainder is what we persist as market fill.
            const sniperBotCoin1Amount = coin1Amount - orderDetails.amountExecuted;
            const sniperBotCoin2Amount = coin2Amount - volumeExecuted;

            coin1AmountFilled = sniperBotCoin1Amount;
            coin2AmountFilled = sniperBotCoin2Amount;
            api = takerOrderFilled ? takerApi : makerApi; // Sniper bot filled either taker or maker order
          }

          // For executeInOrderBook, classify the actual taker order, not the
          // third-party-only fragment persisted for VWAP. A fully matched taker
          // may contain a smaller external slice after own matches are removed.
          const isFullyMatched = order.mmOrderAction === 'executeInOrderBook' ?
            orderDetails.status === 'filled' :
            coin1AmountFilled >= coin1Amount;
          const orderArrayType = isFullyMatched ? 'filledOrders' : 'partlyFilledOrders';
          const fills = deps.fillsEngine.emptyFill();

          // Trader has already inspected exchange order details, so mark the
          // fragment confirmed and let processFills skip verifyOrderFilled().
          deps.fillsEngine.addFill(fills, order, orderArrayType, coin1AmountFilled, coin2AmountFilled, true, takerOrderFilled);

          // Persists fills into fillsDb
          await deps.fillsEngine.addFillsDbRecord({
            purpose: 't',
            callerModuleName: moduleName,
            noCache: true,
          }, fills, api);
        }

        // Place orders based on mmCurrentAction

        if (mmCurrentAction === 'executeInSpread') {
          // First, (maker) we place crossSide-order using first account

          order1 = deps.isPerpetual ?
            await makerApi.placeOrder(makerOrderSide, pair, price, coin1Amount, 'limit') :
            await makerApi.placeOrder(makerOrderSide, pair, price, coin1Amount, 1, null);

          if (order1?.orderId) {
            const { ordersDb } = deps.db;
            const niceChartRange = /** @type {any} */ (priceReq)?.niceChartRange;
            const isExecutedWithNiceChart = Boolean(
                /** @type {any} */ (priceReq)?.isExecutedWithNiceChart || niceChartRange?.isValid,
            );

            /** @type {BotOrderDbRecord} */
            const order = new ordersDb({
              _id: order1.orderId,
              crossOrderId: null,
              date: deps.utils.unixTimeStampMs(),
              purpose: 't', // Trading
              mmOrderAction: mmCurrentAction, // executeInSpread or executeInOrderBook
              side: makerOrderSide,
              targetSide: side,
              exchange: runtimeConfigLocal.exchange,
              pair,
              coin1,
              coin2,
              price,
              coin1Amount,
              coin2Amount,
              isExecutedWithNiceChart,
              niceChartRange,
              coin1AmountFilled: undefined,
              coin2AmountFilled: undefined,
              coin1AmountLeft: coin1Amount,
              coin2AmountLeft: coin2Amount,
              LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
              isProcessed: false,
              isExecuted: false,
              isCancelled: false,
              orderMakerAccount: deps.useSecondAccount ? 'first' : '',
              orderTakerAccount: deps.useSecondAccount ? 'second' : '',
              isSecondAccountOrder: false,
            });

            // Last, (taker) we place side-order (using second account in case of 2-keys trading)

            order2 = deps.isPerpetual ?
              await takerApi.placeOrder(side, pair, price, coin1Amount, 'limit') :
              await takerApi.placeOrder(side, pair, price, coin1Amount, 1, null);

            if (order2?.orderId) {
              output = `${side} ${coin1Amount.toFixed(coin1Decimals)} ${coin1} for ${coin2Amount.toFixed(coin2DecimalsForStable)} ${coin2} at ${/** @type {number} */ (price).toFixed(coin2Decimals)} ${coin2}`;
              runtimeLogLocal.info(`Trader: Successfully executed t-order${deps.useSecondAccount ? ' (using two accounts)' : ''} to ${output}. Action: executeInSpread.`);

              runtimeState.lastOrderSide = side;

              order.update({
                isProcessed: true,
                crossOrderId: order2.orderId,
              });

              // Pause to allow the exchange matching engine to process orders.
              // Note: Unfilled orders remain open during this pause (they are cancelled below if not filled).
              // This theoretically allows third-party bots to match these unfilled orders.

              const pauseMs = deps.traderapi.features().apiProcessingDelayMs ?? deps.constants.DEFAULT_API_PROCESSING_DELAY_MS;
              await deps.utils.pauseAsync(pauseMs, `Trader: ${pauseMs} msec pause to ensure the ${runtimeConfigLocal.exchangeName}'s matching engine processed the orders…`);

              // Check t-orders status to determine if both orders are filled or have other states; Sniper Bot Watcher (sbw) logic

              resolveTraderSbw(runtime).sniperBotCheck(runtime);

              order1Details = makerApi.getOrderDetails ? await makerApi.getOrderDetails(order1.orderId, order.pair) : undefined;
              order2Details = takerApi.getOrderDetails ? await takerApi.getOrderDetails(order2.orderId, order.pair) : undefined;

              order1Status = order1Details?.status;
              order2Status = order2Details?.status;

              const orderStatusesInfo = `The maker t-order status is ${order1Status}, and the taker t-order is ${order2Status}`;

              if (!order1Status || !order2Status) {
                if (!deps.traderapi.getOrderDetails) {
                  runtimeLogLocal.log(`Trader: Order detail retrieval is not implemented for ${runtimeConfigLocal.exchangeName}. Assuming both maker and taker executeInSpread t-orders are self-filled.`);
                } else {
                  runtimeLogLocal.log(`Trader: Unable to retrieve maker and/or taker order details due to ${runtimeConfigLocal.exchangeName} API throttling or temporary fault. ${orderStatusesInfo}. Assuming both executeInSpread t-orders are self-filled.`);
                }

                order.update({
                  coin1AmountFilled: undefined,
                  coin2AmountFilled: undefined,
                  isExecuted: true, // We _assume_ the order if fully filled
                });
              } else if (order1Status === 'filled' && order2Status === 'filled') {
                runtimeLogLocal.info('Trader: Both maker and taker executeInSpread t-orders are self-filled.');

                order.update({
                  coin1AmountFilled: coin1Amount,
                  coin2AmountFilled: coin2Amount,
                  coin1AmountLeft: 0,
                  coin2AmountLeft: 0,
                  isExecuted: true,
                });
              } else if (order1Status === 'filled' && ['new', 'part_filled'].includes(order2Status)) {
                // Scenario1: After maker order is placed in spread, a third party bot quickly takes it, and the taker order remains unfilled or partially filled
                resolveTraderSbw(runtime).sniperBotActivity(runtime, 1, order2Details, coin1Amount);
                await addFillsDbRecord(order2Details, order, false); // Maker order is partially or fully filled by a sniper bot

                order.update({
                  coin1AmountFilled: order2Details.amountExecuted, // Self-filled amount, excluding sniper bot fills
                  coin2AmountFilled: order2Details.volumeExecuted,
                  isExecuted: false, // Not fully executed
                });
              } else if (order2Status === 'filled' && ['new', 'part_filled'].includes(order1Status)) {
                // Scenario2: After a maker order is placed, a third party quickly places another order just before it, and the maker order remains unfilled or partially filled
                resolveTraderSbw(runtime).sniperBotActivity(runtime, 2, order1Details, coin1Amount);
                await addFillsDbRecord(order1Details, order, true); // Taker order is partially or fully filled by a sniper bot

                order.update({
                  coin1AmountFilled: order1Details.amountExecuted, // Self-filled amount, excluding sniper bot fills
                  coin2AmountFilled: order1Details.volumeExecuted,
                  isExecuted: false, // Not fully executed
                });
              } else if (order1Status === 'cancelled') {
                runtimeLogLocal.warn(`Trader: The maker t-order is cancelled. It may be that the ${runtimeConfigLocal.exchangeName} exchange prohibits self-trade and the t-order matched with own ob-order. API's selfTradeProhibited: ${deps.traderapi.features().selfTradeProhibited}.`);

                order.update({
                  coin1AmountFilled: 0, // Actually it may be fully or partially executed by third-party traders or sniper bots
                  coin2AmountFilled: 0,
                  isExecuted: false,
                });
              } else if (order2Status === 'cancelled') {
                runtimeLogLocal.warn(`Trader: The taker t-order is cancelled. It may be that the ${runtimeConfigLocal.exchangeName} exchange prohibits self-trade. API's selfTradeProhibited: ${deps.traderapi.features().selfTradeProhibited}.`);

                order.update({
                  coin1AmountFilled: 0, // Actually it may be fully or partially executed by third-party traders or sniper bots
                  coin2AmountFilled: 0,
                  isExecuted: false,
                });
              } else {
                // Maker or taker order in 'unknown' status
                runtimeLogLocal.warn(`Trader: Unexpected scenario while placing executeInSpread t-order. ${orderStatusesInfo}.`);

                order.update({
                  coin1AmountFilled: undefined, // Actually it may be fully or partially executed by third-party traders or sniper bots
                  coin2AmountFilled: undefined,
                  isExecuted: false, // Not fully executed
                });
              }

              await order.save();
              // Cancel maker and taker orders if they remain in new or partially filled state

              if ([undefined, 'unknown', 'new', 'part_filled'].includes(order1Status)) {
                const reasonToClose = `Cancelling order1 (maker) t-order with status '${order1Status}' while doing executeInSpread t-order`;
                await deps.orderCollector.clearOrderById(
                    order, order.pair, makerOrderSide, readableModuleName,
                    reasonToClose, undefined, makerApi,
                );
              }

              if ([undefined, 'unknown', 'new', 'part_filled'].includes(order2Status)) {
                const reasonToClose = `Cancelling order2 (taker) t-order with status '${order2Status}' while doing executeInSpread t-order`;
                await deps.orderCollector.clearOrderById(
                    order2.orderId, order.pair, side, readableModuleName,
                    reasonToClose, undefined, takerApi,
                );
              }
            } else { // if order2-taker was not placed
              runtimeLogLocal.warn(`Trader: Unable to execute taker cross-order${deps.useSecondAccount ? ' (using second account)' : ''} for t-order with params: id=${order1.orderId}, ${orderParamsString}. Action: executeInSpread.`);

              await order.save();

              const reasonToClose = 'Cancelling order1 (maker) because order2 (maker) was not placed while doing executeInSpread t-order';
              await deps.orderCollector.clearOrderById(
                  order, order.pair, makerOrderSide, readableModuleName,
                  reasonToClose, undefined, deps.traderapi,
              );
            }
          } else { // if order1-maker was not placed
            runtimeLogLocal.warn(`Trader: Unable to execute maker t-order${deps.useSecondAccount ? ' (using first account)' : ''} with params: ${orderParamsString}. Action: executeInSpread. No order id returned.`);
          }

        } else if (mmCurrentAction === 'executeInOrderBook') {

          // First and last, (taker) we place side-order (using second account in case of 2-keys trading)

          order1 = deps.isPerpetual ?
            await takerApi.placeOrder(side, pair, price, coin1Amount, 'limit') :
            await takerApi.placeOrder(side, pair, price, coin1Amount, 1, null);

          if (order1?.orderId) {
            const { ordersDb } = deps.db;
            const niceChartRange = /** @type {any} */ (priceReq)?.niceChartRange;
            const isExecutedWithNiceChart = Boolean(
                /** @type {any} */ (priceReq)?.isExecutedWithNiceChart || niceChartRange?.isValid,
            );

            /** @type {BotOrderDbRecord} */
            const order = new ordersDb({
              _id: order1.orderId,
              crossOrderId: null,
              date: deps.utils.unixTimeStampMs(),
              purpose: 't', // Trader
              mmOrderAction: mmCurrentAction, // executeInSpread or executeInOrderBook
              side,
              exchange: runtimeConfigLocal.exchange,
              // targetSide: side,
              pair,
              coin1,
              coin2,
              price,
              coin1Amount,
              coin2Amount,
              isExecutedWithNiceChart,
              niceChartRange,
              coin1AmountFilled: undefined,
              coin2AmountFilled: undefined,
              coin1AmountLeft: coin1Amount,
              coin2AmountLeft: coin2Amount,
              LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
              isProcessed: true,
              isExecuted: undefined,
              isCancelled: false,
              isSecondAccountOrder: Boolean(deps.useSecondAccount),
            });

            output = `${side} ${coin1Amount.toFixed(coin1Decimals)} ${coin1} for ${coin2Amount.toFixed(coin2DecimalsForStable)} ${coin2} at ${price.toFixed(coin2Decimals)} ${coin2}`;
            runtimeLogLocal.info(`Trader: Successfully executed t-order${deps.useSecondAccount ? ' (using two accounts)' : ''} to ${output}. Action: executeInOrderBook.`);

            runtimeState.lastOrderSide = side;

            // Pause to allow the exchange matching engine to process the order.
            // Note: If order is not filled, it remains open during this pause (cancelled below if not filled).
            // This theoretically allows third-party bots to match this unfilled order.

            const pauseMs = takerApi.features().apiProcessingDelayMs ?? deps.constants.DEFAULT_API_PROCESSING_DELAY_MS;
            await deps.utils.pauseAsync(pauseMs, `Trader: ${pauseMs} msec pause to ensure the ${runtimeConfigLocal.exchangeName}'s matching engine processed the order…`);

            // Check t-order status to determine if the order is filled or in another state.

            order1Details = takerApi.getOrderDetails ? await takerApi.getOrderDetails(order1.orderId, order.pair) : undefined;
            order1Status = order1Details?.status;

            if (!order1Status) {
              if (!deps.traderapi.getOrderDetails) {
                runtimeLogLocal.log(`Trader: Order detail retrieval is not implemented for ${runtimeConfigLocal.exchangeName}. Assuming the taker executeInOrderBook t-order is filled.`);
              } else {
                runtimeLogLocal.log(`Trader: Unable to retrieve executeInOrderBook taker t-order details due to ${runtimeConfigLocal.exchangeName} API throttling or temporary fault. Assuming it is filled.`);
              }

              order.update({
                coin1AmountFilled: undefined,
                coin2AmountFilled: undefined,
                isExecuted: true, // We _assume_ the order if fully filled
              });
            } else if (order1Status === 'filled') {
              runtimeLogLocal.info('Trader: The taker executeInOrderBook t-order is filled.');

              await addFillsDbRecord(order1Details, order);

              order.update({
                coin1AmountFilled: coin1Amount, // Amount matched with both self-orders and third-party orders in the order book (full match/fill)
                coin2AmountFilled: coin2Amount,
                isExecuted: true,
              });
            } else if (['new', 'part_filled'].includes(order1Status)) {
              const fillPercent = (order1Details.amountExecuted / coin1Amount * 100).toFixed(2);
              // SBW counters apply only to executeInSpread scenarios 1/2 (see mm_trader_sbw.js).
              // When buildTradeDecision set isOrderFilled=false, an open or part_filled taker is expected:
              // it matched visible book liquidity and may remain resting in the order book.
              const expectedOrderFilled = priceReq.isOrderFilled !== false;

              if (expectedOrderFilled) {
                runtimeLogLocal.warn(`Trader: The taker executeInOrderBook t-order status is ${order1Status} (${fillPercent}% filled). It may be the third-party bot intervention.`);
              } else {
                runtimeLogLocal.info(`Trader: The taker executeInOrderBook t-order status is ${order1Status} (${fillPercent}% filled). This matches the planned executeInOrderBook path where the order may remain in the order book after matching visible liquidity.`);
              }

              await addFillsDbRecord(order1Details, order);

              order.update({
                coin1AmountFilled: order1Details.amountExecuted, // Amount matched with both self-orders and third-party orders in the order book (partial match/fill)
                coin2AmountFilled: order1Details.volumeExecuted,
                isExecuted: false, // Not fully executed
              });
            } else if (order1Status === 'cancelled') {
              runtimeLogLocal.warn(`Trader: The taker executeInOrderBook t-order is cancelled. It may be that the ${runtimeConfigLocal.exchangeName} exchange prohibits self-trade and the t-order matched with own ob-order. API's selfTradeProhibited: ${takerApi.features().selfTradeProhibited}.`);

              order.update({
                coin1AmountFilled: 0, // Actually it may be partially matched with third-party orders in the order book
                coin2AmountFilled: 0,
                isExecuted: false, // Not executed
              });
            } else {
              // 'unknown' status
              runtimeLogLocal.warn(`Trader: Unexpected scenario while placing the taker executeInOrderBook t-order. Its status is ${order1Status}.`);

              order.update({
                coin1AmountFilled: undefined, // Actually it may be fully or partially matched with both self-orders third-party orders in the order book
                coin2AmountFilled: undefined,
                isExecuted: false, // Not fully executed
              });
            }

            await order.save();

            // Maintain tight spread after executeInOrderBook order.
            // This restores highestBid and lowestAsk to prevent significant price movement.
            const sm = deps.utils.softRequire('../trade/mm_spread_maintainer');
            sm?.maintainSpreadAfterPriceChange(side, undefined, 'Trader', undefined, priceReq);

            // Cancel t-order if it remains in open or partially filled state

            if ([undefined, 'unknown', 'new', 'part_filled'].includes(order1Status)) {
              const reasonToClose = `Cancelling order1 (taker) order with status '${order1Status}' while doing executeInOrderBook t-order`;
              await deps.orderCollector.clearOrderById(
                  order, order.pair, order.side, readableModuleName,
                  reasonToClose, undefined, takerApi,
              );
            }
          } else { // if order1
            runtimeLogLocal.warn(`Trader: Unable to execute t-order${deps.useSecondAccount ? ' (using second account)' : ''} with params: ${orderParamsString}. Action: executeInOrderBook. No order id returned.`);
          }

        }
      } catch (e) {
        deps.log.error(`Error in executeMmOrder() of ${moduleName} module: ${e}`);
      }
    },
  };

  return runtime;
}

const productionRuntime = createTraderRuntime();

module.exports = productionRuntime;
module.exports.createTraderRuntime = createTraderRuntime;
module.exports.createInitialTraderState = createInitialTraderState;

/**
 * Resolves the logical "current time" for a calculation step.
 *
 * Tests may inject a synthetic `now` value to make Nice Chart and trade-history
 * calculations deterministic.
 *
 * @param {TraderStepInput | undefined} stepInput Optional trade-step input payload
 * @returns {number} Current timestamp in milliseconds
 */
function getStepNow(stepInput) {
  return Number.isFinite(stepInput?.now) ? stepInput.now : Date.now();
}

/**
 * Floors a timestamp to the Nice Chart base candle bucket.
 *
 * @param {number} timestamp Timestamp in milliseconds
 * @returns {number | undefined} Base candle open timestamp or `undefined` for invalid input
 */
function getNiceChartBaseBucketTs(timestamp) {
  const timeframeMs = constants.NICE_CHART_BASE_TIMEFRAME_MS;
  if (!Number.isFinite(timestamp) || !Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return undefined;
  }

  return Math.floor(timestamp / timeframeMs) * timeframeMs;
}

/**
 * Resolves an eager dependency object or calls a lazy factory.
 *
 * @template T
 * @param {T | (() => T)} source Dependency instance or lazy getter
 * @returns {T} Resolved dependency
 */
function resolveRuntimeDependency(source) {
  if (typeof source === 'function') {
    return /** @type {() => T} */ (/** @type {unknown} */ (source))();
  }

  return /** @type {T} */ (source);
}

/**
 * Reads how many consecutive Nice Chart failures should be skipped before
 * Trader falls back to its local price logic.
 *
 * @param {object} runtimeConfig Runtime config
 * @returns {number} Failure count threshold
 */
function getNiceChartFailedRequestsBeforeFallback(runtimeConfig) {
  const configured = Number(runtimeConfig?.nice_chart?.failedRequestsBeforeFallback);
  if (!Number.isFinite(configured) || configured < 0) {
    return 3;
  }

  return Math.floor(configured);
}

/**
 * Applies the shared Nice Chart failure policy: skip until the configured
 * threshold, then let Trader continue with local non-Nice-Chart price logic.
 *
 * @param {object} params Failure handling parameters
 * @param {TraderRuntime} params.runtime Trader runtime
 * @param {string} params.pair Market pair
 * @param {string} params.orderInfo Human-readable order label
 * @param {string} params.reason Machine-readable failure reason
 * @param {number} params.bidPrice Current bid-side corridor edge
 * @param {number} params.askPrice Current ask-side corridor edge
 * @param {number} params.spread Current spread
 * @param {number} params.spreadUnits Current spread in precision units
 * @param {number} params.precision Price precision
 * @param {object} params.diagnostics Existing Trader diagnostics
 * @param {object} [params.niceChartDiagnostics] Optional Nice Chart diagnostics
 * @param {Error | unknown} [params.error] Optional thrown error
 * @returns {TraderPriceRequest | undefined} Skip result before threshold, or `undefined` to fall back locally
 */
function handleNiceChartFailure(params) {
  const {
    runtime,
    pair,
    orderInfo,
    reason,
    bidPrice,
    askPrice,
    spread,
    spreadUnits,
    precision,
    diagnostics,
    niceChartDiagnostics,
    error,
  } = params;
  runtime.state.niceChartConsecutiveFailures = (runtime.state.niceChartConsecutiveFailures || 0) + 1;

  const failedRequestsBeforeFallback = getNiceChartFailedRequestsBeforeFallback(runtime.deps.config);
  const failureDiagnostics = {
    reason,
    consecutiveFailures: runtime.state.niceChartConsecutiveFailures,
    failedRequestsBeforeFallback,
  };
  const errorSuffix = error ? ` ${error}` : '';

  if (runtime.state.niceChartConsecutiveFailures < failedRequestsBeforeFallback) {
    const message = `Refusing to place ${orderInfo}. Nice Chart failed for ${pair} ` +
      `(${reason}, consecutiveFailures=${runtime.state.niceChartConsecutiveFailures}/${failedRequestsBeforeFallback}).`;
    runtime.deps.log.warn(`Trader: ${message}${errorSuffix}`);

    return {
      price: false,
      message,
      skipReason: reason,
      bidPrice,
      askPrice,
      spread,
      spreadUnits,
      precision,
      diagnostics: {
        ...diagnostics,
        niceChart: niceChartDiagnostics,
        niceChartFailure: failureDiagnostics,
      },
    };
  }

  runtime.deps.log.warn(
      `Trader: Nice Chart failed for ${pair} (${reason}) ` +
      `${runtime.state.niceChartConsecutiveFailures} time(s) in a row. Falling back to local price logic.${errorSuffix}`,
  );

  return undefined;
}

/**
 * Resolves the Price Watcher dependency from step input, runtime overrides, or the real module.
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses `runtime.deps.priceWatcher`, optional overrides in `runtime.deps`, and `runtime.deps.utils.softRequire()` fallback path.
 * @param {TraderStepInput} [stepInput={}] Per-call dependency overrides
 * @returns {TraderPriceWatcher | any} Resolved Price Watcher module instance
 */
function resolvePriceWatcher(runtime, stepInput = {}) {
  return resolveRuntimeDependency(stepInput.priceWatcher || runtime.deps.priceWatcher || require('./mm_price_watcher'));
}

/**
 * Resolves the optional Nice Chart service.
 *
 * Explicit `null` / `undefined` overrides disable the optional module completely.
 * When the module is omitted from a custom build, Trader keeps the decision logic locally.
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses overrides first and `softRequire()` fallback for optional builds.
 * @param {TraderStepInput} [stepInput={}] Per-call dependency overrides
 * @returns {TraderNiceChartService | undefined | any} Resolved Nice Chart service or `undefined`
 */
function resolveNiceChart(runtime, stepInput = {}) {
  if (runtime.deps.config?.nice_chart?.enabled === false) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(stepInput, 'niceChart')) {
    return resolveRuntimeDependency(stepInput.niceChart);
  }

  if (Object.prototype.hasOwnProperty.call(runtime.deps, 'niceChart')) {
    return resolveRuntimeDependency(runtime.deps.niceChart);
  }

  return resolveRuntimeDependency(runtime.deps.utils.softRequire('../trade/mm_nice_chart'));
}

/**
 * Delegates close-window planning to the optional Nice Chart module.
 *
 * When Nice Chart is disabled or omitted from a custom build, Trader keeps its
 * regular loop interval and does not mark the next iteration as a closing trade.
 *
 * @param {TraderRuntime} runtime Trader runtime
 * @param {number} now Current timestamp in milliseconds
 * @param {number} regularInterval Randomized interval chosen for the normal loop
 * @returns {NiceChartCloseWindowPlan} Close-window plan or regular fallback
 */
function resolveNiceChartCloseTradePlan(runtime, now, regularInterval) {
  const niceChart = resolveNiceChart(runtime);
  if (!niceChart?.getNextPrice || typeof niceChart.planClosingTradeIteration !== 'function') {
    return { interval: regularInterval, isClosingTrade: false };
  }

  return niceChart.planClosingTradeIteration(runtime, now, regularInterval);
}

/**
 * Resolves the Liquidity Provider dependency from step input, runtime overrides, or the real module.
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses `runtime.deps.liquidityProvider` override and falls back to the real liquidity provider module.
 * @param {TraderStepInput} [stepInput={}] Per-call dependency overrides
 * @returns {TraderLiquidityProvider | any} Resolved Liquidity Provider module instance
 */
function resolveLiquidityProvider(runtime, stepInput = {}) {
  return resolveRuntimeDependency(stepInput.liquidityProvider || runtime.deps.liquidityProvider || require('./mm_liquidity_provider'));
}

/**
 * Resolves the optional Sniper Bot Watcher helper module.
 *
 * When the module is omitted from a custom build, mm_trader falls back to no-op
 * handlers and keeps its runtime state shape intact.
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses runtime.deps.traderSbw override and runtime.deps.utils.softRequire fallback
 * @returns {TraderSbwService} Resolved SBW helper module or a no-op fallback
 */
function resolveTraderSbw(runtime) {
  return resolveRuntimeDependency(runtime.deps.traderSbw) || runtime.deps.utils.softRequire('../trade/mm_trader_sbw') || noopTraderSbw;
}

/**
 * Determines order side (buy or sell) based on trading policy and fund balance.
 *
 * Decision logic:
 * - If fund balancer (2-key trading) is active and funds are balanced, alternates buy and sell orders for `orderbook` policy
 * - Otherwise, uses probabilistic selection based on mm_buyPercent parameter
 * - Fund balancer (when active) adjusts mm_buyPercent to maintain balance between two trading accounts
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses runtime.deps. `tradeParams`, `random`, `orderUtils`, `traderapi2`, and `runtime.state.lastOrderSide`.
 * @returns {'buy' | 'sell'} The selected order side
 */
function setSide(runtime) {
  const { tradeParams, log, orderUtils, random } = runtime.deps;
  const { lastOrderSide } = runtime.state;
  let side; let sideMessage;

  const isFundBalancerActive = runtime.deps.traderapi2 && tradeParams.mm_isFundBalancerActive;
  const BALANCE_PERCENT_THRESHOLD = 15; // If mm_buyPercent is within [35..65%], consider funds already balanced between two trading accounts
  const isFundsBalanced = !isFundBalancerActive || Math.abs(tradeParams.mm_buyPercent * 100 - 50) < BALANCE_PERCENT_THRESHOLD;

  if (tradeParams.mm_Policy === 'orderbook' && isFundsBalanced) {
    side = random() > EXECUTE_IN_ORDER_BOOK_ORDER_SIDE_REPEAT_PERCENT / 100 ?
        orderUtils.crossSide(/** @type {'buy' | 'sell'} */ (lastOrderSide)) :
        lastOrderSide;

    sideMessage = `Trader: Setting trade side to '${side}' in favour of in-orderbook trading.`;

    if (isFundBalancerActive) {
      sideMessage += ` Funds are balanced between accounts (mm_buyPercent set by Fund balancer: ${tradeParams.mm_buyPercent}).`;
    } else {
      sideMessage += ' Fund balancer is disabled.';
    }
  } else {
    side = random() > tradeParams.mm_buyPercent ? 'sell' : 'buy'; // Adjusted by fund balancer if active
    sideMessage = `Trader: Setting trade side to '${side}'`;

    if (isFundBalancerActive) {
      sideMessage += ` to balance funds between accounts (mm_buyPercent set by Fund balancer: ${tradeParams.mm_buyPercent}).`;
    } else {
      sideMessage += ` considering mm_buyPercent: ${tradeParams.mm_buyPercent}. Fund balancer is disabled.`;
    }
  }

  log.log(sideMessage);

  return /** @type {'buy' | 'sell'} */ (side);
}

/**
 * Validates sufficient balance for trade execution across single or dual accounts.
 *
 * More comprehensive than orderUtils.isEnoughCoins() because it considers:
 * - The specific trade action (executeInSpread vs executeInOrderBook)
 * - Two-account trading and account assignment (maker on first, taker on second)
 * - Both spot and perpetual trading
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses runtime.deps. `orderUtils`, `utils`, `log`, `traderapi2`, `useSecondAccount`, `isPerpetual`, and `runtime.formattedPair`.
 * @param {string} coin1 Base coin (e.g., 'BTC' from config.coin1)
 * @param {string} coin2 Quote coin (e.g., 'USDT' from config.coin2)
 * @param {number} base Order quantity in base coin
 * @param {number} quote Order quantity in quote coin
 * @param {'buy' | 'sell'} side Trade side. In spread orders: 'buy' means buyer is the taker.
 * @param {MmCurrentAction} mmCurrentAction Trade action selected for the current MM step
 * @returns {Promise<CheckBalanceRequest>}
 *   result: True if sufficient funds are available to execute the trade
 *   message: Error description if result is false
 */
async function isEnoughCoins(runtime, coin1, coin2, base, quote, side, mmCurrentAction) {
  const { orderUtils, log, utils, traderapi2, useSecondAccount, isPerpetual } = runtime.deps;
  const formattedPair = runtime.formattedPair;
  const { coin1Decimals, coin2Decimals } = formattedPair;

  const balances = /** @type {AssetsResult} */ (await orderUtils.getBalancesCached(false, `${moduleName}-isEnoughCoins`));
  if (!balances) {
    log.warn(`Trader: Unable to retrieve balances${useSecondAccount ? ' on first account' : ''} for placing t-order.`);
    return {
      result: false,
    };
  }

  let balances2;

  if (useSecondAccount) {
    balances2 = /** @type {AssetsResult} */ (await orderUtils.getBalancesCached(false, `${moduleName}-isEnoughCoins`, undefined, undefined, traderapi2));
    if (!balances2) {
      log.warn(`Trader: Unable to retrieve balances on second account for placing t-order.`);
      return {
        result: false,
      };
    }
  }

  let isBalanceEnough = true;
  let output = ''; let onWhichAccount; let orderSide;
  let coin1Balance; let coin2Balance;

  try {
    const makerBalances = utils.balanceHelper(balances, formattedPair);
    const takerBalances = useSecondAccount ?
        utils.balanceHelper(balances2, formattedPair) :
        makerBalances;

    const makerCoin1Balance = makerBalances.coin1Data;
    const makerCoin2Balance = makerBalances.coin2Data;
    const takerCoin1Balance = takerBalances.coin1Data;
    const takerCoin2Balance = takerBalances.coin2Data;

    const baseString = `${base.toFixed(coin1Decimals)} ${coin1}`;
    const quoteString = `${quote.toFixed(coin2Decimals)} ${coin2}`;

    if (mmCurrentAction === 'executeInSpread') {
      if (isPerpetual) {
        // executeInSpread, Perpetual, buy | sell: both maker and taker orders are in quote currency

        coin2Balance = makerCoin2Balance;

        if (!coin2Balance.free || coin2Balance.free < quote * 2) {
          isBalanceEnough = false;
          onWhichAccount = '';
          orderSide = side === 'buy' ? 'sell->buying' : 'buy->selling';
          // Not enough USDT balance to place t-order to sell->buying/buy->selling 1 BTC contracts for 40,000 USDT on BTCUSDT (in spread)
          output = `Not enough ${coin2} balance${onWhichAccount} to place t-order to ${orderSide} ${baseString} contracts for ${quoteString} on ${formattedPair.pair} (in spread). ${makerBalances.coin2s2}.`;
        }
      } else if (side === 'buy') {
        // executeInSpread, Spot, buy: (maker) we place crossSide-order (sell) ⟶ (taker) we place side-order (buy)

        // First, (maker) we place crossSide-order (sell) using first account
        // Last, (taker) we place side-order (buy) using first or second account
        coin1Balance = makerCoin1Balance;
        coin2Balance = takerCoin2Balance;

        if (!coin1Balance.free || coin1Balance.free < base) {
          isBalanceEnough = false;
          onWhichAccount = useSecondAccount ? ' on first account' : '';
          orderSide = 'direct maker (!sell->buying)';
          output = `Not enough balance${onWhichAccount} to place ${baseString} ${orderSide} t-order on ${formattedPair.pair} (in spread). ${makerBalances.coin1s2}.`;
        } else if (!coin2Balance.free || coin2Balance.free < quote) {
          isBalanceEnough = false;
          onWhichAccount = useSecondAccount ? ' on second account' : '';
          orderSide = 'cross-side taker (sell->!buying)';
          output = `Not enough balance${onWhichAccount} to place ${quoteString} ${orderSide} t-order on ${formattedPair.pair} (in spread). ${takerBalances.coin2s2}.`;
        }
      } else {
        // executeInSpread, Spot, sell: (maker) we place crossSide-order (buy) ⟶ (taker) we place side-order (sell)

        // First, (maker) we place crossSide-order (buy) using first account
        // Last, (taker) we place side-order (sell) using first or second account
        coin1Balance = takerCoin1Balance;
        coin2Balance = makerCoin2Balance;

        if (!coin2Balance.free || coin2Balance.free < quote) {
          isBalanceEnough = false;
          onWhichAccount = useSecondAccount ? ' on first account' : '';
          orderSide = 'direct maker (!buy->selling)';
          output = `Not enough balance${onWhichAccount} to place ${quoteString} ${orderSide} t-order on ${formattedPair.pair} (in spread). ${makerBalances.coin2s2}.`;
        } else if (!coin1Balance.free || coin1Balance.free < base) {
          isBalanceEnough = false;
          onWhichAccount = useSecondAccount ? ' on second account' : '';
          orderSide = 'cross-side taker (buy->!selling)';
          output = `Not enough balance${onWhichAccount} to place ${baseString} ${orderSide} t-order on ${formattedPair.pair} (in spread). ${takerBalances.coin1s2}.`;
        }
      }
    }

    if (mmCurrentAction === 'executeInOrderBook') {
      if (isPerpetual) {
        // executeInOrderBook, Perpetual, buy | sell: taker order is in quote currency

        coin2Balance = makerCoin2Balance;

        if (!coin2Balance.free || coin2Balance.free < quote) {
          isBalanceEnough = false;
          onWhichAccount = '';
          orderSide = side;
          // Not enough USDT balance to place t-order to buy 1 BTC contracts for 40,000 USDT on BTCUSDT (in order book)
          output = `Not enough ${coin2} balance${onWhichAccount} to place t-order to ${orderSide} ${baseString} contracts for ${quoteString} on ${formattedPair.pair} (in order book). ${makerBalances.coin2s2}.`;
        }
      } else if (side === 'sell') {
        // executeInOrderBook, Spot, sell: we place side-order (sell) using first or second account

        coin1Balance = takerCoin1Balance;

        if (!coin1Balance.free || coin1Balance.free < base) {
          isBalanceEnough = false;
          onWhichAccount = useSecondAccount ? ' on second account' : '';
          output = `Not enough balance${onWhichAccount} to place ${baseString} ${side} t-order on ${formattedPair.pair} (in order book). ${takerBalances.coin1s2}.`;
        }
      } else {
        // executeInOrderBook, Spot, buy: we place side-order (buy) using first or second account

        coin2Balance = takerCoin2Balance;

        if (!coin2Balance.free || coin2Balance.free < quote) {
          isBalanceEnough = false;
          onWhichAccount = useSecondAccount ? ' on second account' : '';
          output = `Not enough balance${onWhichAccount} to place ${quoteString} ${side} t-order on ${formattedPair.pair} (in order book). ${takerBalances.coin2s2}.`;
        }
      }
    }

    return {
      result: isBalanceEnough,
      message: output,
    };
  } catch (e) {
    log.warn(`Trader: Error processing balance check for placing t-order on ${formattedPair.pair}: ${e}`);

    return {
      result: false,
    };
  }
}

/**
 * Picks the trade action locally when mm_nice_chart is unavailable.
 *
 * @param {TraderRuntime} runtime Trader runtime
 * @param {string} mmPolicy Effective trader policy
 * @param {object} orderBookInfo Current order book metrics
 * @param {boolean} [canExecuteInOrderBook=true] Whether order-book execution is still allowed
 * @returns {MmCurrentAction} Selected trade action
 */
function pickTradeActionLocal(runtime, mmPolicy, orderBookInfo, canExecuteInOrderBook = true) {
  const { tradeParams, random } = runtime.deps;

  if (mmPolicy === 'orderbook') {
    return 'executeInOrderBook';
  }

  if (mmPolicy === 'spread' || !canExecuteInOrderBook) {
    return 'executeInSpread';
  }

  // For 'optimal' trader policy, the decision is based on mm_isLiquidityActive and order book spread

  if (tradeParams.mm_isLiquidityActive) {
    // If Liquidity is enabled with Optimal trading policy, do 80% in order book and 20% in spread
    return random() > 0.8 ? 'executeInSpread' : 'executeInOrderBook';
  }

  // If Liquidity is disabled with Optimal trading policy, do most orders in spread, but few in order book yet
  const obSpread = orderBookInfo.spreadPercent;
  if (obSpread < 2) {
    // If ob-spread is less than 2%, do 90% orders in spread and 10% in order book
    return random() > 0.1 ? 'executeInSpread' : 'executeInOrderBook';
  }
  if (obSpread < 5) {
    return random() > 0.05 ? 'executeInSpread' : 'executeInOrderBook';
  }
  if (obSpread < 10) {
    return random() > 0.01 ? 'executeInSpread' : 'executeInOrderBook';
  }

  return random() > 0.001 ? 'executeInSpread' : 'executeInOrderBook';
}

/**
 * Calculates the local order-book amount cap before any Nice Chart restrictions.
 *
 * @param {TraderRuntime} runtime Trader runtime
 * @param {'buy' | 'sell'} side Order side
 * @param {number} coin1Amount Requested amount in base coin
 * @param {object} orderBook Current order book snapshot
 * @param {object} orderBookInfo Current order book metrics
 * @param {TraderLiquidityProvider | any} liquidityProvider Resolved liquidity provider
 * @returns {{ amountLimited: number, limitedByString: string }} Local amount cap details
 */
function limitInOrderBookAmountLocal(runtime, side, coin1Amount, orderBook, orderBookInfo, liquidityProvider) {
  const { tradeParams, randomValue, utils } = runtime.deps;

  let amountInSpread;
  let amountInConfig;
  let amountMaxAllowed;
  let firstOrderAmount;

  const allowedAmountKoef = tradeParams.mm_isLiquidityActive ?
    randomValue(EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MIN, EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MAX) :
    randomValue(EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MIN, EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MAX);

  const liqLimits = liquidityProvider.getLiqLimits();

  if (side === 'sell') {
    amountInSpread = orderBookInfo.liquidity.percentCustom.amountBids;
    amountInConfig = liqLimits.bidLimit / orderBookInfo.highestBid;
    firstOrderAmount = orderBook.bids[0].amount * allowedAmountKoef;
  } else {
    amountInSpread = orderBookInfo.liquidity.percentCustom.amountAsks;
    amountInConfig = liqLimits.askLimit;
    firstOrderAmount = orderBook.asks[0].amount * allowedAmountKoef;
  }

  amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
  amountMaxAllowed *= allowedAmountKoef;

  if (utils.isPositiveNumber(amountMaxAllowed) && tradeParams.mm_isLiquidityActive) {
    return {
      amountLimited: amountMaxAllowed,
      limitedByString: 'Liquidity volume',
    };
  }

  return {
    amountLimited: firstOrderAmount,
    limitedByString: 'First order amount',
  };
}

/**
 * Builds the final price/amount decision (both when mm_nice_chart is available and when it is not).
 *
 * @param {TraderRuntime} runtime Trader runtime
 * @param {'buy' | 'sell'} side Order side
 * @param {number} coin1Amount Base order amount
 * @param {string} mmPolicy Effective trader policy
 * @param {number} bidPrice Left edge of the allowed corridor
 * @param {number} askPrice Right edge of the allowed corridor
 * @param {number} spread Absolute spread width
 * @param {number} spreadUnits Spread width in precision units
 * @param {object} orderBook Current order book snapshot
 * @param {object} orderBookInfo Current order book metrics
 * @param {number} precision Quote precision step
 * @param {object} diagnostics Diagnostics payload to propagate
 * @param {TraderLiquidityProvider | any} liquidityProvider Resolved liquidity provider used for local order-book sizing
 * @param {MmCurrentAction} [forcedAction] Optional preselected action
 * @returns {Promise<TraderPriceRequest>} Final local trade decision
 */
async function buildTradeDecision(
    runtime, side, coin1Amount, mmPolicy, bidPrice, askPrice, spread, spreadUnits, orderBook, orderBookInfo, precision,
    diagnostics, liquidityProvider, niceChart, forcedAction,
) {
  const { utils, log, randomValue, tradeParams, orderUtils } = runtime.deps;
  const { pair, coin1, coin2, coin1Decimals, coin2Decimals } = runtime.formattedPair;
  const niceChartEnabled = runtime.deps.config?.nice_chart?.enabled !== false;

  // It's not enough to check the presence of qhOwnThirdPartyTable because it always exists, but it may have empty bids or asks array
  const targetQhRows = side === 'sell' ?
    orderBookInfo?.qhOwnThirdPartyTable?.bids :
    orderBookInfo?.qhOwnThirdPartyTable?.asks;

  if (niceChartEnabled && forcedAction !== 'executeInSpread' && (!Array.isArray(targetQhRows) || targetQhRows.length === 0)) { // Tests inject orderBookInfo with qhOwnThirdPartyTable data and we skip this refresh logic/requests
    const openOrders = await orderUtils.getOpenOrdersCached(pair, moduleName, true);
    const refreshedOrderBookInfo = utils.getOrderBookInfo(
        orderBook,
        tradeParams.mm_liquiditySpreadPercent,
        undefined,
        undefined,
        openOrders,
        moduleName,
    );

    const refreshedTargetQhRows = side === 'sell' ?
      refreshedOrderBookInfo?.qhOwnThirdPartyTable?.bids :
      refreshedOrderBookInfo?.qhOwnThirdPartyTable?.asks;

    if (Array.isArray(refreshedTargetQhRows) && refreshedTargetQhRows.length > 0) {
      orderBookInfo = refreshedOrderBookInfo;
    } else {
      log.warn(`Trader: Unable to refresh order book info with open orders for ${pair}. Own-vs-third-party breakdown of visible order book by price level is unavailable.`);
      return {
        price: false,
        skipReason: 'nice_chart_qhOwnThirdPartyTable_unavailable',
      };
    }
  }

  const mmCurrentAction = forcedAction || (
    niceChartEnabled && typeof niceChart?.pickTradeAction === 'function' ?
      await niceChart.pickTradeAction({
        runtime,
        side,
        coin1Amount,
        mmPolicy,
        orderBook,
        orderBookInfo,
        canExecuteInOrderBook: true,
      }) :
      pickTradeActionLocal(runtime, mmPolicy, orderBookInfo)
  );

  // Set the price and trade amount according to mmCurrentAction

  if (mmCurrentAction === 'executeInOrderBook') {
    // Use the real highest bid and lowest ask as the start price for in-orderbook order placement
    const startPrice = side === 'sell' ? orderBookInfo.highestBid : orderBookInfo.lowestAsk;

    let isAmountLimited = false;

    const amountLimitResult = niceChartEnabled && typeof niceChart?.limitInOrderBookAmount === 'function' ?
      await niceChart.limitInOrderBookAmount({
        runtime,
        side,
        coin1Amount,
        mmPolicy,
        orderBook,
        orderBookInfo,
      }) :
      limitInOrderBookAmountLocal(runtime, side, coin1Amount, orderBook, orderBookInfo, liquidityProvider);

    const amountLimited = amountLimitResult.amountLimited;
    const limitedByString = amountLimitResult.limitedByString;

    const coin1AmountOriginal = coin1Amount;
    if (coin1Amount > amountLimited) {
      isAmountLimited = true;
      coin1Amount = amountLimited;
    }

    if (!utils.isPositiveNumber(coin1Amount)) {
      log.warn(`Trader: Nice Chart restricted order-book execution for ${pair}. Refusing to place zero-sized executeInOrderBook t-order.`);
      return {
        price: false,
        skipReason: 'nice_chart_amount_restricted',
      };
    }

    const minOrderAmount = orderUtils.getMinOrderAmount();
    let isAmountRestoredToMin = false;
    const coin1AmountAfterLimit = coin1Amount;
    if (minOrderAmount && coin1Amount < minOrderAmount.min) {
      isAmountRestoredToMin = true;
      coin1Amount =
          randomValue(minOrderAmount.minReliable, Math.min(tradeParams.mm_maxAmount, minOrderAmount.upperBound)) ||
          minOrderAmount.minReliable;
    }

    let executeInOrderBookString = `Trader: Calculating coin1Amount (${mmPolicy} trading policy) to ${side === 'buy' ? 'buy from' : 'sell in'} the order book.`;
    if (isAmountLimited) {
      executeInOrderBookString += ` Order amount is reduced from ${coin1AmountOriginal.toFixed(coin1Decimals)} to ${coin1AmountAfterLimit.toFixed(coin1Decimals)} ${coin1} to fit ${limitedByString}`;
      if (isAmountRestoredToMin) {
        executeInOrderBookString += ` and restored to minimum allowed ${coin1Amount.toFixed(coin1Decimals)} ${coin1}`;
      }
      executeInOrderBookString += '.';
    } else if (isAmountRestoredToMin) {
      executeInOrderBookString += ` Order amount restored to minimum allowed ${coin1Amount.toFixed(coin1Decimals)} ${coin1} from ${coin1AmountAfterLimit.toFixed(coin1Decimals)} ${coin1}.`;
    } else {
      executeInOrderBookString += ` Order amount ${coin1AmountOriginal.toFixed(coin1Decimals)} ${coin1} is not reduced.`;
    }
    log.log(executeInOrderBookString);

    // Finally, calculate the order price so that highestBid–lowestAsk does not change by more than maxPriceDeviation (~0.15%)

    const configuredMaxPriceChangePercent = Number(runtime.deps.config?.nice_chart?.executeInOrderBook?.maxPriceChangePercent);
    const maxPriceDeviation = randomValue(
        0,
        Number.isFinite(configuredMaxPriceChangePercent) && configuredMaxPriceChangePercent > 0 ?
          configuredMaxPriceChangePercent :
          constants.EXECUTE_IN_ORDER_BOOK_MAX_PRICE_CHANGE_PERCENT,
    );
    const price = side === 'sell' ? startPrice * (1 - maxPriceDeviation / 100) : startPrice * (1 + maxPriceDeviation / 100);

    const recalculatedOrderBookInfo = utils.getOrderBookInfo(orderBook, maxPriceDeviation, price, coin1Amount);
    if (!recalculatedOrderBookInfo) {
      log.warn(`Trader: Unable to calculate order book info for ${pair}. Cannot determine price for in-orderbook t-order.`);
      return {
        price: false,
        skipReason: 'order_book_info_unavailable',
      };
    }

    let isPriceMoved = false;
    // Whether the taker order is expected to fully fill after matching visible book liquidity.
    // When false, the order may remain open by design; executeMmOrder uses this to avoid treating
    // new/part_filled status as third-party bot intervention. SBW counters are not affected either way.
    let isOrderFilled = true;
    let priceChangePercent = 0;
    const placedAmountCount = side === 'sell' ? recalculatedOrderBookInfo.placedAmountCountBid : recalculatedOrderBookInfo.placedAmountCountAsk;
    let finalPrice = side === 'sell' ? recalculatedOrderBookInfo.placedAmountPriceBid : recalculatedOrderBookInfo.placedAmountPriceAsk;

    if (placedAmountCount > 0) {
      isPriceMoved = true;
      isOrderFilled = side === 'sell' ? finalPrice >= price : finalPrice <= price;
      if (!isOrderFilled) {
        finalPrice = price;
      }
      priceChangePercent = utils.numbersDifferencePercent(startPrice, finalPrice);
    }

    // Calculate new spread in the order book after placing the order

    const newSpread = side === 'sell' ? orderBookInfo.lowestAsk - finalPrice : finalPrice - orderBookInfo.highestBid;
    const newSpreadNumber = Math.round(newSpread / precision);
    const newSpreadPercent = newSpread / finalPrice * 100;

    // Log and return the results

    executeInOrderBookString = `Trader: Calculating price (${mmPolicy} trading policy) to ${side === 'buy' ? 'buy from' : 'sell in'} the order book.`;
    executeInOrderBookString += ` Attempting to ${side} ${coin1Amount.toFixed(coin1Decimals)} ${coin1} at ${price.toFixed(coin2Decimals)} ${coin2}.`;
    if (isPriceMoved) {
      executeInOrderBookString += ` This will move the ob-price from ${startPrice.toFixed(coin2Decimals)} to ${finalPrice.toFixed(coin2Decimals)} ${coin2} (${priceChangePercent.toFixed(4)}% change);`;
      executeInOrderBookString += isOrderFilled ? ' the order will be fully filled.' : ' the order will match all ob-orders and remain in the order book.';
    } else {
      executeInOrderBookString += ` This will not change the ob-price ${startPrice.toFixed(coin2Decimals)} ${coin2}; the order will be fully filled.`;
    }
    log.log(executeInOrderBookString);

    return {
      mmCurrentAction, // 'executeInOrderBook'
      startPrice, // bid_ob for sell, ask_ob for buy
      price, // Order placement price
      expectedPrice: finalPrice, // Final price after matching with the order book; set only for 'executeInOrderBook' policy
      bidPrice,
      askPrice,
      spread,
      spreadUnits,
      precision,
      coin1Amount, // May be adjusted (reduced)
      newSpread, // New order book spread after placing the order; set only for 'executeInOrderBook' policy
      newSpreadNumber,
      newSpreadPercent,
      expectedOwnMatchAmount: amountLimitResult.expectedOwnMatchAmount,
      expectedOwnMatchQuote: amountLimitResult.expectedOwnMatchQuote,
      expectedThirdPartyAmount: amountLimitResult.expectedThirdPartyAmount,
      expectedThirdPartyQuote: amountLimitResult.expectedThirdPartyQuote,
      // Nice Chart may provide the exact visible own/third-party traversal plan.
      // Trader itself does not interpret this structure anymore; it only forwards
      // it back to Nice Chart later when attributing a real exchange fill.
      expectedMatchPlan: amountLimitResult.expectedMatchPlan,
      matchingThirdPartyAllowed: amountLimitResult.matchingThirdPartyAllowed,
      matchingThirdPartyRestricted: amountLimitResult.matchingThirdPartyRestricted,
      matchingThirdPartyRestriction: amountLimitResult.matchingThirdPartyRestriction,
      amountUntilThirdParty: amountLimitResult.amountUntilThirdParty,
      topStartsWithOurOrders: amountLimitResult.topStartsWithOurOrders,
      topStartsWithThirdPartyOrders: amountLimitResult.topStartsWithThirdPartyOrders,
      isOrderFilled,
      diagnostics,
    };
  } // 'executeInOrderBook'

  // When mmCurrentAction === 'executeInSpread' calculation is simpler:
  // Pick a price within the spread corridor defined by bidPrice and askPrice

  const minPrice = orderBookInfo.highestBid + precision;
  const maxPrice = orderBookInfo.lowestAsk - precision;
  const price = Math.min(maxPrice, Math.max(minPrice, randomValue(bidPrice, askPrice)));

  return {
    price,
    mmCurrentAction: 'executeInSpread',
    side,
    bidPrice,
    askPrice,
    spread,
    spreadUnits,
    precision,
    coin1Amount,
    diagnostics,
  };
}

/**
 * Determines optimal order price and trade action (doNotExecute, executeInSpread, executeInOrderBook) based on market conditions and module settings.
 * Uses mm_nice_chart for the decision when available, otherwise falls back to local logic.
 *
 * Logic flow:
 * 1. Retrieves current order book and validates it's not empty
 * 2. Checks the Price watcher constraints (if enabled) and adjusts spread limits accordingly
 * 3. Analyzes market spread and determines execution strategy
 * 4. For spread trading: optionally lets mm_nice_chart narrow the allowed corridor
 * 5. For order book trading: calculates price impact and order size limits based on liquidity parameters
 * 6. Returns determined price, action type, and potentially adjusted order amount
 *
 * Considers:
 * - mm_Policy: 'optimal', 'spread'/'wash', 'orderbook', or 'depth'
 * - Price watcher constraints (if enabled)
 * - Optional Nice Chart corridor restrictions from mm_nice_chart
 * - Spread size and liquidity depth
 * - Configured min/max order amounts
 *
 * @param {TraderRuntime} runtime Trader runtime. Uses runtime.deps. `tradeParams`, `orderUtils`, `traderapi`, `utils`, `random*`, `runtime.formattedPair`, and trade-history state used by Nice Chart.
 * @param {'buy' | 'sell'} side Order side
 * @param {number} coin1Amount Base order amount. Can be reduced for order book trades.
 * @param {TraderStepInput} [stepInput={}] Optional injected market snapshot and dependency overrides for tests
 * @returns {Promise<TraderPriceRequest>} Price, action, and potentially adjusted amount
 */
async function setPrice(runtime, side, coin1Amount, stepInput = {}) {
  try {
    const { tradeParams, orderUtils, traderapi, isPerpetual, utils, log } = runtime.deps;
    const { pair, coin2, coin2Decimals } = runtime.formattedPair;

    const priceWatcher = resolvePriceWatcher(runtime, stepInput);
    const liquidityProvider = resolveLiquidityProvider(runtime, stepInput);
    const niceChart = resolveNiceChart(runtime, stepInput);
    const niceChartEnabled = runtime.deps.config?.nice_chart?.enabled !== false;

    const precision = stepInput.precision || utils.getPrecision(coin2Decimals);
    const now = getStepNow(stepInput);

    let output = '';
    let appliedNiceChartRange;
    const orderBook = stepInput.orderBook || await orderUtils.getOrderBookCached(pair, moduleName, true);
    const orderBookInfo = stepInput.orderBookInfo || utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent);
    if (!orderBookInfo) {
      log.warn(`Trader: Order book is empty for ${pair} or API error occurred. Cannot determine price for t-order.`);
      return {
        price: false,
        skipReason: 'order_book_unavailable',
        precision,
      };
    }

    // Highest bid & ask from the order book
    const bid_ob = orderBookInfo.highestBid;
    const ask_ob = orderBookInfo.lowestAsk;

    // Highest bid and lowest ask used to constrain the order price range
    // They may be adjusted by the Price watcher or the Nice chart logic
    let bid_p = bid_ob;
    let ask_p = ask_ob;

    let mmPolicy = stepInput.mmPolicy || tradeParams.mm_Policy; // optimal, spread | wash, orderbook
    if (mmPolicy === 'wash') {
      mmPolicy = 'spread';
    }

    /** @type {MmCurrentAction | undefined} */
    let mmCurrentAction;

    const lowHighString_ob = `Low: ${bid_ob.toFixed(coin2Decimals)}, high: ${ask_ob.toFixed(coin2Decimals)} ${coin2}`;
    const checkObString = 'Check the order book and the Price watcher parameters.';

    let isSpreadCorrectedByPriceWatcher = false;
    let skipNotify = false;

    stepInput.__niceChartDiagnostics = undefined;
    stepInput.__niceChartCloseCorrection = undefined;

    // Validate Price watcher constraints (if enabled) and adjust allowed spread limits (bid_p–ask_p) for order price calculation
    /** @type {Record<string, any>} */
    const priceWatcherDiagnostics = {
      enabled: Boolean(priceWatcher?.getIsPriceWatcherEnabled?.()),
      corrected: false,
      blocked: false,
    };

    const orderInfo = 't-order';

    if (priceWatcher?.getIsPriceWatcherEnabled?.()) {

      if (priceWatcher.getIsPriceAnomaly()) {
        output = `Refusing to place ${orderInfo}. Price watcher reported a price anomaly.`;
        skipNotify = true;
        priceWatcherDiagnostics.blocked = true;
        priceWatcherDiagnostics.reason = 'price_anomaly';

        mmCurrentAction = 'doNotExecute';
      } else if (priceWatcher.getIsPriceActual()) {
        const pwLowPrice = priceWatcher.getLowPrice();
        const pwHighPrice = priceWatcher.getHighPrice();
        priceWatcherDiagnostics.isPriceActual = true;
        priceWatcherDiagnostics.lowPrice = pwLowPrice;
        priceWatcherDiagnostics.highPrice = pwHighPrice;

        if (side === 'buy') {
          if (bid_p > pwHighPrice) {
            output = `Refusing to buy higher than ${pwHighPrice.toFixed(coin2Decimals)}. t-order cancelled. ${lowHighString_ob}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
            skipNotify = true;
            priceWatcherDiagnostics.blocked = true;
            priceWatcherDiagnostics.reason = 'buy_above_high';

            mmCurrentAction = 'doNotExecute';
          } else if (ask_p > pwHighPrice) {
            output = `Price watcher corrected spread to buy not higher than ${pwHighPrice.toFixed(coin2Decimals)} while placing t-order.`;

            if (mmPolicy === 'orderbook') {
              output += ` Settings deny trading in spread. Unable to set a price for ${pair}. t-order cancelled. ${lowHighString_ob}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
              skipNotify = true;

              mmCurrentAction = 'doNotExecute';
            } else {
              output += ` Will trade in spread. ${lowHighString_ob}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
              log.log(`Trader: ${output}`);
              output = '';

              isSpreadCorrectedByPriceWatcher = true;
              priceWatcherDiagnostics.corrected = true;
              mmPolicy = 'spread';
            }

            ask_p = pwHighPrice;
          }
        } else if (side === 'sell') {
          if (ask_p < pwLowPrice) {
            output = `Refusing to sell lower than ${pwLowPrice.toFixed(coin2Decimals)}. t-order cancelled. ${lowHighString_ob}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
            skipNotify = true;
            priceWatcherDiagnostics.blocked = true;
            priceWatcherDiagnostics.reason = 'sell_below_low';

            mmCurrentAction = 'doNotExecute';
          } else if (bid_p < pwLowPrice) {
            output = `Price watcher corrected spread to sell not lower than ${pwLowPrice.toFixed(coin2Decimals)} while placing t-order.`;

            if (mmPolicy === 'orderbook') {
              output += ` Settings deny trading in spread. Unable to set a price for ${pair}. t-order cancelled. ${lowHighString_ob}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
              skipNotify = true;

              mmCurrentAction = 'doNotExecute';
            } else {
              output += ` Will trade in spread. ${lowHighString_ob}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
              log.log(`Trader: ${output}`);
              output = '';

              isSpreadCorrectedByPriceWatcher = true;
              priceWatcherDiagnostics.corrected = true;
              mmPolicy = 'spread';
            }

            bid_p = pwLowPrice;
          }
        }
      } else if (priceWatcher.getIgnorePriceNotActual()) {
        log.log(`Trader: While placing ${orderInfo}, the Price watcher reported the price range is not actual. According to settings, ignore and treat this like the Pw is disabled.`);
      } else {
        output = `Refusing to place ${orderInfo}. Price watcher reported the price range is not actual.`;
        skipNotify = true;
        priceWatcherDiagnostics.blocked = true;
        priceWatcherDiagnostics.reason = 'price_not_actual';

        mmCurrentAction = 'doNotExecute';
      }
    }

    const spread_p = ask_p - bid_p;
    const spreadUnits_p = Math.round(spread_p / precision);
    const noSpread_p = spreadUnits_p < 2;

    const diagnostics = {
      mmPolicy,
      priceWatcher: priceWatcherDiagnostics,
    };

    if (mmCurrentAction === 'doNotExecute') {
      if (!output) { // Not likely, but just in case
        output = `Refusing to place ${orderInfo}.`;
      }

      if (skipNotify) {
        log.log(`Trader: ${output}`);
        output = '';
      }

      return {
        price: false,
        message: output,
        skipReason: priceWatcherDiagnostics.reason || 'do_not_execute',
        bidPrice: bid_p,
        askPrice: ask_p,
        spread: spread_p,
        spreadUnits: spreadUnits_p,
        precision,
        diagnostics,
      };
    }

    // The Price Watcher allows trading -> Set the order price and amount

    if (noSpread_p) {
      // No spread: Decide whether to trade in the order book or cancel

      if (mmPolicy === 'orderbook' || mmPolicy === 'optimal') {
        return await buildTradeDecision(
            runtime,
            side,
            coin1Amount,
            mmPolicy,
            bid_p,
            ask_p,
            spread_p,
            spreadUnits_p,
            orderBook,
            orderBookInfo,
            precision,
            diagnostics,
            liquidityProvider,
            niceChart,
            'executeInOrderBook',
        );
      }

      if (isSpreadCorrectedByPriceWatcher) {
        const lowHighString_p = `Low: ${bid_p.toFixed(coin2Decimals)}, high: ${ask_p.toFixed(coin2Decimals)} ${coin2}`;
        output = `Refusing to place ${orderInfo} because of the Price watcher. Corrected spread range is too small — ${lowHighString_p}. ${priceWatcher.getPwRangeString()} ${checkObString}`;
        skipNotify = true;
      } else {
        output = `No spread currently, and the settings deny trading in the order book. ${lowHighString_ob}. Unable to set a price for ${pair}. Update settings or create a spread manually.`;
      }

      if (skipNotify) {
        log.log(`Trader: ${output}`);
        output = '';
      }

      return {
        price: false,
        message: output,
        skipReason: 'do_not_execute',
        bidPrice: bid_p,
        askPrice: ask_p,
        spread: spread_p,
        spreadUnits: spreadUnits_p,
        precision,
        diagnostics,
      };
    }

    // Spread exists: Determine the execution method (mmCurrentAction: 'executeInSpread' or 'executeInOrderBook') and calculate the price range

    let niceChartAllowsExecuteInOrderBook = true;

    if (niceChartEnabled && niceChart?.getNextPrice) {
      // If Nice Chart module available, use it to potentially narrow the price range and determine if order book execution is allowed based on the chart analysis

      try {
        const niceChartRequest = {
          traderapi,
          pair,
          side,
          coin2,
          coin2Decimals,
          orderBook,
          orderBookInfo,
          mmPolicy,
          precision,
          isPerpetual,
          isClosingTrade: Boolean(stepInput.isClosingTrade),
          now,
          bidLimit: bid_p,
          askLimit: ask_p,
          spread: spread_p,
          spreadUnits: spreadUnits_p,
        };

        const niceChartRange = await niceChart.getNextPrice(niceChartRequest);

        if (niceChartRange?.diagnostics) {
          stepInput.__niceChartDiagnostics = niceChartRange.diagnostics;
        }
        stepInput.__niceChartCloseCorrection = niceChartRange?.closeCorrection || niceChartRange?.diagnostics?.closeCorrection;

        if (niceChartRange?.isValid) {
          appliedNiceChartRange = niceChartRange;
          bid_p = niceChartRange.bidLimit;
          ask_p = niceChartRange.askLimit;
          niceChartAllowsExecuteInOrderBook = niceChartRange.niceChartAllowsExecuteInOrderBook !== false;

          runtime.state.niceChartConsecutiveFailures = 0;
          const niceChartDiagnostics = niceChartRange.diagnostics;
          const niceChartDataSource = niceChartDiagnostics?.dataSource === 'local' && niceChartDiagnostics?.seedSource ?
            `local+${niceChartDiagnostics.seedSource}` :
            niceChartDiagnostics?.dataSource;
          const niceChartAcceptedMessage = `Trader: Nice Chart accepted ${pair} ${side} t-order context ` +
            `(mode=${niceChartDiagnostics?.mode || 'unknown'}, dataSource=${niceChartDataSource || 'unknown'}, ` +
            `storedBaseCandles=${niceChartDiagnostics?.baseCandleCount ?? 'n/a'}, ` +
            `runtimeTrades=${niceChartDiagnostics?.runtimeTradeCount ?? 'n/a'}, ` +
            `allowsOrderBook=${niceChartAllowsExecuteInOrderBook}, ` +
            `corridor=${bid_p.toFixed(coin2Decimals)}–${ask_p.toFixed(coin2Decimals)} ${coin2}).`;

          if (niceChartDiagnostics?.mode === 'degraded') {
            log.warn(niceChartAcceptedMessage);
          } else {
            log.log(niceChartAcceptedMessage);
          }
        } else {
          const reason = niceChartRange?.reason || 'nice_chart_unavailable';
          const skipResult = handleNiceChartFailure({
            runtime,
            pair,
            orderInfo,
            reason,
            bidPrice: bid_p,
            askPrice: ask_p,
            spread: spread_p,
            spreadUnits: spreadUnits_p,
            precision,
            diagnostics,
            niceChartDiagnostics: stepInput.__niceChartDiagnostics,
          });

          if (skipResult) {
            return skipResult;
          }
        }
      } catch (error) {
        const skipResult = handleNiceChartFailure({
          runtime,
          pair,
          orderInfo,
          reason: 'service_error',
          bidPrice: bid_p,
          askPrice: ask_p,
          spread: spread_p,
          spreadUnits: spreadUnits_p,
          precision,
          diagnostics,
          error,
        });

        if (skipResult) {
          return skipResult;
        }
      }
    }

    const spreadDiagnostics = {
      ...diagnostics,
      closingTrade: Boolean(stepInput.isClosingTrade),
      ...(stepInput.__niceChartDiagnostics ? { niceChart: stepInput.__niceChartDiagnostics } : {}),
    };

    const forcedAction = mmPolicy === 'orderbook' ?
      'executeInOrderBook' :
      (mmPolicy === 'spread' || !niceChartAllowsExecuteInOrderBook ? 'executeInSpread' : undefined);

    const decision = await buildTradeDecision(
        runtime,
        side,
        coin1Amount,
        mmPolicy,
        bid_p,
        ask_p,
        spread_p,
        spreadUnits_p,
        orderBook,
        orderBookInfo,
        precision,
        spreadDiagnostics,
        liquidityProvider,
        niceChart,
        forcedAction,
    );

    return {
      ...decision,
      ...(appliedNiceChartRange ? { niceChartRange: appliedNiceChartRange, isExecutedWithNiceChart: true } : {}),
      diagnostics: spreadDiagnostics,
      isClosingTrade: Boolean(stepInput.isClosingTrade),
      niceChartAllowsExecuteInOrderBook,
      ...(stepInput.__niceChartCloseCorrection ? { closeCorrection: stepInput.__niceChartCloseCorrection } : {}),
    };

  } catch (e) {
    runtime.deps.log.error(`Error in setPrice() of ${moduleName} module: ${e}`);
    return {
      price: false,
    };
  }
}

/**
 * Sets ~randomized trading amount from mm_minAmount to mm_maxAmount multiplied by volatilityKoef.
 * It considers volatilityKoef (0.25–4) from mm_volume_volatility module.
 * Can be reduced by setPrice() later for order book trades.
 * @param {TraderRuntime} runtime Trader runtime. Uses runtime.deps. `tradeParams`, `randomValue`, `utils`, `log`, and `runtime.formattedPair`.
 * @returns {number} Amount to trade in base coin
*/
function setAmount(runtime) {
  const { tradeParams, utils, randomValue, log, orderUtils } = runtime.deps;
  const { coin1Decimals, coin1 } = runtime.formattedPair;

  const regularAmount = randomValue(tradeParams.mm_minAmount, tradeParams.mm_maxAmount);
  let vvAmount = regularAmount;

  // Take into account the `volatilityKoef`

  const vv = utils.softRequire('../trade/mm_volume_volatility');

  if (tradeParams.mm_isVolumeVolatilityActive && vv?.getIsVolatilityKoefActual()) {
    const vvKoef = vv.getVolatilityKoef();
    vvAmount *= vvKoef;

    let logString = `Trader: Trading amount changed according to volume volatility koef ${vvKoef.toFixed(2)} from ${regularAmount.toFixed(coin1Decimals)} to ${vvAmount.toFixed(coin1Decimals)} ${coin1}`;

    const minOrderAmount = orderUtils.getMinOrderAmount();
    if (minOrderAmount && vvAmount < minOrderAmount.min) {
      const vvAmountBeforeMinCorrection = vvAmount;
      vvAmount =
          randomValue(minOrderAmount.min, Math.min(tradeParams.mm_maxAmount, minOrderAmount.upperBound)) ||
          minOrderAmount.minReliable;
      logString += ` and corrected according to min amount from ${vvAmountBeforeMinCorrection.toFixed(coin1Decimals)} to ${vvAmount.toFixed(coin1Decimals)} ${coin1}`;
    }

    log.log(`${logString}.`);
  }

  return vvAmount;
}

/**
 * Sets trading interval in ms.
 * @param {TraderRuntime} runtime Trader runtime. Uses `runtime.deps.randomValue` and `runtime.deps.tradeParams.mm_minInterval/mm_maxInterval`.
 * @returns {number} Randomized delay before the next trader iteration
*/
function setPause(runtime) {
  return runtime.deps.randomValue(runtime.deps.tradeParams.mm_minInterval, runtime.deps.tradeParams.mm_maxInterval, true);
}
