# AI Agent Instructions for ADAMANT Tradebot OSS

**Target audience**: AI coding assistants working inside this repository.

**Language policy**: Developers may talk to the agent in any language, but code, comments, docs, and commit messages must stay in English.

## Scope

This repository is the open-source base version of the bot.

Do not treat it as the Premium product and do not reintroduce claims or design assumptions that are not implemented here. In particular:

- Do not describe this repo as the closed-source or full-featured version
- Do not assume 40+ exchanges, Web UI, custom strategy sub-apps, futures or perpetual trading, or mandatory WebSocket connectors
- Do not reference premium-only modules or workflows unless the code is present in this repository
- Prefer the real code layout in `app.js`, `modules/`, `routes/`, and `trade/` over copied historical docs

The OSS branch should be documented as a smaller, REST-first, spot-focused bot.

## Project Overview

ADAMANT Tradebot is a self-hosted market-making bot for centralized crypto exchanges. In this repository it focuses on the base market-making workflow:

- placing and cancelling orders
- generating trading volume
- maintaining spread and liquidity
- building an order book
- watching and reacting to price ranges

The current open-source version is intentionally narrower than the commercial product line. Keep new docs and code aligned with that fact.

## Technology Snapshot

- Runtime: Node.js `>=18.18`
- Package manager: npm `>=9.0.1`
- Language: JavaScript, CommonJS modules
- Database: MongoDB
- API server: Express for debug and health routes
- Typing style: JSDoc with `.d.js` files under `types/`

## What Actually Starts

The real bootstrap flow is in `app.js`.

### Startup sequence

1. Load config through `modules/configReader.js`
2. Initialize database through `modules/DB.js`
3. If ADAMANT credentials are configured, initialize the socket command pipeline through `modules/api.js` and `modules/incomingTxsParser.js`
4. If `config.api.port` is set, start the Express API from `routes/init.js`
5. Start the active trade modules:
   - `trade/mm_trader.js`
   - `trade/mm_orderbook_builder.js`
   - `trade/mm_liquidity_provider.js`
   - `trade/mm_price_watcher.js`
6. In dev mode, also run `trade/tests/manual.test.js`

Do not document startup services that are not actually initialized by this branch.

## Architecture Map

```text
app.js
├── modules/configReader.js
├── modules/DB.js
├── modules/api.js + modules/incomingTxsParser.js   # ADAMANT command intake when configured
├── routes/init.js                                  # health/debug HTTP routes
└── trade/
    ├── mm_trader.js
    ├── mm_orderbook_builder.js
    ├── mm_liquidity_provider.js
    ├── mm_price_watcher.js
    ├── orderCollector.js
    ├── orderStats.js
    ├── orderUtils.js
    ├── trader_*.js
    ├── api/*_api.js
    └── settings/tradeParams_*.js
```

## Development Priorities

When making changes, use these priorities in order.

### 1. Reliability

The bot must keep running even when an exchange or a helper call misbehaves.

- Wrap exchange calls in defensive error handling
- Prefer returning `undefined` over fabricated data when request processing fails
- Do not introduce unhandled promise rejections
- Preserve iteration-loop guards such as `isPreviousIterationFinished`

### 2. Exchange State Consistency

Local state must track exchange state closely enough to keep orders safe.

- Save placed orders immediately to the database
- Clear cached balances and orders after order mutations
- Do not silently convert bad API responses into empty arrays or empty objects
- Prefer explicit status normalization over permissive fallbacks

### 3. Trading Safety

The bot should avoid placing orders with wrong price, amount, or balance assumptions.

- Always use market metadata for decimals and minimums
- Validate positive numeric inputs before exchange calls
- Respect exchange limits when they are known
- Do not exceed available balances

### 4. Minimalism

The OSS branch should stay small and understandable.

- Prefer the smallest useful interface
- Do not add premium abstractions preemptively
- Do not add socket or perpetual scaffolding to a basic connector

## Critical Code Patterns

### Dynamic loading by exchange

Exchange-specific modules are loaded dynamically. Do not hardcode exchange names outside exchange-specific files.

```javascript
const TraderApi = require('./trader_' + config.exchange);
const traderapi = TraderApi(
  config.apikey,
  config.apisecret,
  config.apipassword,
  log,
  undefined,
  undefined,
  config.exchange_socket,
  config.exchange_socket_pull,
);
```

### Iteration loops

Trade modules use timed loops with overlap protection.

```javascript
let isPreviousIterationFinished = true;

async function iteration() {
  if (isPreviousIterationFinished) {
    isPreviousIterationFinished = false;

    try {
      await doWork();
    } catch (error) {
      log.error(`Iteration failed: ${error}`);
    } finally {
      isPreviousIterationFinished = true;
    }
  }

  setTimeout(iteration, setPause());
}
```

Do not remove these guards during refactors.

### Two-stage adapter error handling

In `trade/trader_*.js`, keep request execution and payload normalization in separate `try/catch` blocks.

```javascript
async function getBalances(nonzero = true) {
  let balances;

  try {
    balances = await exchangeApiClient.getBalances();
  } catch (error) {
    log.warn(`API request getBalances() failed. ${error}`);
    return undefined;
  }

  try {
    return balances
      .map((asset) => ({
        code: asset.code,
        free: +asset.free,
        freezed: +asset.freezed,
        total: +asset.total,
      }))
      .filter((asset) => !nonzero || asset.free || asset.freezed);
  } catch (error) {
    log.warn(`Error while processing getBalances() response: ${error}`);
    return undefined;
  }
}
```

