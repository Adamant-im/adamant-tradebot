# AI Agent Instructions for ADAMANT Market-Making Bot (Open-Source Edition)

**Target Audience**: AI Coding Assistants (GitHub Copilot, Claude, Cursor, Windsurf, etc.)

**Language Policy**: Developers communicate with AI in any language (English, Russian, etc.), but ALL code, documentation, comments, and commit messages MUST be in English only.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Development Priorities](#development-priorities)
3. [Architecture & Directory Structure](#architecture--directory-structure)
4. [Critical System Patterns](#critical-system-patterns)
5. [Reliability & Safety](#reliability--safety)
6. [Supported Features & Modules](#supported-features--modules)
7. [Development Workflow & Testing](#development-workflow--testing)
8. [Common Pitfalls](#common-pitfalls)

---

## Project Overview

### What Is This Bot?

ADAMANT Trading Bot (Open-Source Edition) is a **self-hosted market-making bot** for cryptocurrency exchanges. It manages orders across supported exchanges to:

- **Create trading volume** via wash trading in spread or order book (`mm_trader`)
- **Build dynamic order books** with high-frequency live-like order placement (`mm_orderbook_builder`)
- **Maintain spread and liquidity** with order book depth orders (`mm_liquidity_provider`)
- **Watch and defend token prices** — monitor price bounds against reference markets (`mm_price_watcher`)

**Website**: <https://marketmaking.app/>  
**Repository**: <https://github.com/Adamant-im/adamant-tradebot>

### Free vs Premium Builds

This repository is the **Free open-source edition** of ADAMANT TradeBot:
- **Core modules**: 4 market-making modules (`trader`, `orderbook_builder`, `liquidity_provider`, `price_watcher`)
- **Supported exchanges**: Spot connectors for Azbit, Coinstore, FameEXnet, NonKYC, P2PB2B, StakeCube
- **Control channels**: ADAMANT Messenger (bot commands), `mm` CLI (process lifecycle, status, diagnostics)
- **Limitations**: Spot only (no perpetual or DEX), single exchange account, no ComServer, no Telegram management, no interactive CLI bot commands, base depth liquidity without Safe Liquidity or Spread Support, no Support Price (`sp`)

### Technology Stack

- **Runtime**: Node.js >=22.12.0 (see `package.json`)
- **Database**: MongoDB 7 (with schema migrations)
- **Language**: JavaScript (CommonJS modules, ES2021)
- **Types**: JSDoc `@typedef` in `.d.js` files (not TypeScript `.d.ts`)
- **Exchange APIs**: Custom adapters (`trade/trader/trader_*.js`)
- **Architecture**: Single-threaded event loop with scheduled iterations

---

## Development Priorities

These priorities guide ALL development decisions:

1. **Reliability (Critical)**: The bot must never crash. Always wrap exchange API calls in try-catch. Skip overlapping iterations using `helpers/moduleIteration.js` and reschedule from `finally`.
2. **Data Consistency (Critical)**: Local MongoDB state must match exchange state. Invalidate caches aggressively (`orderUtils.clearCache()`) and always check balances before placing orders (`orderUtils.isEnoughCoins()`).
3. **Safety (Critical)**: Validate positive amounts and prices. Respect exchange precision (`coin1Decimals`, `coin2Decimals`) and min/max limits. Never place orders exceeding available balances.
4. **Modularity & Exchange Agnosticism**: Never hardcode exchange names; use `config.exchange` dynamically. Use `utils.softRequire()` for optional submodules.
5. **Observability**: Include module name, function name, and context parameters in all logs. Use proper log levels: `.log()` for normal flow, `.warn()` for recoverable issues, `.error()` for failures.

---

## Architecture & Directory Structure

In version 10.0.0, the repository follows a structured layout:

```text
adamant-tradebot/
├── config/                  # Named configs (config.<name>.jsonc); project root is fallback
│   └── .gitkeep
├── config.default.jsonc     # Template configuration in project root
├── trade/
│   ├── trader/              # Exchange connectors (trader_azbit.js, trader_fameexnet.js, …)
│   ├── features/            # MM modules (mm_trader.js, mm_orderbook_builder.js, …)
│   ├── api/                 # Low-level REST/HTTP exchange clients
│   ├── settings/            # Runtime dynamic parameters (tradeParams_<exchange>.js)
│   ├── orderUtils.js        # Order placement, balance checking, memory cache
│   ├── orderCollector.js    # Order cancellation and cleanup
│   └── orderStats.js        # Order counts and volume statistics
├── helpers/                 # Shared utilities (moduleIteration, logRotation, log, utils, …)
├── modules/                 # Bot core (configReader, DB, commandTxs, commands/, …)
├── api/                     # Private WebUI REST & WebSocket API server
├── routes/                  # Health & debug HTTP routes
└── tests/                   # Scoped Jest test suites
```

---

## Critical System Patterns

### 1. Iteration Loop Pattern

Feature modules (`trade/features/mm_*.js`) must follow this exclusive execution pattern:

```javascript
const {
  IDLE_INTERVAL_MS,
  createIterationLock,
  runExclusiveIteration,
  rescheduleIteration,
} = require('../../helpers/moduleIteration');

const moduleName = 'mm_moduleName';
const iterationLock = createIterationLock();

module.exports = {
  run() {
    this.iteration();
  },

  async iteration() {
    let delay = IDLE_INTERVAL_MS;

    try {
      const interval = setPause();
      if (interval && tradeParams.mm_isActive && tradeParams.mm_isModuleActive) {
        delay = interval;
        await runExclusiveIteration({
          moduleName,
          lock: iterationLock,
          work: () => this.doWork(),
          onBusy: () => log.warn(`${moduleName}: Postponing iteration. Previous still in progress.`),
        });
      }
    } catch (e) {
      log.error(`Error in ${moduleName} iteration: ${e}`);
    } finally {
      // Always reschedule the next tick
      rescheduleIteration(() => this.iteration(), delay);
    }
  },

  async doWork() {
    if (!tradeParams.mm_isActive || !tradeParams.mm_isModuleActive) return;
    // Feature logic...
  },
};
```

### 2. Soft Dependencies (`utils.softRequire`)

Optional components use `utils.softRequire(moduleName, fromFile?)`:
- Relative paths resolve from the caller file's directory.
- Returns `undefined` if the module does not exist, without throwing.

```javascript
// trade/features/mm_trader.js
const sm = utils.softRequire('./mm_spread_maintainer');
if (sm) {
  await sm.maintainSpreadAfterPriceChange();
}
```

### 3. Dynamic Exchange Loading

Never import an exchange adapter statically. Load dynamically via `config.exchange`:

```javascript
const TraderApi = require('../trader/trader_' + config.exchange);
const traderapi = TraderApi(config.apikey, config.apisecret, config.apipassword, log, ...);
```

---

## Reliability & Safety

- **Balance Validation**: Check available funds via `orderUtils.isEnoughCoins()` prior to placing orders.
- **Cache Invalidation**: Call `orderUtils.clearCache()` after placing or cancelling orders so subsequent checks get updated exchange state.
- **Inactivity Guard**: On bootstrap, `checkInactivityPeriod()` checks the heartbeat file. If the bot was offline longer than `config.pauseAfterInactivity`, it triggers `/emergency_stop` to prevent placing stale orders.
- **Process Supervisor**: Automatic process restart on error requires PM2 or Docker. Direct `node app.js` runs exit with code 1 after repeated iteration timeouts.

---

## Supported Features & Modules

The open-source edition includes 4 core market-making features:

| Module | File | Purpose Code | Description |
|--------|------|--------------|-------------|
| **Trader** | `trade/features/mm_trader.js` | `t` | Generates wash trading volume within spread or order book |
| **Order Book Builder** | `trade/features/mm_orderbook_builder.js` | `ob` | Places and updates dynamic bid/ask orders for a realistic book |
| **Liquidity Provider** | `trade/features/mm_liquidity_provider.js` | `liq` | Places depth liquidity orders within configured spread percentage |
| **Price Watcher** | `trade/features/mm_price_watcher.js` | `pw` | Enforces price bounds against reference markets |

---

## Development Workflow & Testing

- **Engine Requirement**: Node.js `>=22.12.0`.
- **Install Dependencies**: `npm i`
- **Linting**: `npm run lint` (ESLint)
- **Type Checking**: `npm run typecheck:webui-api` (TypeScript compiler in check mode for JSDoc `@typedef`)

### Running Tests

Never run a bare `npm test` or `npx jest`. Use scoped test commands:

```bash
npm run test:general     # Utils, configPaths, tradeParams
npm run test:api-webui   # WebUI REST and WebSocket API
npm run test:features    # Price watcher unit tests
npm run test:trader      # Mocked exchange connector tests (Azbit, FameEXnet)
JEST_SCOPE=1 npx jest tests/helpers tests/mm  # Helper utilities and MM CLI tests
```

To run a specific test file:
```bash
npm test -- tests/trader/trader_azbit.test.js
```
