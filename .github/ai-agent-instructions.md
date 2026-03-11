# AI Agent Instructions for ADAMANT Market-Making Bot

**Target Audience**: AI Coding Assistants (GitHub Copilot, Claude, Cursor, Windsurf, etc.)

**Language Policy**: Developers communicate with AI in any language (English, Russian, etc.), but ALL code, documentation, comments, and commit messages MUST be in English only.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Development Priorities](#development-priorities)
3. [Architecture Deep Dive](#architecture-deep-dive)
4. [Critical System Patterns](#critical-system-patterns)
5. [Reliability & Safety](#reliability--safety)
6. [Data Flow & State Management](#data-flow--state-management)
7. [Module Reference](#module-reference)
8. [Development Workflow](#development-workflow)
9. [Common Pitfalls](#common-pitfalls)
10. [Refactoring Guidance](#refactoring-guidance)

**Supplementary Guides:**

- [Exchange Connector Guide](exchange-connector-guide.md) — Step-by-step instructions for creating and testing a new exchange connector (Spot REST, WebSocket, Perpetual/Futures)

---

## Project Overview

### What Is This Bot?

ADAMANT Trading Bot is a **self-hosted market-making bot** for cryptocurrency exchanges. It manages orders across 40+ exchanges to:

- **Create trading volume** via wash trading in spread or order book
- **Maintain spread and liquidity** with dynamic order book depth
- **Build dynamic order books** with high-frequency live-like updates
- **Watch and make token prices** — prevent manipulation, set price trends
- **Support multiple modules and trading strategies** — ladder/grid, TWAP, balance equalizer, anti-gap, quote hunter, etc.

**Website**: <https://marketmaking.app/>

### Premium and Free Versions

1. **Premium Version** (this repository): Full-featured, closed-source
2. **Free Version**: <https://github.com/Adamant-im/adamant-tradebot> — Limited features, open-source

**Custom Builds**: Clients (token issuers, crypto projects) order customized versions with specific premium features. Developers assemble a custom bot and push it to a separate repository. Keep code **modular** to facilitate building custom bots — every feature should be independently extractable.

### Technology Stack

- **Runtime**: Node.js >=20.19
- **Database**: MongoDB 7 (with migrations)
- **Language**: JavaScript (CommonJS modules, ES2021)
- **Types**: JSDoc `@typedef` in `.d.js` files (not TypeScript `.d.ts`), for IDE support
- **Communication**: ADAMANT Messenger, Telegram, Web UI, CLI
- **Exchange APIs**: 40+ custom adapters (`trader_*.js`)
- **Architecture**: Event-driven, single-threaded iteration loops

---

## Development Priorities

These priorities guide ALL development decisions. When conflicts arise, higher priority wins.

### 1. Reliability (Critical)

**The bot must never crash. The system must be resilient to failures.**

- **API connectors are robust** — they distinguish between requests that failed to reach the exchange, requests that returned an error, and successful responses
- Always wrap exchange API calls in try-catch
- **Graceful degradation** — if one module fails, others continue working
- **No unhandled promise rejections** — every async operation has error handling
- **Iteration loop protection** — `isPreviousIterationFinished` prevents race conditions
- Retry failed requests with exponential backoff where appropriate

### 2. Data Consistency (Critical)

**Local order/balance data must match exchange state.**

- **Database as source of truth** — NEVER place orders without immediate DB save
- **Regular Cache invalidation** — call `orderUtils.clearCache()`
- **Regular reconciliation** between local DB and exchange open orders
- **Balance validation** — always check via `orderUtils.isEnoughCoins()` before placing orders
- **False-empty-list protection** — detect when exchanges falsely return 0 orders, trigger emergency stop if needed
- No duplicate orders — verify order doesn't exist before placing

### 3. Safety (Critical)

**The bot must not create unintended trading situations.**

- **Amount/price validation** — always validate positive numbers before exchange calls
- Respect exchange min/max limits for price and amount
- Use correct decimals from `coin1Decimals` / `coin2DecimalsForStable`
- **Balance protection** — never place orders exceeding available balance
- **Rate limiting** — respect exchange API rate limits to avoid bans

### 4. Correctness (Important)

**Logic works according to documentation and expectations.**

- Validate all inputs (prices, amounts, pairs) before processing
- Check feature flags (`tradeParams.mm_is*Active`) before executing logic
- Never hardcode exchange names — use `config.exchange` dynamically
- Handle perpetual vs spot — check `config.perpetual` flag
- Use proper log levels: `.log()` for info, `.warn()` for recoverable issues, `.error()` for failures

### 5. Observability (Important)

**Easy to understand what the bot is doing at any moment.**

- **Comprehensive logging** — include module name, function name, and key parameters in all logs
- **Structured error format**: `Error in functionName(${params}) of ${moduleName} module: ${error}`
- **User notifications** — use `notify()` for important events (respects `silent_mode`)
- **Fill statistics** — track order fills, volumes, VWAP in DB via `fillsEngine`
- **Debug capabilities** — CLI mode for inspection without live trading

### 6. Maintainability (Desirable)

**Code is easy to read, change, and extend.**

- **Incremental refactoring** — improve code quality with each touch (add JSDoc, extract soft dependencies, enhance error messages)
- Follow existing patterns — match the style of surrounding code
- **Soft dependencies** — use `utils.softRequire()` for optional modules
- **Configuration-driven** — prefer config parameters over hardcoded behavior
- Clear module boundaries — keep concerns separated

### 7. Modularity & Exchange Agnosticism (Desirable)

**Code works universally for all 40+ exchanges and is easy to extract into custom builds.**

- Keep code **modular** to facilitate building custom bots easier — every feature should be independently extractable
- Dynamic loading via `config.exchange` — never hardcode exchange names except in `trader_*.js` adapters
- Exchange-specific quirks are abstracted inside trader adapters
- All trader adapters expose the same interface with the same method signatures
- Features are independently toggleable via `tradeParams` flags
- Modules use cross-module communication via in-method `require()`, not module-level imports

### Priority Trade-offs

| Conflict | Resolution |
| ---------- | ---------- |
| **Reliability vs Speed** | Choose reliability — better to be slow than crash |
| **Safety vs Features** | Choose safety — better to miss an opportunity than create a loss |
| **Consistency vs Performance** | Choose consistency — cache carefully, invalidate aggressively |
| **Correctness vs Convenience** | Choose correctness — validate thoroughly even if verbose |

---

## Architecture Deep Dive

### System Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                   ADAMANT Trading Bot                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  ADAMANT API │  │  Telegram    │  │  Web UI /    │       │
│  │  (Commands)  │  │  (Commands)  │  │  CLI         │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         └─────────────────┴─────────────────┘                │
│                           │                                   │
│                    ┌──────▼───────┐                           │
│                    │  commandTxs  │ (Command Parser)          │
│                    └──────┬───────┘                           │
│                           │                                   │
│         ┌─────────────────┼─────────────────┐                │
│    ┌────▼─────┐           │          ┌──────▼──────┐         │
│    │ Config   │           │          │ TradeParams │         │
│    │ (JSONC)  │           │          │  (Dynamic)  │         │
│    │ Immutable│           │          │  Runtime    │         │
│    └──────────┘           │          └─────────────┘         │
│                           │                                   │
│  ┌────────────────────────▼─────────────────────────────┐    │
│  │              Trade Modules (mm_*.js)                  │    │
│  │ trader | liquidity | spread | orderbook | price_..   │    │
│  │ antigap | cleaner | ladder | twap | quote_hunter     │    │
│  │ fund_balancer | fund_supplier | balance_equalizer    │    │
│  │ volatility_chart | volume_volatility | notifier      │    │
│  └───────────┬──────────────────────────────────────────┘    │
│              │                                                │
│    ┌─────────▼─────────┐     ┌───────────────┐              │
│    │  orderCollector   │◄────┤  orderUtils   │              │
│    │  (Cancel/Cleanup) │     │  (Place/Cache)│              │
│    └─────────┬─────────┘     └───────┬───────┘              │
│              │                       │                       │
│    ┌─────────▼───────────────────────▼───────────┐          │
│    │      Exchange API Adapters (trader_*.js)     │          │
│    │      + perpetualApi (for futures)            │          │
│    │      + WebSocket streams (real-time data)    │          │
│    └───────────────────┬─────────────────────────┘          │
│                        │                                     │
│    ┌───────────────────▼─────────────────────────┐          │
│    │            MongoDB (DB.js)                    │          │
│    │  ordersDb | fillsDb | filledStatsDb          │          │
│    │  balancesHistory | systemDb                   │          │
│    └──────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

### Bootstrap Sequence (`app.js`)

```text
1. DB connects + runs migrations (modules/dbMigrations.js)
   ↓
2. ~1 second delay: Create tradeParams_{exchange}.js from template if missing
   ↓
3. ~5 seconds delay: Initialize services
   - ADAMANT API socket (if passphrase provided)
   - Health/Debug API (if api.port configured)
   - Telegram bot (if manageTelegramBotToken set)
   - Web UI API (if webui configured)
   - Custom Strategy UI (if cs.ui.enabled)
   - Comserver (if com_server enabled) — inter-bot communication
   ↓
4. Check inactivity period (heartbeat file)
   - If offline too long → emergency pause (safety measure)
   ↓
5. Start ALL market-making modules via require('./trade/mm_*').run()
   - Each module begins its own iteration loop
   ↓
6. Send startup notification
```

### Core Subsystems

#### 1. Trade Modules (`trade/mm_*.js`)

Independent market-making features and strategies. Most runs on its own iteration loop with randomized intervals. Most modules check `tradeParams.mm_isActive` as a global kill switch before doing work.

#### 2. Exchange Abstraction (`trade/trader_*.js`)

Factory functions that return a uniform API object. All adapters expose the same methods (see [Exchange Adapter Interface](#exchange-adapter-interface)). Loaded dynamically via:

```javascript
const TraderApi = require('./trader_' + config.exchange);
const traderapi = TraderApi(config.apikey, config.apisecret, config.apipassword, log, ...);
```

#### 3. Order Lifecycle Engine

- **orderUtils.js** — Order placement, balance checks, caching (open orders, order book, balances)
- **orderCollector.js** — Centralized order cancellation and cleanup
- **orderStats.js** — Statistics aggregation via MongoDB pipelines

#### 4. Fills Processing (`helpers/fillsEngine.js`)

Cumulative fill tracking engine with verification. Two DB collections:

- `fillsDb` — event log of individual fills (produced by `orderUtils.updateOrders()`)
- `filledStatsDb` — persistent accumulation of verified fills with VWAP calculation (survives restarts)

#### 5. Configuration System

- **`config.*.jsonc`** (immutable) — exchange-specific configs loaded once at startup
- **`tradeParams_*.js`** (dynamic) — runtime-adjustable settings, modified by user commands

#### 6. Command System (`modules/commandTxs.js`)

Processes commands from ADAMANT Messenger, Telegram, CLI, and Web UI. Supports 39+ commands, feature enable/disable, emergency stop, confirmation mechanism.

---

## Critical System Patterns

### 1. Iteration Loop Pattern

**Most trade modules follow this exact pattern:**

```javascript
const moduleName = 'mm_moduleName';
let isPreviousIterationFinished = true;

module.exports = {
  run() {
    this.iteration();
  },

  async iteration() {
    const interval = setPause(); // Randomized milliseconds

    if (isPreviousIterationFinished) {
      isPreviousIterationFinished = false;
      try {
        await this.doWork();
      } catch (e) {
        log.error(`Error in ${moduleName} iteration: ${e}`);
      } finally {
        isPreviousIterationFinished = true;
      }
    } else {
      log.warn(`${moduleName}: Postponing iteration. Previous still in progress.`);
    }

    setTimeout(() => this.iteration(), interval);
  },

  async doWork() {
    // Check master switch
    if (!tradeParams.mm_isActive) return;
    // Check module-specific switch
    if (!tradeParams.mm_isModuleActive) return;
    // Module logic...
  }
};
```

**Critical rules:**

- `isPreviousIterationFinished` prevents overlapping executions (race conditions)
- Randomized intervals (`setPause()`) avoid predictable API patterns
- Single-threaded by design — no parallelism within a module
- When disabled, iteration still runs (every ~3s) checking if reactivated

### 2. Module Loading & Dynamic Dependencies

Exchange-specific settings and APIs are loaded dynamically. **Never hardcode exchange names.**

```javascript
// ✅ CORRECT: Dynamic loading
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const TraderApi = require('./trader_' + config.exchange);
const traderapi = TraderApi(config.apikey, config.apisecret, ...);

// ❌ WRONG: Hardcoded exchange
const traderapi = require('./trader_binance')(apikey, apisecret);
```

### 3. Cross-Module Communication

**Regularly modules load other modules INSIDE methods, not at module level.** This prevents circular requires and allows feature toggling:

```javascript
// ✅ CORRECT: Load inside method (soft dependency)
async function updateOrderBook() {
  if (tradeParams.mm_isLiquidityActive) {
    const lp = require('./mm_liquidity_provider');
    await lp.updateLiquidityAfterPriceChange(side, callerName);
  }
}

// ❌ WRONG: Load at module level (hard dependency)
const lp = require('./mm_liquidity_provider');
```

For truly optional modules, use `utils.softRequire()`:

```javascript
const vv = utils.softRequire('./mm_volume_volatility');
if (vv && tradeParams.mm_isVolumeVolatilityActive) {
  const coefficient = vv.getVolumeVolatilityCoefficient();
}
```

### 4. Two-Account (2-Key) Trading

Some modules support a second exchange account (`config.apikey2` / `config.apisecret2`) to avoid self-trade restrictions:

```javascript
const TraderApi = require('./trader_' + config.exchange);
const traderapi = TraderApi(config.apikey, config.apisecret, ...);

let traderapi2;
if (config.apikey2) {
  traderapi2 = TraderApi(config.apikey2, config.apisecret2, ..., /* accountNo */ 2, ...);
  traderapi2.isSecondAccount = true;
}

const useSecondAccount = traderapi2 && !isPerpetual;
// Account 1 places maker order, Account 2 takes it
const makerApi = traderapi;
const takerApi = useSecondAccount ? traderapi2 : traderapi;
```

Modules with 2-account support: mm_trader, mm_price_maker, mm_quote_hunter, mm_twap, mm_cleaner, mm_fund_balancer.

### 5. Config vs TradeParams

| Aspect | `config` (configReader.js) | `tradeParams` |
| -------- | --------------------------- | --------------- |
| Source | `config.*.jsonc` | `tradeParams_{exchange}.js` |
| Mutability | **Immutable** after load | **Dynamic** — modified at runtime |
| Contains | API keys, exchange, pair, services | Feature flags, amounts, intervals, strategies |
| Modified by | Only on restart | User commands (`/enable`, `/params`), saved to file |
| Access | `require('./modules/configReader')` | `require('./settings/tradeParams_' + config.exchange)` |

**Important derived config properties:**

- `config.exchange` — lowercase exchange name
- `config.exchangeName` — original case exchange name
- `config.defaultPair` — `config.perpetual || config.pair`
- `config.coin1`, `config.coin2` — pair components
- `config.dev` — development mode flag
- `config.hasAdmPassphrase` — whether ADAMANT passphrase is configured
- `config.bot_id` — unique bot identifier (`pair@exchange-account`)

### 6. Features vs Order Purposes

**Features** (`botFeatures` in `commandTxs.js`) are user-controllable capabilities. **Order Purposes** are internal order type identifiers stored in `ordersDb`. They are NOT 1:1.

Some features create orders with a specific purpose. Some features DON'T have their own purpose — they modify behavior of other modules or set parameters.

| Feature | tradeParam | Purpose | Description |
| -------- | ----------- | --------- | ------------- |
| `t` | `mm_isTraderActive` | `t` | Making trading volume |
| `ob` | `mm_isOrderBookActive` | `ob`, `obs` | Dynamic order book building |
| `liq` | `mm_isLiquidityActive` | `liq` | Liquidity and spread maintenance |
| `sm` | `mm_isSpreadMaintainerActive` | `sm` | Spread maintainer |
| `ag` | `mm_isAntigapActive` | `ag` | Order book anti-gap |
| `cl` | `mm_isCleanerActive` | `cl` | Order book cleaner |
| `pw` | `mm_isPriceWatcherActive` | `pw` | Price watching |
| `ld` | `mm_isLadderActive` | `ld` | Ladder/grid trading |
| `qh` | `mm_isQuoteHunterActive` | `qh` | Quote hunter |
| `tw` | `t_isTwapActive` | `tw` | TWAP orders |
| `be` | `mm_isBalanceEqualizerActive` | `be` | Balance equalizer |
| `on` | `mm_isOrderNotifierActive` | — | Order notifier (monitoring only) |
| `bw` | `mm_isBalanceWatcherActive` | — | Balance watching (monitoring only) |
| `vc` | `mm_isVolatilityActive` | — | Volatility chart (modifies `t` behavior) |
| `vv` | `mm_isVolumeVolatilityActive` | — | Volume volatility (modifies `t` behavior) |
| `sp` | `mm_priceSupportLowPrice` | — | Support price (sets param to 0) |
| `pmv` | `mm_isPriceChangeVolumeActive` | — | PM/PW additional volume |
| `fb` | `mm_isFundBalancerActive` | — | Fund balancer (adjusts `mm_buyPercent`) |

Additional order purposes (not direct features): `fs` (fund supplier), `pm` (price maker), `tb` (trade bot manual), `man` (manual).

Each feature has a `requires` field for dependencies (e.g., `'vc'` requires `mm_isTraderActive`).

Query orders by purpose:

```javascript
const smOrders = await ordersDb.find({
  isProcessed: false,
  purpose: 'sm',
  pair: config.pair,
  exchange: config.exchange
});
```

### 7. Order Placement Flow

Every order placement must follow this sequence:

```javascript
// 1. Parse market for decimals
const { coin1Decimals, coin2DecimalsForStable } = orderUtils.parseMarket(pair);

// 2. Calculate amount and price
const amount = baseAmount.toFixed(coin1Decimals);
const price = quotePrice.toFixed(coin2DecimalsForStable);

// 3. Validate balance
const balanceCheck = await orderUtils.isEnoughCoins(
  side, formattedPair, baseAmount, quoteAmount, purpose, '', moduleName, api
);
if (!balanceCheck.result) {
  log.warn(`${moduleName}: ${balanceCheck.message}`);
  return;
}

// 4. Place order on exchange
const result = await traderapi.placeOrder(side, pair, price, amount, 1);
if (!result?.orderId) {
  log.warn(`${moduleName}: Failed to place ${side} order`);
  return;
}

// 5. Save to DB IMMEDIATELY
const order = new db.ordersDb({
  _id: result.orderId,
  side, pair, price: +price,
  coin1Amount: +amount, coin2Amount: quoteAmount,
  purpose, exchange: config.exchange, date: Date.now(),
  isProcessed: false
}, true); // true = save immediately

// 6. Clear cache
orderUtils.clearCache(`${moduleName}/functionName`);

// 7. Log success
log.info(`${moduleName}: Placed ${side} order for ${amount} ${coin1} at ${price} ${coin2}`);
```

### 8. Order Cancellation

**Always use `orderCollector.clearOrderById()` — it handles DB update, cache invalidation, and logging:**

```javascript
// ✅ CORRECT
const result = await orderCollector.clearOrderById(
  orderId, pair, side, `${moduleName}/reason`, reasonDescription, reasonObj, api
);

// ❌ WRONG — missing DB update, cache invalidation, logging
await traderapi.cancelOrder(orderId, side, pair);
```

### 9. Caching Pattern

Three caches in `orderUtils` for the primary account only:

```javascript
// Cache duration: constants.REST_DATA_CACHE_MS (1000ms)
orderUtils.getOpenOrdersCached(pair, moduleName)    // Open orders
orderUtils.getOrderBookCached(pair, moduleName)     // Order book
orderUtils.getBalancesCached(nonzero, moduleName)   // Balances
```

- Socket data bypasses cache when available
- Second account / perpetual API always makes fresh requests
- **Always clear cache after modifying orders**: `orderUtils.clearCache(callerName)`

### 10. Error Handling Pattern

```javascript
async function someFunction(param1, param2) {
  const paramString = `param1: ${param1}, param2: ${param2}`;

  try {
    const result = await traderapi.someMethod(param1, param2);

    if (!result || !result.success) {
      log.warn(`${moduleName}: Failed someMethod(${paramString})`);
      notify(`Failed operation`, 'warn', config.silent_mode);
      return;
    }

    log.info(`${moduleName}: Successfully executed someMethod(${paramString})`);

  } catch (e) {
    log.error(`Error in someFunction(${paramString}) of ${moduleName} module: ${e}`);
    notify(`Error in ${moduleName}`, 'error', config.silent_mode);
  }
}
```

---

## Reliability & Safety

### Exchange API Error Handling in Adapters

Each `trader_*.js` adapter has a `handleResponse()` function that classifies HTTP responses:

- **5xx, 429** — Temporary errors → reject → retry
- **401, 403** — Authentication errors → log error, check API keys
- **400** — Bad params → resolve with error data for caller to handle
- **200** — Success → process data

### False-Empty-List Protection

`orderUtils.updateOrders()` includes a safety heuristic:

1. If exchange returns 0 open orders but DB has many unprocessed orders → suspicious
2. Verifies via `getOrderDetails()` API if available
3. If confirmed suspicious → triggers `emergencyStop()` to pause all trading
4. Prevents accidentally marking all orders as filled when exchange API glitches

### Emergency Stop

`commandTxs.commands.emergencyStop(callerName, details)`:

- Sets `mm_isActive = false`
- Saves config immediately
- Sends **priority notification** via all channels
- Called by:
  - User command (`/emergency_stop`)
  - `orderUtils.updateOrders()` on suspicious API behavior
  - Bootstrap `checkInactivityPeriod()` if bot was offline too long

### Inactivity Protection

On startup, the bot checks a heartbeat file (`logs/heartbeat`):

- Written every 60 seconds during normal operation
- If the gap between last heartbeat and now exceeds `config.pauseAfterInactivity` (default: 6h):
  - Bot starts in **paused state** (emergency stop)
  - Prevents unexpected behavior after extended downtime
  - Operator must manually review and `/start`

---

## Data Flow & State Management

### Order State Lifecycle

Orders have these status flags:

| Field | When True |
| ------- | ----------- |
| `isProcessed` | Filled, cancelled, or disappeared from exchange |
| `isExecuted` | Filled or partly filled (has executed amount) |
| `isClosed` | Same as isProcessed — order is no longer active |
| `isCancelled` | Bot explicitly cancelled it |
| `isExpired` | Order lifetime exceeded |
| `isNotFound` | Missing from exchange's open orders list |

**Lifecycle:**

1. **Placed** → `{ isProcessed: false, isExecuted: false }`
2. **Partially filled** → `{ isProcessed: false, isExecuted: true }`
3. **Fully filled** → `{ isProcessed: true, isExecuted: true, isClosed: true, (isNotFound: true in exchange open orders) }`
4. **Cancelled by bot** → `{ isProcessed: true, isCancelled: true, isClosed: true }`

### Fills Processing Pipeline

```text
1. orderUtils.updateOrders() detects fills
   → fillsEngine.addFill() builds fill data
   → fillsEngine.addFillsDbRecord() saves to fillsDb { isProcessed: false }

2. Trade modules call fillsEngine.processFills():
   → Read unprocessed fillsDb records
   → Verify each fill via traderapi.getOrderDetails()
   → Confirmed fills: aggregate into filledStatsDb via MongoDB $inc
   → Mark fillsDb records as isProcessed: true

3. fillsEngine.getStats() returns VWAP metrics:
   → VWAP per side (buy/sell)
   → VWAP Spread
   → Cashflow PnL, Inventory change
   → Mark-to-Market PnL
```

### Fill Verification Policy

When `fillsEngine.verifyOrderFilled()` checks a fill via exchange API:

- No `getOrderDetails()` method → assume filled (can't disprove)
- Status `filled` → confirmed
- Status `new`/`part_filled`/`cancelled` → rejected (mistakenly marked)
- Status `unknown` → treat as confirmed (can't disprove)
- API failure → return `undefined` (retry later)

### Balance Tracking

```text
1. orderUtils.getBalancesCached() → exchange API → cache
2. balancesHistory.saveSnapshotIfChanged() → persist to DB
3. mm_balance_watcher.guardBalances() → compare to reference, alert on anomalies
```

---

## Module Reference

### Trade Modules

#### Volume & Trading

| Module | File | Purpose | Interval | Description |
| -------- | ------ | --------- | ---------- | ------------- |
| **Trader** | `mm_trader.js` | `t` | Configurable | Creates trading volume. Policies: `spread`, `orderbook`, `optimal`, `depth`, `wash`. Supports 2-account and perpetual. |
| **TWAP** | `mm_twap.js` | `tw` | Configurable | Time-Weighted Average Price execution. Splits large order over time. **Independent from `mm_isActive`** — runs even when bot is stopped. |

#### Order Book Management

| Module | File | Purpose | Interval | Description |
| -------- | ------ | --------- | ---------- | ------------- |
| **Order Book Builder** | `mm_orderbook_builder.js` | `ob` | 2-6s | Places/removes orders for dynamic, live-like order book. Supports perpetual. |
| **Order Book Spread** | `mm_orderbook_spread.js` | `obs` | 1-4s | Places orders ahead of detected big orders in the book. Spot only. |
| **Liquidity Provider** | `mm_liquidity_provider.js` | `liq` | 10-20s | Places orders deeper in book. Features: spread support, safe liquidity (VWAP-based), flowing liquidity. Spot only. |
| **Spread Maintainer** | `mm_spread_maintainer.js` | `sm` | 1-2min | Keeps bid-ask spread tight with short-lived orders (10-30min lifetime). Also called by other modules. Spot only. |
| **Anti-gap** | `mm_antigap.js` | `ag` | 15-25s | Fills gaps in order book where price intervals exceed average. Max 50 orders. Spot only. |

#### Price Management

| Module | File | Purpose | Interval | Description |
| -------- | ------ | --------- | ---------- | ------------- |
| **Price Watcher** | `mm_price_watcher.js` | `pw` | 15-30s | Monitors price within a range from various sources. Actions: `fill` (buy/sell to restore) or `prevent` (block other modules). Validates against InfoService. |
| **Price Maker** | `mm_price_maker.js` | — | 30s-1min | Drives price toward target. Supports 2-account. Has backstep logic for realistic charts. |
| **Volatility Chart** | `mm_volatility_chart.js` | — | — | Sets price trends mimicking top-coin charts. Works within Price Watcher's range. Sets targets for Price Maker. |
| **Volume Volatility** | `mm_volume_volatility.js` | — | 4-5min | Calculates volume coefficient (0.25×-4×) based on recent price changes. Adjusts mm_trader amounts. Spot only. |

#### Balance & Fund Management

| Module | File | Purpose | Interval | Description |
| -------- | ------ | --------- | ---------- | ------------- |
| **Cleaner** | `mm_cleaner.js` | `cl` | 4-9s | Anti-cheat: detects/removes small manipulation orders. Policies: `preventCheating`, `takeAll`, `minimumSpread`, `smallSpread`. Spot only. |
| **Quote Hunter** | `mm_quote_hunter.js` | `qh` | 5-10s | Accumulates quote currency by selling base at favorable rates. 2-account support. Spot only. |
| **Balance Equalizer** | `mm_balance_equalizer.js` | `be` | 1-3min | Keeps coin1/coin2 near-equal in USD value. Strategies: `bp` (adjust buyPercent) or `market` (place orders). Single-key only. Spot only. |
| **Fund Balancer** | `mm_fund_balancer.js` | — | 3-7min | Adjusts `mm_buyPercent` to keep coin2 balanced across 2 accounts. 2-key only. Spot only. |
| **Fund Supplier** | `mm_fund_supplier.js` | `fs` | 1-3min | Exchanges coins to maintain minimum balances for configured pairs. Uses `config.fund_supplier` settings. Spot only. |
| **Ladder** | `mm_ladder.js` | `ld` | — | Grid/ladder trading. When closest order fills, places mirrored order on opposite side. Supports two independent ladder instances (`ld1`, `ld2`). Complex state machine with `LADDER_STATES`. |

#### Monitoring

| Module | File | Purpose | Interval | Description |
| -------- | ------ | --------- | ---------- | ------------- |
| **Balance Watcher** | `mm_balance_watcher.js` | — | — | Compares current balances to reference timestamp. Alerts on abnormal coin2 decrease or expected value drop. No orders. |
| **Order Notifier** | `mm_order_notifier.js` | — | 5-15s | Monitors order book for significant third-party orders placed/removed. No orders. |

### Cross-Module Call Chain

Key inter-module dependencies (called inside methods, not at module level):

```text
mm_trader → mm_spread_maintainer.maintainSpreadAfterPriceChange()
mm_price_maker → mm_spread_maintainer.maintainSpreadAfterPriceChange()
mm_price_watcher → mm_spread_maintainer.maintainSpreadAfterPriceChange()
mm_quote_hunter → mm_spread_maintainer.maintainSpreadAfterPriceChange()
mm_spread_maintainer → mm_liquidity_provider.updateLiquidityAfterPriceChange()
orderUtils.getBalancesCached() → mm_balance_watcher.guardBalances() (via softRequire)
```

### Core Modules

| Module | File | Purpose |
| -------- | ------ | --------- |
| **configReader** | `modules/configReader.js` | Loads and validates `config.*.jsonc`. Immutable after load. Derives `config.exchange`, `config.pair`, `config.coin1/coin2`, etc. |
| **DB** | `modules/DB.js` | MongoDB connection, collection setup with indexes, migration runner. Exports collection helpers. |
| **commandTxs** | `modules/commandTxs.js` | Command parser for ADAMANT/Telegram/CLI/WebUI. 39+ commands, feature management, emergency stop, confirmation mechanism. |
| **adamantApi** | `modules/adamantApi.js` | ADAMANT blockchain integration and WebSocket for receiving commands. |
| **perpetualApi** | `modules/perpetualApi.js` | Singleton factory for perpetual/futures contract adapters. Loads from `trade/api/contract/{exchange}PerpetualApi.js`. Returns `null` if `config.perpetual` is falsy. |
| **Store** | `modules/Store.js` | Persistent state management via `systemDb`. Tracks last processed ADM block height, generic get/set for system fields. |
| **eventEmitter** | `modules/eventEmitter.js` | Event bus with one event: `'parameters:update'` — broadcast when config changes. |
| **botInterchange** | `modules/botInterchange.js` | Inter-bot communication via Socket.IO. Allows bots on different exchanges/pairs to coordinate. AES-encrypted. |
| **dbMigrations** | `modules/dbMigrations.js` | Schema migrations. Current: renames legacy `type` field to `side` in orders. Errors halt startup. |

### Helper Modules

| Module | File | Purpose |
| -------- | ------ | --------- |
| **const** | `helpers/const.js` | Time constants (MINUTE, HOUR, DAY), policy lists, regex patterns, thresholds, cache durations. |
| **utils** | `helpers/utils.js` | ~3600 lines of utilities: `parseSmartTime()`, `parseSmartNumber()`, `softRequire()`, `watchConfig()`, `saveConfig()`, logging helpers, math, formatting. |
| **log** | `helpers/log.js` | Logging with levels: `none < error < warn < info < log < debug < trace`. Writes to `./logs/{date}.log` with ANSI colors. Writes heartbeat file every 60s. |
| **notify** | `helpers/notify.js` | Multi-channel notifications: ADAMANT, Telegram, Slack, Discord, Email. Supports priority channels, silent mode, email aggregation. |
| **fillsEngine** | `helpers/fillsEngine.js` | Fill verification, VWAP calculation, PnL metrics. Cumulative stats from a reset point. |
| **dbModel** | `helpers/dbModel.js` | Lightweight ORM wrapper. Static: `find()`, `findOne()`, `count()`, `updateOne()`, `deleteOne()`, `aggregate()`. Instance: `save()`, `update()`. |
| **balancesHistory** | `helpers/balancesHistory.js` | Records balance snapshots to DB when changes are detected. |

### Exchange Adapter Interface

All `trader_*.js` files are factory functions with this signature:

```javascript
module.exports = (apiKey, secretKey, pwd, log, publicOnly, loadMarket,
                  useSocket, useSocketPull, accountNo, coin1, coin2) => { ... }
```

**Returned object methods:**

| Method | Purpose |
| -------- | --------- |
| `getMarkets(pair?)` | Fetch/cache trading pairs info |
| `getCurrencies(coin?)` | Fetch/cache currency info |
| `marketInfo(pair)` | Get cached market info for a pair |
| `features(pair?)` | Exchange capability flags |
| `getBalances(nonzero?, accountType?)` | Account balances |
| `getOpenOrders(pair)` | List open orders |
| `getOrderDetails(orderId, pair)` | Single order status |
| `placeOrder(side, pair, price, amount, limit, coin2Amount)` | Place buy/sell order |
| `cancelOrder(orderId, side, pair)` | Cancel one order |
| `cancelAllOrders(pair)` | Cancel all orders for pair |
| `getOrderBook(pair, limit)` | Order book depth |
| `getRates(pair)` | 24h ticker/rates |
| `getTradesHistory(pair, limit)` | Recent trades |
| `getCandlesHistory(pair, timeframe, since, limit)` | OHLCV candles |
| `getDepositAddress(coin)` | Deposit address |
| `getFees(coinOrPair)` | Trading/withdrawal fees |
| `transfer(coin, from, to, amount)` | Internal transfer |
| `withdraw(address, amount, coin, fee, network)` | External withdrawal |

**`features()` capability flags** include: `getMarkets`, `placeMarketOrder`, `selfTradeProhibited`, `orderNumberLimit`, `isDemo`, `supportTransferBetweenAccounts`, etc.

### Database Collections

```javascript
const db = require('./modules/DB');

db.ordersDb         // Orders: find(), findOne(), save(), updateOne(), count()
db.fillsDb          // Fill event log
db.filledStatsDb    // Persistent fill statistics (VWAP accumulators)
db.balancesHistory  // Balance snapshots (raw MongoDB collection)
db.systemDb         // System state (last block height, etc.)
db.incomingTxsDb    // ADAMANT commands
db.incomingTgTxsDb  // Telegram commands
db.incomingCLITxsDb // CLI commands
db.webTerminalMessages // Web UI messages (raw collection)
```

**DB Model methods** (from `helpers/dbModel.js`):

| Method | Type | Description |
| -------- | ------ | ------------- |
| `Model.find(query)` | Static | Returns array of Model instances |
| `Model.findOne(query)` | Static | Returns single Model instance or null |
| `Model.count(query)` | Static | Returns count |
| `Model.updateOne({ filter, update, options })` | Static | MongoDB updateOne |
| `Model.deleteOne(query)` | Static | Deletes one document |
| `Model.aggregate(pipeline)` | Static | MongoDB aggregation |
| `instance.save()` | Instance | Insert or upsert (depends on `_id` presence) |
| `instance.update(obj, shouldSave)` | Instance | Merge properties, optionally persist |

### Type System

Types are defined as JSDoc `@typedef` in `types/*.d.js` files (not TypeScript):

- **Generic exchange types**: `orders.d.js`, `depth.d.js`, `rates.d.js`, `markets.d.js`, `assets.d.js`, `fills.d.js`, etc.
- **Bot-internal types**: `types/bot/parsedMarket.d.js`, `types/bot/orderBookInfo.d.js`, `types/bot/orderMetrics.d.js`, etc.
- **Exchange-specific types**: `types/binance/`, `types/bybit/`, `types/kraken/`, etc.
- **Contract types**: `types/contracts/` — perpetual contract–specific types

### Custom Strategy System (`trade/cs/`)

Self-contained sub-application with its own `package.json`. Provides:

- Technical-indicator-based strategies (RSI, etc.)
- Backtesting with historical data
- Paper trading
- Live trading with configurable parameters
- Separate Web UI (`cs.ui`)

Managed by `trade/cs_manager.js`. Installed via `postinstall` script.

---

## Development Workflow

### Mandatory Connector Delivery Rules (AI Agents)

When creating or refactoring an exchange connector, AI agents MUST follow these rules:

1. Add detailed JSDoc and typedef usage from `types/*.d.js` in both API and trader connector files.
2. Create exchange-specific endpoint response types under `types/{exchange}/` with realistic `@example` blocks.
3. Add direct official endpoint documentation links in JSDoc for each API method.
4. Avoid permissive fallback masking (`?.list || []`) that hides malformed responses; validate shape explicitly.
5. Use `marketInfo()` metadata in candles normalization code.
6. Use exchange bulk cancellation endpoint for `cancelAllOrders()` when available.
7. Reuse helper logic from `helpers/utils.js`; if generic helper is missing, extract it there.
8. Provide detailed test evidence (raw exchange payload + normalized output), including all `getOrderDetails` status mappings: `unknown`, `new`, `filled`, `part_filled`, `cancelled`.
9. Save test result reports to separate files for each mode: `.ai-tasks/test-results/YYYY-MM-DD (TestXXX-mock) ... .md` for mock runs and `.ai-tasks/test-results/YYYY-MM-DD (TestXXX-live) ... .md` for live runs.
10. `trade/settings/tradeParams_{exchange}.js` must be a full copied object (no re-export from `tradeParams_Default`).
11. Keep all Markdown docs lint-clean; follow markdownlint rules (including `MD022`, `MD032`, `MD007`, `MD034`, `MD040`).
12. Do not use ambiguous `default` typedef names in exchange-specific types; use human-readable exchange-prefixed names (for example, `DextradeSymbols`, `DextradeOrder`) and import them explicitly.
13. In one-line parameter/property/list descriptions use no trailing period for a single sentence. If description contains two or more sentences, keep terminal periods for each sentence.

### Commands

```bash
npm start              # Production (uses config.default.jsonc or config.jsonc)
npm run start:config -- <name>  # Run with custom config name: config.<name>.jsonc
npm run start:dev      # Development (uses config.dev.jsonc, config.dev = true)
npm run cli            # CLI mode (interactive commands, no ADAMANT passphrase)
npm run cli:config -- <name>    # CLI mode with custom config name
npm run cli:dev        # CLI mode with dev config
npm run clear          # Clear database (drops all collections) for default config
npm run clear:config -- <name> clear_db  # Clear database for custom config
npm test               # Run Jest tests
npm run lint           # ESLint check (visualstudio format)
npm run lint:fix       # ESLint auto-fix
```

### Config File Selection

The bot selects config based on CLI argument:

- `npm start` → `config.default.jsonc`
- `npm run start:config -- {name}` → `config.{name}.jsonc`
- `npm run start:dev` → `config.dev.jsonc` (treated as dev config)
- `node app.js {name}` → `config.{name}.jsonc` (direct launch, equivalent to `start:config`)

### Adding a New Exchange

See the comprehensive **[Exchange Connector Guide](exchange-connector-guide.md)** for step-by-step instructions covering:

- Plain API client (`trade/api/{exchange}_api.js`) with `handleResponse()`, `publicRequest()`, `protectedRequest()`
- Error descriptions file (`trade/api/{exchange}_errors.js`)
- Trader adapter (`trade/trader_{exchange}.js`) with all required methods and return shapes
- Config registration and exchange name setup
- Testing each method individually (request processing, balances, orders, trades, etc.)
- WebSocket connector (public, private, pull)
- Perpetual/Futures connector with module compatibility matrix
- Automated Jest tests with mock adapter
- MM simulation testing

**Quick summary:**

1. **Create API client**: `trade/api/{exchange}_api.js` + `trade/api/{exchange}_errors.js`
2. **Create trader adapter**: `trade/trader_{exchange}.js` — implement all methods from the [Exchange Adapter Interface](#exchange-adapter-interface)
3. **Create config**: `config.{exchange}_test.jsonc`
4. **Add exchange name** to the `exchanges` array in `config.default.jsonc`
5. **(Optional)** Create exchange-specific trade params override: `trade/settings/tradeParams_{exchange}.js`
6. **Test**: `node app.js {config_name}` — follow the testing checklist in the guide

### File Structure

```text
adamant-tradebot-me/
├── app.js                         # Bootstrap entry point
├── config.*.jsonc                 # Exchange-specific configs (immutable)
├── package.json
├── api/                           # Web UI API (REST endpoints)
├── bin/
│   └── cli.js                     # CLI entry point
├── helpers/
│   ├── const.js                   # Constants (time, thresholds, policies)
│   ├── log.js                     # Logging + heartbeat
│   ├── notify.js                  # Multi-channel notifications
│   ├── utils.js                   # Utilities (~3600 lines)
│   ├── fillsEngine.js             # Fill verification, VWAP
│   ├── dbModel.js                 # Lightweight MongoDB ORM
│   └── balancesHistory.js         # Balance snapshots
├── modules/
│   ├── configReader.js            # Config loader (immutable)
│   ├── DB.js                      # MongoDB setup + migrations
│   ├── commandTxs.js              # Command parser + features
│   ├── adamantApi.js              # ADAMANT blockchain integration
│   ├── perpetualApi.js            # Perpetual contracts API factory
│   ├── Store.js                   # Persistent system state
│   ├── eventEmitter.js            # Event bus
│   ├── botInterchange.js          # Inter-bot communication
│   └── dbMigrations.js            # DB schema migrations
├── trade/
│   ├── mm_*.js                    # Market-making modules (18 modules)
│   ├── trader_*.js                # Exchange API adapters (40+ exchanges)
│   ├── orderCollector.js          # Order cancellation/cleanup
│   ├── orderUtils.js              # Order helpers, caching, balance checks
│   ├── orderStats.js              # Statistics aggregation
│   ├── cs_manager.js              # Custom strategy manager
│   ├── api/                       # Exchange-specific API clients
│   │   ├── binance_api.js
│   │   └── contract/              # Perpetual contract adapters
│   └── settings/
│       ├── tradeParams_Default.js # Template for trade parameters
│       └── tradeParams_*.js       # Exchange-specific overrides
├── telegramBot/                   # Telegram bot integration
├── types/                         # JSDoc type definitions (.d.js)
│   ├── bot/                       # Bot-internal types
│   ├── contracts/                 # Contract-specific types
│   ├── binance/, bybit/, ...      # Exchange-specific raw API types
│   └── *.d.js                     # Generic exchange types
└── .github/
    └── ai-agent-instructions.md   # This file
```

### Code Style

- ESLint with Google config + custom rules
- Single quotes, template literals allowed
- Max line length: 133 (excluding comments, strings, URLs)
- Prefer arrow callbacks, object shorthand
- `eqeqeq: 'always'` — strict equality
- Ignored paths: `trade/settings/`, `trade/tests/`, `trade/cs/test/`

---

## Common Pitfalls

### ❌ Hardcoding Exchange Names

```javascript
// ❌ WRONG
const traderapi = require('./trader_binance')(...);

// ✅ CORRECT
const traderapi = require('./trader_' + config.exchange)(...);
```

### ❌ Placing Orders Without DB Save

```javascript
// ❌ WRONG — no DB persistence, system loses track
const result = await traderapi.placeOrder(side, pair, price, amount);

// ✅ CORRECT — save immediately
const result = await traderapi.placeOrder(side, pair, price, amount);
const order = new db.ordersDb({ _id: result.orderId, ... }, true);
```

### ❌ Skipping `isPreviousIterationFinished`

```javascript
// ❌ WRONG — overlapping iterations cause race conditions
async iteration() {
  await this.doWork();
  setTimeout(() => this.iteration(), interval);
}

// ✅ CORRECT
if (isPreviousIterationFinished) {
  isPreviousIterationFinished = false;
  await this.doWork();
  isPreviousIterationFinished = true;
}
```

### ❌ Mixing Perpetual and Spot

```javascript
// ❌ WRONG — always using spot API
const traderapi = require('./trader_' + config.exchange)(...);

// ✅ CORRECT — check config.perpetual
const isPerpetual = Boolean(config.perpetual);
const traderapi = isPerpetual
  ? require('./modules/perpetualApi')()
  : TraderApi(config.apikey, config.apisecret, ...);
```

### ❌ Wrong Decimals

```javascript
// ❌ WRONG — hardcoded decimals
const amount = baseAmount.toFixed(8);

// ✅ CORRECT — use parsed market info
const { coin1Decimals } = orderUtils.parseMarket(pair);
const amount = baseAmount.toFixed(coin1Decimals);
```

### ❌ Forgetting Cache Invalidation

```javascript
// ❌ WRONG — stale cache after modification
await traderapi.placeOrder(side, pair, price, amount);

// ✅ CORRECT — invalidate cache
await traderapi.placeOrder(side, pair, price, amount);
orderUtils.clearCache(`${moduleName}/placedOrder`);
```

### ❌ Hard Dependencies at Module Level

```javascript
// ❌ WRONG — creates hard dependency, prevents feature toggling
const lp = require('./mm_liquidity_provider');

// ✅ CORRECT — soft dependency inside method
if (tradeParams.mm_isLiquidityActive) {
  const lp = require('./mm_liquidity_provider');
  await lp.updateLiquidityAfterPriceChange(side, callerName);
}
```

### ❌ Confusing Feature and Purpose

```javascript
// ❌ WRONG — 'vc' feature has no order purpose
const orders = await db.ordersDb.find({ purpose: 'vc' }); // No such purpose!

// ✅ CORRECT — 'vc' modifies trader behavior
const coefficient = require('./mm_volatility_chart').getVolatilityCoefficient();
```

### ❌ Logging Sensitive Data

```javascript
// ❌ WRONG — never log API keys or passphrases
log.log(`API keys: ${config.apikey}, ${config.apisecret}`);

// ✅ CORRECT
log.log(`Using exchange: ${config.exchangeName}`);
```

---

## Refactoring Guidance

### Codebase Maturity

This is a **mixed maturity codebase**:

**Modern patterns** (refactored):

- JSDoc type annotations (`@typedef`, `@param`, `@returns`)
- Soft dependencies via `utils.softRequire()`
- Clean error handling with module name and param details
- Dynamic exchange loading

**Legacy patterns** (pre-refactor):

- Procedural code with loose coupling
- Implicit dependencies / global state assumptions
- Minimal type hints
- Inconsistent error handling

### Refactoring Rules

**Bring all code toward modern patterns incrementally:**

1. **Add JSDoc** type annotations when touching old code
2. **Extract soft dependencies** — replace module-level `require()` with in-method loading
3. **Add parameter validation** and informative error messages
4. **Use `utils.softRequire()`** for optional feature modules
5. **Enhance log messages** with context (module name, function, parameters)

**Don't** do large refactors in one PR — each touch should incrementally improve consistency.

### When Adding New Features

- Use the iteration loop pattern
- Add a `tradeParams` flag for enabling/disabling
- Register as a `botFeature` in `commandTxs.js` if user-controllable
- Add a unique order purpose if the feature places orders
- Follow the error handling pattern with module name context
- Clear cache after any order modifications
- Support perpetual mode if applicable (check `config.perpetual`)

---

## Quick Reference

### Key Files

| File | Purpose |
| ------ | --------- |
| `app.js` | Bootstrap entry point |
| `modules/configReader.js` | Config loader (immutable) |
| `modules/DB.js` | Database setup |
| `modules/commandTxs.js` | Command parser, features |
| `trade/orderUtils.js` | Order placement, caching, balance checks |
| `trade/orderCollector.js` | Order cancellation/cleanup |
| `trade/orderStats.js` | Statistics aggregation |
| `helpers/fillsEngine.js` | Fill verification, VWAP |
| `helpers/const.js` | Constants |
| `helpers/utils.js` | Utilities |
| `helpers/log.js` | Logging |
| `helpers/notify.js` | Multi-channel notifications |
| `helpers/dbModel.js` | DB ORM wrapper |
| `trade/settings/tradeParams_Default.js` | Trade params template |

### Important Constants

```javascript
constants.HOUR   = 3_600_000   // 60 * 60 * 1000
constants.MINUTE = 60_000      // 60 * 1000
constants.DAY    = 86_400_000  // 24 * 60 * 60 * 1000
constants.REST_DATA_CACHE_MS = 1000  // Cache duration for REST data
constants.MM_POLICIES = ['optimal', 'spread', 'orderbook', 'depth', 'wash']
```

### Feature Flags

```javascript
tradeParams.mm_isActive                  // Master kill switch
tradeParams.mm_isTraderActive            // Volume maker
tradeParams.mm_isOrderBookActive         // Order book builder
tradeParams.mm_isLiquidityActive         // Liquidity provider
tradeParams.mm_isPriceWatcherActive      // Price watcher
tradeParams.mm_isPriceMakerActive        // Price maker
tradeParams.mm_isCleanerActive           // Cleaner
tradeParams.mm_isAntigapActive           // Anti-gap
tradeParams.mm_isLadderActive            // Ladder
tradeParams.mm_isSpreadMaintainerActive  // Spread maintainer
tradeParams.mm_isQuoteHunterActive       // Quote hunter
tradeParams.mm_isBalanceEqualizerActive  // Balance equalizer
tradeParams.mm_isBalanceWatcherActive    // Balance watcher
tradeParams.mm_isVolatilityActive        // Volatility chart
tradeParams.mm_isVolumeVolatilityActive  // Volume volatility
tradeParams.mm_isOrderNotifierActive     // Order notifier
tradeParams.mm_isFundBalancerActive      // Fund balancer (2-key)
t_isTwapActive                           // TWAP (independent of mm_isActive)
```

### Order Purposes

`t` (trader), `ob` (orderbook), `obs` (orderbook spread), `liq` (liquidity), `sm` (spread), `ag` (antigap), `cl` (cleaner), `pw` (price watcher), `pm` (price maker), `qh` (quote hunter), `ld` (ladder), `tw` (twap), `be` (balance equalizer), `fs` (fund supplier), `tb` (trade bot), `man` (manual)

---

## Communication

- Developers communicate with AI in **any language**
- ALL code, documentation, comments, commit messages **MUST be in English**
- Use clear, descriptive variable/function names
- Add comments for non-obvious logic