### Shared markets and currencies cache

Current adapters commonly cache metadata on `module.exports`.

```javascript
module.exports.exchangeMarkets = {};
module.exports.exchangeCurrencies = {};
module.exports.gettingMarkets = false;
module.exports.gettingCurrencies = false;
```

Preserve this pattern unless you are intentionally refactoring all call sites that depend on it.

## Exchange Connector Expectations in OSS

This branch is centered on basic spot REST connectors.

### Baseline assumptions

- Spot only
- REST first
- No mandatory WebSocket support
- No perpetual or futures support
- No requirement to implement every advanced account or funding method on day one

### Baseline adapter surface

For new or refreshed connectors, prefer this minimal surface first:

- `features()`
- `getMarkets()`
- `marketInfo()`
- `getBalances()`
- `getOpenOrders()`
- `getOrderDetails()`
- `placeOrder()`
- `cancelOrder()`
- `cancelAllOrders()`
- `getRates()`
- `getOrderBook()`
- `getTradesHistory()`

Optional methods may be added later when the exchange API and OSS command surface need them:

- `getCurrencies()` and `currencyInfo()`
- `getDepositAddress()`
- `getFees()`
- `withdraw()`
- fund history and transfer helpers

The full factory signature should still stay compatible with existing call sites even if some arguments are unused by a REST-only connector:

```javascript
module.exports = (
  apiKey,
  secretKey,
  pwd,
  log,
  publicOnly = false,
  loadMarket = true,
  useSocket = false,
  useSocketPull = false,
  accountNo = 0,
  coin1 = config.coin1,
  coin2 = config.coin2,
) => {
  // REST-only connector may ignore socket-related arguments
};
```

## `features()` Flags That Matter Here

Keep `features()` focused on fields the OSS code actually checks.

Commonly relevant flags:

- `getMarkets`
- `getCurrencies`
- `placeMarketOrder`
- `allowAmountForMarketBuy`
- `amountForMarketOrderNecessary`
- `getDepositAddress`
- `createDepositAddressWithWebsiteOnly`
- `supportCoinNetworks`
- `supportCoinNetworksRestricted`
- `getTradingFees`
- `getAccountTradeVolume`
- `getFundHistory`
- `getFundHistoryImplemented`
- `supportTransferBetweenAccounts`
- `accountTypes`
- `tradingAccountType`
- `orderNumberLimit`
- `selfTradeProhibited`
- `apiProcessingDelayMs`

For the OSS baseline, WebSocket-related flags should default to disabled unless the code is really implemented:

```javascript
features() {
  return {
    getMarkets: true,
    getCurrencies: false,
    placeMarketOrder: false,
    allowAmountForMarketBuy: false,
    amountForMarketOrderNecessary: false,
    getDepositAddress: false,
    createDepositAddressWithWebsiteOnly: false,
    supportCoinNetworks: false,
    supportCoinNetworksRestricted: false,
    getTradingFees: false,
    getAccountTradeVolume: false,
    getFundHistory: false,
    getFundHistoryImplemented: false,
    supportTransferBetweenAccounts: false,
    accountTypes: false,
    tradingAccountType: 'trade',
    orderNumberLimit: undefined,
    selfTradeProhibited: false,
    apiProcessingDelayMs: undefined,
    socketSupport: false,
    socketPullSupport: false,
    socketEnabled: false,
  };
}
```

## Files You Should Trust First

When you need source-of-truth behavior, inspect these files first:

- `app.js`
- `modules/configReader.js`
- `modules/commandTxs.js`
- `trade/orderUtils.js`
- `trade/orderCollector.js`
- `trade/mm_trader.js`
- `trade/mm_orderbook_builder.js`
- `trade/mm_liquidity_provider.js`
- `trade/mm_price_watcher.js`
- one of the existing `trade/trader_*.js` files closest to the exchange you are adding

## Commands

Use the real npm scripts from `package.json`.

```bash
npm start
npm run start:dev
npm run clear
npm test
npm run lint
npm run lint:fix
```

For custom configs, the runtime also supports direct invocation through `node app.js <name>` because `modules/configReader.js` resolves `config.<name>.jsonc`.

## Documentation Rules for This Repo

- Document the OSS branch only
- Prefer concrete statements tied to files that exist
- If a capability is optional or exchange-specific, label it that way
- If current adapters vary a little, say so directly instead of pretending the interface is already perfectly uniform
- Do not add Premium marketing language to internal engineering docs

## Common Mistakes to Avoid

### Inventing missing subsystems

Do not add docs that assume this branch has:

- perpetual or futures APIs
- required WebSocket layers
- a full Web UI application
- premium-only coordination or custom-build infrastructure

### Hardcoding exchange names

```javascript
// Wrong
const traderapi = require('./trader_binance')(...);

// Correct
const traderapi = require('./trader_' + config.exchange)(...);
```

### Returning fake-safe values

Avoid patterns like `response?.list || []` when a malformed payload should instead fail loudly and return `undefined`.

### Skipping immediate order persistence

If a change touches order placement flow, make sure the created order is still stored immediately and caches are invalidated.

## Connector Guide

Use `exchange-connector-guide.md` as the preferred guide for new OSS connectors.

That guide intentionally describes the target baseline for this repository:

- plain REST API client
- spot trader adapter
- minimal method surface first
- optional extensions later

It does not treat WebSocket or perpetual support as part of the default connector definition.
