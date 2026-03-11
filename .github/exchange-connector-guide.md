# AI Guide: Creating and Testing a New Exchange Connector

**Target Audience**: AI Coding Assistants (GitHub Copilot, Claude, Cursor, Windsurf, etc.)

This guide provides step-by-step instructions for implementing and testing a complete exchange connector for the ADAMANT Trading Bot. It covers Spot REST, WebSocket, and Futures/Perpetual connectors.

**Prerequisites**: Read [ai-agent-instructions.md](ai-agent-instructions.md) first for overall architecture and development priorities.

---

## Table of Contents

1. [Overview & File Structure](#overview--file-structure)
2. [Step 1: Plain Exchange API Client](#step-1-plain-exchange-api-client)
3. [Step 2: Error Descriptions File](#step-2-error-descriptions-file)
4. [Step 3: Trader Adapter](#step-3-trader-adapter)
5. [Step 4: Config & Registration](#step-4-config--registration)
6. [Step 5: Testing Spot REST Connector](#step-5-testing-spot-rest-connector)
7. [Step 6: WebSocket Connector (Optional)](#step-6-websocket-connector-optional)
8. [Step 7: Perpetual/Futures Connector (Optional)](#step-7-perpetualfutures-connector-optional)
9. [Step 8: Automated Tests](#step-8-automated-tests)
10. [Step 9: MM Simulation Testing](#step-9-mm-simulation-testing)
11. [Coding Guidelines](#coding-guidelines)
12. [Return Shape Reference](#return-shape-reference)
13. [Terminology Reference](#terminology-reference)

---

## Overview & File Structure

Each exchange connector consists of several files that form a layered architecture:

```text
trade/
├── trader_{exchange}.js              # Bot-universal adapter (REQUIRED)
├── api/
│   ├── {exchange}_api.js             # Plain exchange REST API client (REQUIRED)
│   ├── {exchange}_errors.js          # HTTP and exchange error code maps (RECOMMENDED)
│   ├── websocket/
│   │   ├── {exchange}WebsocketApi.js         # Public WS (market data)
│   │   ├── {exchange}WebsocketPrivateApi.js  # Private WS (account data)
│   │   └── {exchange}WebsocketPullApi.js     # WS pull (request-response)
│   └── contract/
│       └── {exchange}PerpetualApi.js         # Perpetual/Futures API
├── tests/
│   ├── trader_{exchange}.test.js     # Automated Jest tests
│   ├── trader_{exchange}.mock.js     # Mock data for tests
│   └── manual.test.js               # Manual test runner (shared)
└── settings/
    └── tradeParams_{exchange}.js     # Exchange-specific param overrides (OPTIONAL)
```

**Naming convention**: `{exchange}` is always **lowercase** (e.g., `binance`, `kucoin`, `bybit`).

**Layering**:

```text
Bot Trade Modules (mm_*.js)
        │
        ▼
trader_{exchange}.js      ← Bot-universal interface (uniform method names & return shapes)
        │
        ▼
{exchange}_api.js         ← Plain exchange HTTP client (exchange-specific params & responses)
        │
        ▼
Exchange REST/WS API      ← External exchange servers
```

---

## Step 1: Plain Exchange API Client

**File**: `trade/api/{exchange}_api.js`

This module wraps the exchange's raw HTTP API. It handles authentication, request signing, and response/error classification.

### Factory Function

```javascript
const axios = require('axios');
const config = require('../../modules/configReader');

module.exports = function() {
  let WEB_BASE; // API base URL
  let config_apiKey;
  let config_secretKey;
  let config_tradePwd;
  let log;

  const EXCHANGE_API = {
    setConfig(apiServer, apiKey, secretKey, tradePwd, logger, publicOnly) {
      WEB_BASE = apiServer;
      config_apiKey = apiKey;
      config_secretKey = secretKey;
      config_tradePwd = tradePwd;
      log = logger;
    },

    // ... methods below
  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // Exported for mock-adapter in tests
```

### `handleResponse()` — Response Classification

This is the most critical method. It classifies every HTTP response into:

- **Temporary error** → `reject()` (triggers retry in protectedRequest/publicRequest)
- **Final error** → `resolve()` with error data (caller decides what to do)
- **Success** → `resolve()` with parsed data

```javascript
handleResponse(responseOrError, resolve, reject, queryString, url) {
  const httpCode = responseOrError?.status || responseOrError?.response?.status;
  const httpMessage = responseOrError?.statusText || responseOrError?.response?.statusText;
  const data = responseOrError?.data || responseOrError?.response?.data;

  const reqParameters = queryString || '{ No parameters }';

  // Determine success and exchange-specific error
  const success = httpCode === 200 && data?.code === '200000'; // Exchange-specific
  const exchangeError = getExchangeError(data); // Extract error code + message

  // Build error description from {exchange}_errors.js
  const error = buildErrorMessage(httpCode, exchangeError);

  if (success) {
    resolve(data.data || data);
  } else if (error.isTemporary) {
    // 5xx, 429, timeouts — reject for retry
    log.warn(`Request to ${url} with data ${reqParameters} failed. ${error.description}, details: ${httpCode} ${httpMessage}, [${exchangeError.code}] ${exchangeError.msg}. Rejecting…`);
    reject(error);
  } else {
    // 4xx, business errors — resolve with error info for caller
    log.warn(`Request to ${url} with data ${reqParameters} failed. ${error.description}, details: ${httpCode} ${httpMessage}, [${exchangeError.code}] ${exchangeError.msg}. Resolving…`);
    resolve({
      // Include exchange error info for the caller
      exchangeErrorInfo: exchangeError,
    });
  }
},
```

**Error message quality rules:**

- Include HTTP code AND message: `401 Unauthorized`
- Include exchange error code AND message: `[400004] KC-API-PASSPHRASE error`
- No double spacing, no double dots, no missing codes
- Distinguish between "Rejecting" (temporary, will retry) and "Resolving" (final, caller handles)

### `publicRequest()` and `protectedRequest()`

```javascript
publicRequest(type, path, params) {
  const url = `${WEB_BASE}${path}`;
  return new Promise((resolve, reject) => {
    const config = {
      method: type,
      url,
      params,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    };

    axios(config)
        .then((response) => EXCHANGE_API.handleResponse(response, resolve, reject, JSON.stringify(params), url))
        .catch((error) => EXCHANGE_API.handleResponse(error, resolve, reject, JSON.stringify(params), url));
  });
},

protectedRequest(type, path, data) {
  const url = `${WEB_BASE}${path}`;
  const timestamp = Date.now();

  // Build signature (exchange-specific: HMAC-SHA256, Ed25519, etc.)
  const signature = buildSignature(timestamp, type, path, data, config_secretKey);

  return new Promise((resolve, reject) => {
    const config = {
      method: type,
      url,
      data,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': config_apiKey,
        'X-API-SIGN': signature,
        'X-API-TIMESTAMP': timestamp,
        // Exchange-specific headers...
      },
      timeout: 10000,
    };

    axios(config)
        .then((response) => EXCHANGE_API.handleResponse(response, resolve, reject, JSON.stringify(data), url))
        .catch((error) => EXCHANGE_API.handleResponse(error, resolve, reject, JSON.stringify(data), url));
  });
},
```

### Exchange-Specific API Methods

Implement low-level methods that map directly to exchange API endpoints. Names can differ from the bot's interface:

```javascript
// Required methods (names are free-form, matched in trader_{exchange}.js)
getBalances(params) { ... }          // Account balances
getOrders(pair, status) { ... }      // Open/closed orders
getOrder(orderId) { ... }            // Single order details
addOrder(params) { ... }             // Place an order
cancelOrder(orderId) { ... }         // Cancel an order
cancelAllOrders(pair) { ... }        // Cancel all orders
ticker(pair) { ... }                 // 24h market ticker
orderBook(pair, limit) { ... }       // Order book depth
markets() { ... }                    // All trading pairs info
currencies() { ... }                 // All currencies info
getTradesHistory(pair) { ... }       // Recent trades
getDepositAddress(coin) { ... }      // Deposit address
getFees(pair) { ... }                // Trading fees

// Optional methods
getAccounts() { ... }                // Account info
transferFunds(params) { ... }        // Internal transfer
getDepositHistory(params) { ... }    // Deposit history
getWithdrawalHistory(params) { ... } // Withdrawal history
addWithdrawal(params) { ... }        // Create withdrawal
getVolume() { ... }                  // Account trading volume
getCandlesHistory()                  // Candles data
```

**JSDoc for each method must include a link to the exchange API documentation:**

```javascript
/**
 * Get account balances
 * https://docs.exchange.com/api/v1/account/balances
 * @param {object} params
 * @returns {Promise<object>}
 */
getBalances(params) { ... }
```

---

## Step 2: Error Descriptions File

**File**: `trade/api/{exchange}_errors.js`

If the exchange provides clear error codes, create a separate error descriptions file:

```javascript
const httpErrorCodeDescriptions = {
  4: { description: 'Client error' },
  400: { description: 'Bad request' },
  401: { description: 'Invalid API Key' },
  403: { description: 'Forbidden' },
  404: { description: 'Not found' },
  429: { description: 'Rate limit exceeded', isTemporary: true },
  5: { description: 'Server error', isTemporary: true },
  502: { description: 'Bad gateway', isTemporary: true },
  503: { description: 'Service unavailable', isTemporary: true },
};

const exchangeErrorCodeDescriptions = {
  '400001': { description: 'Insufficient balance' },
  '400002': { description: 'Order does not exist' },
  '400003': { description: 'Invalid parameter' },
  '400004': { description: 'API key passphrase error' },
  '429000': { description: 'Too many requests', isTemporary: true },
  // ... all exchange-specific codes
};

module.exports = {
  httpErrorCodeDescriptions,
  exchangeErrorCodeDescriptions,
};
```

**Key rules:**

- `isTemporary: true` → `handleResponse` will `reject()` (retry via axios retry)
- Without `isTemporary` → `handleResponse` will `resolve()` with error info (caller handles)
- Map both HTTP codes (4xx, 5xx) and exchange-specific numeric/string codes
- Use generic catch-alls: key `4` matches any 4xx, key `5` matches any 5xx

---

## Step 3: Trader Adapter

**File**: `trade/trader_{exchange}.js`

This is the bot-universal interface. It converts between the bot's standard method signatures/return shapes and the exchange-specific API.

### Factory Function Signature (STRICT)

```javascript
const config = require('../modules/configReader');
const ExchangeApi = require('./api/{exchange}_api');

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
  const exchangeApiClient = ExchangeApi();
  exchangeApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Load markets on init
  if (loadMarket) {
    getMarkets();
    if (!publicOnly) {
      getCurrencies(); // Only if auth endpoints needed
    }
  }

  // Return the public interface object
  return {
    get markets() { ... },
    get currencies() { ... },
    getMarkets,
    getCurrencies,
    marketInfo,
    currencyInfo,
    features,
    getBalances,
    getOpenOrders,
    getOrderDetails,
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    getRates,
    getOrderBook,
    getTradesHistory,
    getCandlesHistory,
    getDepositAddress,
    getFees,
    getAccount,
    transfer,
    withdraw,
    getWithdrawalById,
    processHistoryRecords,
  };
};
```

### Shared Module-Level State

Markets and currencies are cached on `module.exports` for cross-instance sharing:

```javascript
module.exports.exchangeMarkets = {};       // Cached market data
module.exports.exchangeCurrencies = {};    // Cached currency data
module.exports.gettingMarkets = false;     // Guard against concurrent fetches
module.exports.gettingCurrencies = false;
```

### Required Methods (Names Are STRICT)

Every method below MUST exist and return data in the [standardized shapes](#return-shape-reference).

#### `features(pair?)`

Returns exchange capability flags. The bot checks these to decide what features to enable:

```javascript
function features(pair) {
  return {
    getMarkets: true,
    getCurrencies: true,
    supportCoinNetworks: true,          // Currencies include network info
    placeMarketOrder: true,             // Exchange supports market orders
    allowAmountForMarketBuy: true,      // Market buy can use base amount
    allowAmountForMarketSell: true,     // Market sell can use base amount
    amountForMarketOrderNecessary: false, // Market order REQUIRES amount (not quote)
    getDepositAddress: true,
    createDepositAddressWithWebsiteOnly: false,
    selfTradeProhibited: true,          // Exchange prevents self-trade
    getTradingFees: true,
    getAccountTradeVolume: false,
    getFundHistory: true,
    getFundHistoryImplemented: true,
    getWithdrawalById: true,
    supportTransferBetweenAccounts: true,
    accountTypes: ['spot', 'funding'],  // Available account types
    tradingAccountType: 'spot',         // Which account is used for trading
    orderNumberLimit: 200,              // Max open orders per pair
    apiProcessingDelayMs: 10,           // Delay after order placement for API consistency
    isDemo: false,                      // Demo/testnet account
    // Socket features (only if WebSocket is implemented)
    socketSupport: false,
    socketPullSupport: false,
    socketEnabled: useSocket,
    // Data source for candle-based indicators
    marketDataSource: 'candles',        // 'candles' or 'trades'
  };
}
```

#### `formatPairName(pair)` — Internal Helper

Defined OUTSIDE the factory function (at file bottom), parses any pair format:

```javascript
/**
 * Parses any pair format to standardized names
 * @param {string} pair E.g. BTC/USDT, BTC-USDT, BTC_USDT, BTCUSDT
 * @returns {{ coin1: string, coin2: string, pair: string, pairReadable: string, pairPlain: string, isParsed: boolean }}
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();
  // Split into coin1 and coin2 based on exchange's separator
  // ...
  return {
    coin1,
    coin2,
    pair: coin1 + coin2,            // BTCUSDT (no separator)
    pairReadable: `${coin1}/${coin2}`, // BTC/USDT
    pairPlain: `${coin1}-${coin2}`,    // BTC-USDT (exchange's native format)
    isParsed: true,
  };
}
```

#### `formatNetworkName(networkName)` — Internal Helper

Maps exchange-specific network names to the bot's standard network codes using `helpers/networks.js`:

```javascript
const networks = require('../../helpers/networks');

function formatNetworkName(networkName) {
  // Exchange might call it 'ETHEREUM', 'ETH', 'erc20', 'ERC-20', etc.
  // Map to standard: 'ERC20', 'BEP20', 'TRC20', 'SOL', etc.
  const mapped = networks.findNetwork(networkName);
  return mapped?.code || networkName;
}
```

#### `getMarkets(pair?)`

Fetches all trading pairs from the exchange. Stores results in `module.exports.exchangeMarkets`.

```javascript
async function getMarkets(pair) {
  // Return cached if available and no specific pair requested
  if (module.exports.exchangeMarkets && !pair) {
    return module.exports.exchangeMarkets;
  }

  // Guard against concurrent fetches
  if (module.exports.gettingMarkets) return;
  module.exports.gettingMarkets = true;

  try {
    const data = await exchangeApiClient.markets();
    if (!data) return undefined;

    const result = {};
    for (const market of data) {
      const pairNames = formatPairName(`${market.baseAsset}/${market.quoteAsset}`);

      result[pairNames.pairPlain] = {
        pairReadable: pairNames.pairReadable,
        pairPlain: pairNames.pairPlain,
        coin1: pairNames.coin1,
        coin2: pairNames.coin2,
        coin1Decimals: getDecimalsFromStep(market.stepSize),
        coin2Decimals: getDecimalsFromStep(market.tickSize),
        coin1Precision: +market.stepSize,
        coin2Precision: +market.tickSize,
        coin1MinAmount: +market.minQty,
        coin1MaxAmount: +market.maxQty,
        coin2MinAmount: +market.minNotional,
        coin2MaxAmount: null,
        coin2MinPrice: +market.minPrice || null,
        coin2MaxPrice: +market.maxPrice || null,
        minTrade: +market.minNotional,
        status: market.status === 'TRADING' ? 'ONLINE' : 'OFFLINE',
      };
    }

    module.exports.exchangeMarkets = result;
    log.log(`Received info about ${Object.keys(result).length} markets on ${config.exchangeName} exchange.`);

    return result;
  } catch (e) {
    log.warn(`API request getMarkets() of trader_${config.exchange}.js module failed. ${e}`);
    return undefined;
  } finally {
    module.exports.gettingMarkets = false;
  }
}
```

**Important**: Keys in `exchangeMarkets` should be `pairPlain` (exchange's native format like `BTC-USDT`), not `pairReadable`.

#### `getCurrencies(coin?)`

Similar to `getMarkets()` but for currencies. Stores results in `module.exports.exchangeCurrencies`. Must include:

- Basic info: `symbol`, `name`, `status`, `decimals`, `precision`
- Network info (if exchange provides): `networks` object with `{ withdrawalFee, minWithdrawal, confirmations, status, chainName }`
- Use `formatNetworkName()` for network keys

#### `marketInfo(pair)` and `currencyInfo(coin)`

Return locally cached info for a specific pair/currency:

```javascript
function marketInfo(pair) {
  const pairNames = formatPairName(pair);
  return module.exports.exchangeMarkets?.[pairNames.pairPlain];
}
```

#### `getBalances(nonzero = true, accountType)`

Returns array of balance objects. Each method has **two separate try-catch blocks**: one for the API request, one for data processing.

```javascript
async function getBalances(nonzero = true, accountType) {
  const paramString = `nonzero: ${nonzero}, accountType: ${accountType}`;

  let data;
  try {
    data = await exchangeApiClient.getBalances({ type: accountType || 'trade' });
  } catch (e) {
    log.warn(`API request getBalances(${paramString}) of trader_${config.exchange}.js module failed. ${e}`);
    return undefined;
  }

  try {
    const result = [];
    for (const balance of data) {
      const free = +balance.available;
      const freezed = +balance.frozen;
      const total = free + freezed;
      if (nonzero && total === 0) continue;

      result.push({ code: balance.currency, free, freezed, total });
    }
    return result;
  } catch (e) {
    log.warn(`Error while processing getBalances(${paramString}) response: ${e}`);
    return undefined;
  }
}
```

**Critical**: In case of ANY error (API or processing), return `undefined`. This eliminates false results. If the method returns data, it must accurately reflect exchange state.

**Critical**: Code in `catch()` blocks must be reliable and never fail. No sensitive operations in catch blocks.

#### `getOpenOrders(pair)`

If the exchange paginates results, implement a private `getOpenOrdersPage()` helper and call it in a loop.

Return array of order objects with statuses: `new` or `part_filled` (never `filled` — these are open orders).

#### `getOrderDetails(orderId, pair)`

Returns detailed info about a single order. Important for fill verification.

Statuses: `unknown`, `new`, `filled`, `part_filled`, `cancelled`.

- API error (500, timeout) → return `undefined`
- Order not found → return `{ status: 'unknown' }`
- Wrong orderId format → return `{ status: 'unknown' }` or `undefined`
- Order found → return full details with correct status

#### `placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount)`

The most complex method. Must handle 10 order variants:

1. **Limit buy** with `coin1Amount` (base amount)
2. **Limit buy** with `coin2Amount` (quote amount)
3. **Limit sell** with `coin1Amount`
4. **Limit sell** with `coin2Amount`
5. **Limit buy** at price that fills immediately
6. **Limit sell** at price that fills immediately
7. **Market buy** with `coin1Amount`
8. **Market buy** with `coin2Amount`
9. **Market sell** with `coin1Amount`
10. **Market sell** with `coin2Amount`

**Pre-validation checklist:**

```javascript
async function placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
  const paramString = `side: ${side}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

  // 1. Check market info exists
  const marketData = marketInfo(pair);
  if (!marketData) {
    log.warn(`Unable to place order on ${pair}: no market info.`);
    return { message: `No market info for ${pair}` };
  }

  // 2. Calculate amount/quote with correct decimals
  // 3. Validate min/max amounts
  // 4. Validate min/max price
  // 5. Build exchange-specific order params

  try {
    const data = await exchangeApiClient.addOrder(orderParams);
    // ...
    if (data?.orderId) {
      return { orderId: String(data.orderId), message: undefined };
    } else {
      return { orderId: undefined, message: data?.message || 'Unknown error' };
    }
  } catch (e) {
    log.warn(`API request placeOrder(${paramString}) of trader_${config.exchange}.js module failed. ${e}`);
    return undefined;
  }
}
```

**If placing fails after pre-checks** (invalid params, insufficient min amount): log and return `{ message: '...' }` with `orderId: undefined`.

#### `cancelOrder(orderId, side, pair)`

- Order cancelled → `true`
- Order not found / already cancelled → `false`
- Wrong orderId format → `false` or `undefined`
- API error → `undefined`

#### `cancelAllOrders(pair)`

- Orders cancelled → `true`
- No open orders → `true`
- Pair doesn't exist → `false` or `undefined`

#### `getRates(pair)`

Returns 24h ticker. Pair doesn't exist → `undefined`.

#### `getOrderBook(pair)`

Returns `{ bids, asks }`. Bids sorted by price descending, asks ascending. If API allows, request 200 items with no grouping (plain order book).

#### `getTradesHistory(pair)`

Returns array sorted by timestamp ascending. If API allows, request 300 items.

#### `getCandlesHistory(pair, timeframe, since, limit, excludeLast?)`

Returns OHLCV candle data array.

#### `getDepositAddress(coin)`

Returns array of `{ network, address, memo? }`. Use `formatNetworkName()` for network names. Return addresses for all networks where deposits are enabled.

#### `getFees(coinOrPair)`

- If `coinOrPair` is a coin (e.g., BTC): return fees for all pairs where this coin is base
- If `coinOrPair` is a pair: return fees for that pair
- If neither provided: return fees for all pairs (if possible) or `undefined`
- Returns `[{ pair, makerRate, takerRate }]`

#### `transfer(coin, from, to, amount)`

Internal account transfer (e.g., spot → funding). If `amount` not set, transfer full balance. Returns `{ success, errorMessage? }`.

#### `withdraw(address, amount, coin, withdrawalFee, network)`

External withdrawal. `withdrawalFee` is sent ON TOP of `amount`. Returns `{ success, id?, errorMessage? }`.

#### `getDepositHistory(coin, limit)` and `getWithdrawalHistory(coin, limit)`

Via `processHistoryRecords(target, coin, limit)`. Returns array of history records.

#### `getWithdrawalById(id)`

Single withdrawal record lookup.

#### `getVolume()`

Account's 24h trading volume. Returns `[{ updated, volume30days, volumeUnit }]`.

#### `getAccount()`

Account basic info.

---

## Step 4: Config & Registration

### Create Config File

Copy `config.default.jsonc` → `config.{exchange}_test.jsonc`:

```jsonc
{
  "exchange": "Newexchange",  // Exchange name (capital first letter)
  "pair": "BTC/USDT",
  "apikey": "your-api-key",
  "apisecret": "your-api-secret",
  "apipassword": "",          // If exchange requires API passphrase
  "api": {
    "port": 1111,
    "ip": "0.0.0.0",
    "health_check": true,
    "debug_info": true
  }
  // ...other settings
}
```

### Register Exchange Name

Add the exchange name to the `exchanges` array in `config.default.jsonc`:

```jsonc
"exchanges": [
  // ... existing exchanges
  "Newexchange"
]
```

### Trade Params Override (Optional)

If an exchange needs different default parameters, create `trade/settings/tradeParams_{exchange}.js`. Otherwise, the bot copies `tradeParams_Default.js` automatically at startup.

---

## Step 5: Testing Spot REST Connector

### Testing Tools

1. **Logging**: `console.log()` in API methods (temporary, remove before PR)
2. **Bot commands**: `/balances`, `/orders`, `/rates`, `/buy`, `/sell`, etc.
3. **Manual test runner**: Set `"dev": true` in config, use `trade/tests/manual.test.js`:
   - Uncomment the desired test block (e.g., `test_spot()`)
   - Add method calls inside the function
   - Run: `node app.js {config_name}`
   - Methods execute a few seconds after bot starts

```javascript
// In trade/tests/manual.test.js — test_spot() function
console.log(await traderapi.cancelOrder('5d13f3e8-dcb3-4a6d-88c1-16cf6e8d8179', undefined, 'DOGE/USDT'));
console.log(await traderapi.getOpenOrders('BTC/USDT'));
console.log(await traderapi.placeOrder('buy', 'BTC/USDT', 30000, 0.001, 1));
```

### Start Testing

Run: `node app.js {config_name}` (or `npm run start:config -- {config_name}`)

On successful startup, you should see:

1. Connected to MongoDB
2. Received info about N markets on Exchange
3. Received info about N currencies on Exchange (if applicable)
4. API server listening
5. Bot started notification

### Testing `handleResponse()` — Request Processing

Add temporary logging after the request parameters line in `{exchange}_api.js`:

```javascript
console.log(`Request to ${url} returned ${httpCode} ${httpMessage}`);
console.log(`success is ${success}`);
console.log(`exchangeError is ${JSON.stringify(exchangeError)}`);
console.log(`error is ${JSON.stringify(error)}`);
// console.log(`data is ${data}`); // Only for failed requests — too verbose for success
```

#### Test: Server Timeout

Set `timeout: 1` instead of `timeout: 10000` in `publicRequest()`.

**Expected**: Request rejected, good-looking error message with `AxiosError: timeout of 1ms exceeded`.

#### Test: Invalid API Keys

Use wrong API keys in config, send `/balances`.

**Expected**:

- Request resolved (not rejected — auth errors are final)
- Error message includes HTTP code, message, exchange error code and message
- Example: `401 Unauthorized, [400004] KC-API-PASSPHRASE error`

**Bad output examples** (fix if you see these):

- Missing HTTP code: `Unauthorized, [400004] ...`
- Double spacing: `401 Unauthorized,  [400004] ...`
- Double dot: `...error.. Rejecting…`
- Not enough details: `...details: 400004. Rejecting…`

#### Test: Resolved Errors

When a request errors with a final state, it must resolve (not reject) with error info:

```javascript
// Test: cancel a non-existent order
console.log(await traderapi.cancelOrder('non-existent-id', undefined, 'DOGE/USDT'));
// Should return false (not throw), with good log message
```

### Testing Individual Methods

For each method below, check:

1. The connected API method and its documentation
2. Log BOTH raw request results AND processed results
3. Compare with exchange UI
4. All numbers stored as numbers, not strings

#### `getMarkets(pair)`

```javascript
// Add logging inside getMarkets():
if (market.symbol === 'KCS-BTC') {
  console.log('Plain data:', market);
  console.log(`${market.symbol} -> ${JSON.stringify(pairNames)}`);
  console.log('Formatted data:', result[pairNames.pairPlain]);
}
```

**Verify:**

- All fields present: `pairReadable`, `pairPlain`, `coin1`, `coin2`, `coin1Decimals`, `coin2Decimals`, `coin1MinAmount`, `coin1MaxAmount`, `status`, etc.
- `coin1Decimals`, `coin2Decimals` match exchange UI
- `formatPairName()` produces correct results
- Market count matches exchange documentation
- Keys in `exchangeMarkets` are `pairPlain`, not `pairReadable`

#### `getCurrencies(coin?)`

```javascript
// Add logging:
console.log(`${chainName} -> ${formatNetworkName(chainName)}`);
if (currency.currency === 'USDT') {
  console.log('Plain data:', currency);
  console.log('Formatted data:', result[currency.currency]);
}
```

**Verify:**

- All fields present: `symbol`, `name`, `status`, `decimals`, `precision`, `networks`
- `formatNetworkName()` maps all exchange networks to standard codes (ERC20, BEP20, TRC20, SOL, etc.)
- Network objects include: `status`, `depositStatus`, `withdrawalStatus`, `confirmations`, `withdrawalFee`, `chainName`
- If currencies use auth endpoint, only fetch when `publicOnly === false`
- Currency count matches exchange documentation
- Network info matches what exchange UI shows for deposits/withdrawals

#### `marketInfo(pair)` and `currencyInfo(coin)`

Quick check: return cached data for a specific pair/coin.

#### `features()`

Verify all flags match exchange API documentation and capabilities.

#### `getBalances(nonzero, accountType)`

Test via logging, `/balances` command, and direct execution.

**Verify**: Each crypto has `code`, `free`, `freezed`, `total`. Compare with exchange UI.

#### `getOpenOrders(pair)`

**Expected results:**

- Pair doesn't exist → `undefined`
- No open orders → empty array `[]`
- Has open orders → array with: `orderId` (string), `symbol`, `symbolPlain`, `price` (number), `side`, `type`, `timestamp` (ms), `amount` (number), `amountExecuted` (number), `amountLeft` (number), `status` (`new` or `part_filled`)

**Test `part_filled`**: Place a sell order in spread, then a buy at same price with lower amount:

```javascript
const testPrice = 0.0002162;
const testMarket = 'KCS/BTC';
await traderapi.placeOrder('sell', testMarket, testPrice, 0.2);
await traderapi.placeOrder('buy', testMarket, testPrice, 0.1);
await traderapi.getOpenOrders(testMarket);
// The sell order should now be part_filled
```

#### `getOrderDetails(orderId, pair)`

Test ALL statuses: `unknown`, `new`, `filled`, `part_filled`, `cancelled`.

Test `filled` with both limit and market orders (buy and sell).

**Expected:**

- API error → `undefined`
- Order not found → `{ status: 'unknown' }`
- Wrong orderId format → `{ status: 'unknown' }` or `undefined`
- Order found → `orderId`, `pairReadable`, `pairPlain`, `price`, `side`, `type`, `timestamp`, `amount`, `volume`, `amountExecuted`, `volumeExecuted`, `status`

#### `cancelOrder(orderId, side, pair)`

- Exists and cancelled → `true`
- Not found / already cancelled → `false`
- Wrong format → `false` or `undefined`

#### `cancelAllOrders(pair)`

- Pair doesn't exist → `false` or `undefined`
- No open orders → `true`
- Orders cancelled → `true`

#### `getRates(pair)`

- Pair doesn't exist → `undefined`
- Otherwise → `{ ask, bid, last, volume, volumeInCoin2, high, low }` (all numbers)

#### `placeOrder(side, pair, price, coin1Amount, limit, coin2Amount)`

Test all 10 order types listed in [Step 3: placeOrder](#placeorderside-pair-price-coin1amount-limit--1-coin2amount).

**Additional tests:**

- Insufficient balance
- Wrong parameters
- Small-price pairs (price < 10⁻⁸)
- Amount below exchange minimum
- Volume below exchange minimum
- Precision higher than allowed

Check the `/balances` after each order to verify `free`, `freezed`, `total` match expectations.

**Verify**: Log messages and reply messages to admins are consistent and good-looking.

#### `getTradesHistory(pair)`

- Pair doesn't exist → `undefined`
- Otherwise → array of `{ coin1Amount, price, coin2Amount, date, type, tradeId? }` sorted by timestamp ascending. 300 items if API allows.

#### `getOrderBook(pair)`

- Pair doesn't exist → `undefined`
- Otherwise → `{ bids: [{ amount, price, count, type }], asks: [...] }`. Bids desc, asks asc. 200 items if API allows. No order grouping.

#### `getDepositAddress(coin)`

- Returns `[{ network, address, memo? }]`
- `network` formatted via `formatNetworkName()`
- Returns all networks where deposits are enabled
- Test multi-network coins (USDT) and single-network (DASH, ADM)
- Error → `{ success: false, message }` or `undefined`

#### `transfer(coin, from, to, amount)`

- Check `/balances full` before and after
- If no amount specified, transfers full balance
- Error → `{ success: false, errorMessage }`

#### `withdraw(address, amount, coin, withdrawalFee, network)`

- Withdraw to your own account and verify arrival
- `withdrawalFee` is ON TOP of `amount`
- Check via `/show withdrawals` and `/balances full`
- Success → `{ success: true, id, currency, amount, address, withdrawalFee, ... }`
- Error → `{ success: false, errorMessage }`

#### `getDepositHistory(coin, limit)` and `getWithdrawalHistory(coin, limit)`

Test via `/show deposits` and `/show withdrawals`. Error → `{ success: false, errorMessage }`.

#### `getWithdrawalById(id)`

Test via `/show withdrawal {ID}`.

#### `getFees(coinOrPair)`

- Works for both coins and pairs
- For a coin → fees for all pairs where coin is base
- Neither coin nor pair → fees for all pairs or `undefined`
- Returns `[{ pair, makerRate, takerRate }]`
- Non-existent coin/pair → empty array or `undefined`

#### `getVolume()`

Returns `[{ updated, volume30days, volumeUnit }]`. Error → `undefined`.

---

## Step 6: WebSocket Connector (Optional)

WebSocket extends the REST connector with real-time data. Three priority levels:

1. **WS Subscription** (highest) — real-time push
2. **WS Pull** — request-response over WS
3. **REST** (lowest) — traditional HTTP polling

### File Structure

```text
trade/api/websocket/
├── websocketApi.js                       # Generic WS base class (DO NOT MODIFY)
├── {exchange}WebsocketApi.js             # Public WS (market data)
├── {exchange}WebsocketPrivateApi.js      # Private WS (account data)
└── {exchange}WebsocketPullApi.js         # WS pull (request-response)
```

### Architecture

- **Base class** `WebSocketApi` handles: connection lifecycle, heartbeat, reconnection, and a `store` with data channels (`depth`, `trades`, `balance`, `orders`, `rates`) and validity tracking
- Exchange implementations extend `WebSocketApi` and override: `subscribe()`, `initEvents()`, `removeEvents()`, `auth()`, `fetchInitialData()`

### Trader Adapter Modifications

When WS is implemented, modify `trader_{exchange}.js`:

1. Add to `features()`:

```javascript
socketSupport: true,
socketPullSupport: true,
socketEnabled: useSocket,
```

2. Add WS helper methods:

```javascript
isPublicWsEnabled(dataName, pairObj) { ... }
isPrivateWsEnabled(dataName, pairObj) { ... }
wsPublicPullEnabled(pullMethod) { ... }
wsPrivatePullEnabled(pullMethod) { ... }
```

3. Amend data methods to prefer WS over REST:

```javascript
async function getRates(pair) {
  // Priority: WS subscription → WS pull → REST
  if (isPublicWsEnabled('rates', pairObj)) {
    return wsApiClient.store.rates[pairPlain];
  }
  if (wsPublicPullEnabled('getRates')) {
    return wsApiClient.pullRates(pairPlain);
  }
  // Fallback to REST
  return getRestRates(pair);
}
```

### Methods to Implement

#### Public WS

| Method | WS Subscription | WS Pull |
| -------- | ---------------- | --------- |
| `getRates(pair)` | Yes | Yes |
| `getOrderBook(pair)` | Yes (subscribe to diffs with checksum, not full book) | Yes |
| `getTradesHistory(pair)` | Yes (subscribe to new trades, fill history via pull/REST) | Yes |

**Order book** is usually maintained via differential updates:

- Initially fill via WS pull or REST snapshot
- Subscribe to add/remove/amend events
- Verify integrity via checksum (if exchange provides)
- Re-subscribe on checksum mismatch

#### Private WS

| Method | WS Subscription | WS Pull |
| -------- | ---------------- | --------- |
| `getBalances` | Yes (subscribe to balance changes) | Yes |
| `getOpenOrders` | Yes (subscribe to order changes) | Yes |
| `getOrderDetails` | — | Yes (handler) |
| `cancelOrder` | — | Yes (handler) |
| `placeOrder` | — | Yes (handler) |

---

## Step 7: Perpetual/Futures Connector (Optional)

### Architecture

```text
modules/perpetualApi.js              # Singleton factory (loads exchange-specific impl)
trade/api/contract/
├── perpetualApi.js                  # Abstract base class (DO NOT MODIFY)
└── {exchange}PerpetualApi.js        # Exchange-specific implementation
```

### Key Differences from Spot

- Pair naming: `BTCUSDT` (perpetual) vs `BTC/USDT` (spot)
- `buy/sell` ≡ `long/short` in context
- Set `isDemoAccount: true` in config for testing before live
- Most trade modules DO NOT work with perpetual (only `mm_trader` and `mm_orderbook_builder`)

### Implementation Pattern

```javascript
const PerpetualApi = require('./perpetualApi');

class ExchangePerpetualApi extends PerpetualApi {
  constructor(params) {
    super(params);
    // Create spotApi (plain API client) and traderApi (trader adapter)
    this.spotApi = ExchangeApiClient();
    this.traderApi = TraderFactory(params.apiKey, params.secretKey, ...);
  }

  // Override abstract methods...
}
```

Reuse spot methods where possible. If `getOrderBook()` is 70% shared between spot and perpetual, modify the spot method to be universal rather than duplicating.

### Methods to Implement

| Method | Notes |
| -------- | ------- |
| `features()` | Perpetual-specific capabilities |
| `formatPairName(pair)` | Returns `pairPerpetual: 'BTCUSDT'` |
| `getBalances(nonzero, accountType)` | Futures account balances |
| `getFees(coinOrPair, category)` | May differ from spot |
| `getInstruments(symbol, forceUpdate)` | Like spot's `getMarkets()` |
| `instrumentInfo(symbol)` | Like spot's `marketInfo()` |
| `getOrderBook(symbol, limit)` | Often reuses spot implementation |
| `getTickerInfo(symbol)` | Includes perpetual-specific: open interest, mark price |
| `getPublicTradeHistory(symbol, limit)` | Recent trades |
| `getOpenInterest(intervalTime)` | Open interest data |
| `getLongShortRatio(intervalTime)` | Long/short ratio |
| `getRiskLimit(symbol)` | Max leverage & caps |
| `placeOrder(symbol, side, type, qty, price, reduceOnly, ...)` | Long/short with leverage |
| `cancelOrder(orderId, symbol, side)` | Cancel perpetual order |
| `cancelAllOrders(symbol, side)` | Cancel all perpetual orders |
| `getOpenOrders(symbol)` | Unfilled/partially filled |
| `getOrderDetails(orderId)` | Order info |
| `getPositions(symbol)` | Open positions with PnL |
| `closePosition(symbol, price?)` | Close at limit or market |
| `setLeverage(symbol, leverage)` | Set leverage |
| `switchMarginMode(symbol, mode, leverage)` | `isolated` or `cross` |
| `switchPositionMode(symbol, mode)` | `oneway` or `hedge` |
| `setTakeProfitStopLoss(symbol, tp, sl, ...)` | TP/SL management |

### Modules Compatibility with Perpetual

| Module | Perpetual | Notes |
| -------- | ----------- | ------- |
| `mm_trader` | Yes | Single account only |
| `mm_orderbook_builder` | Yes | — |
| All other `mm_*` modules | **No** | Return error: "The feature {name} is not available for perpetual contract trading." |
| Two-key trading | **No** | `useSecondAccount = traderapi2 && !isPerpetual` |
| `cs_manager` | **No** | — |

---

## Step 8: Automated Tests

**File**: `trade/tests/trader_{exchange}.test.js`

Use Jest with `axios-mock-adapter` to test without real API calls:

```javascript
const MockAdapter = require('axios-mock-adapter');
const exchangeApi = require('../api/{exchange}_api');
const { axios } = exchangeApi;

const config = require('../../modules/configReader');
const TraderFactory = require('../trader_' + config.exchange);

let mock;
let traderapi;

beforeAll(async () => {
  mock = new MockAdapter(axios);
  traderapi = TraderFactory(
      config.apikey, config.apisecret, config.apipassword,
      console, false, true, false, false, 0, config.coin1, config.coin2,
  );

  // Mock getMarkets response
  mock.onGet('/api/v2/symbols').reply(200, require('./trader_{exchange}.mock').marketsResponse);
  await traderapi.getMarkets();
});

afterAll(() => mock.restore());

describe('trader_{exchange}', () => {
  test('getBalances returns correct shape', async () => {
    mock.onGet('/api/v1/accounts').reply(200, mockBalancesResponse);
    const balances = await traderapi.getBalances(false);
    expect(balances).toBeInstanceOf(Array);
    expect(balances[0]).toHaveProperty('code');
    expect(balances[0]).toHaveProperty('free');
    expect(typeof balances[0].free).toBe('number');
  });

  test('placeOrder returns orderId', async () => {
    mock.onPost('/api/v1/orders').reply(200, { code: '200000', data: { orderId: '123' } });
    const result = await traderapi.placeOrder('buy', 'BTC/USDT', 30000, 0.001, 1);
    expect(result).toHaveProperty('orderId', '123');
  });

  // ... test each method
});
```

**Mock data file**: `trade/tests/trader_{exchange}.mock.js` — export mock API response objects.

---

## Step 9: MM Simulation Testing

After all individual methods pass, run a full market-making simulation:

1. **Choose a trading pair with rare trading activity** (to control the environment)
2. **Enable features**: `t` (trader, in-spread strategy, small amounts), `ob`, `ag`, `ld`, `liq`
3. **Run the bot** and carefully monitor:
   - Logs for errors, warnings, unexpected behavior
   - Trading pair's order book, trade history, and chart on exchange website
   - Bot replies to commands: `/balances`, `/orders`, `/rates`, `/stats`
4. **Critical check**: There must be NO `unk` (unknown) orders when you run `/orders`. If there are, something is wrong with order tracking.
5. **Watch for**:
   - Orders placed at correct prices and amounts
   - Orders cancelled properly when modules rotate
   - Balances tracked accurately
   - No duplicate orders
   - Correct spread maintenance

---

## Coding Guidelines

### Mandatory Connector Quality Rules

These rules are mandatory for every new connector and connector refactor.

1. **Strict JSDoc and typedef usage**

Add detailed JSDoc for all public methods in both `trade/api/{exchange}_api.js` and `trade/trader_{exchange}.js`. Use typedef imports from `types/*.d.js` in the same style as `trade/trader_binance.js`.

2. **Endpoint response types are required**

Create exchange-specific endpoint response typedef files under `types/{exchange}/`, include realistic `@example` payloads, and apply those typedefs in API and trader files (avoid untyped endpoint payloads).

3. **Direct API docs links in API method JSDoc**

Every API method in `trade/api/{exchange}_api.js` must include a direct URL to the exact official endpoint documentation.

4. **Describe enum values and parameter semantics in JSDoc**

Do not leave enum-like parameters undocumented (for example, avoid bare `@param {0 | 1 | 2 | 3 | 4} typeTrade`). Always explain each meaningful value and usage constraints in JSDoc and in `types/{exchange}/*.d.js`.

5. **No silent response-shape masking**

Do not hide malformed payloads with permissive patterns like `response?.list || []`. Validate response shape explicitly and log/handle invalid payloads.

6. **Use `marketInfo()` in candle normalization paths**

In trader adapters, candle parsing must use `marketInfo()` metadata (decimals/precision), not ad-hoc market reloading.

7. **Use exchange bulk cancellation endpoint**

If exchange supports bulk order cancellation, `cancelAllOrders()` must use that endpoint as primary path.

8. **Extract reusable helpers**

Before introducing local helper logic, check `helpers/utils.js`. If helper can be reused across modules, add it to `helpers/utils.js` and use it from there.

9. **Mandatory test evidence and reports**

Provide detailed raw and normalized outputs for connector tests, explicitly cover `getOrderDetails` status normalization (`unknown`, `new`, `filled`, `part_filled`, `cancelled`), and save reports as separate files per mode: `.ai-tasks/test-results/YYYY-MM-DD (TestXXX-mock) ... .md` for mock runs and `.ai-tasks/test-results/YYYY-MM-DD (TestXXX-live) ... .md` for live runs.

10. **Exchange trade params file policy**

`trade/settings/tradeParams_{exchange}.js` must contain a full copied object from `tradeParams_Default.js`. Do not re-export default trade params with `require('./tradeParams_Default')`.

11. **Markdown lint compliance is mandatory**

All Markdown documentation must pass markdownlint rules, including `MD022` (blanks around headings), `MD032` (blanks around lists), `MD007` (list indentation), `MD034` (no bare URLs), and `MD040` (fenced code language).

12. **Use explicit exchange-prefixed typedef names**

Avoid ambiguous `default` typedef names in `types/{exchange}/*.d.js`. Use human-readable exchange-prefixed names (for example, `DextradeSymbols`, `DextradeTicker`, `DextradeOrder`) and import the exact named typedef in API and trader files.

13. **One-line description punctuation rule**

For one-line parameter/property/list descriptions, do not use a trailing period if there is only one sentence. If there are two or more sentences, keep terminal periods after each sentence.

### String Quoting

- **Single quotes** everywhere: code, JSDoc, comments
- Exception: separate `*.d.js` type definition files may use double quotes

```javascript
// ❌ WRONG
/** @param {"delete" | "get" | "post"} method */
/** @param {string} pair E.g. "BTC/USDT" */

// ✅ CORRECT
/** @param {'delete' | 'get' | 'post'} method */
/** @param {string} pair E.g. BTC/USDT */

// ✅ CORRECT — long strings should be quoted
/** @param {string} orderId Example: 'a9625b04-fc66-4999-a876-543c3684d702' */
```

### Async/Await

All methods in `trader_{exchange}.js` use `async/await`, **not** Promises.

Exception: `getMarkets()` and `getCurrencies()` may still use Promise-based implementation, but `async/await` is preferred for new connectors.

### Error Handling

Every method has two separate try-catch blocks:

```javascript
async function someMethod(params) {
  const paramString = `params: ${JSON.stringify(params)}`;

  // Block 1: API request
  let data;
  try {
    data = await exchangeApiClient.someEndpoint(params);
  } catch (e) {
    log.warn(`API request someMethod(${paramString}) of trader_${config.exchange}.js module failed. ${e}`);
    return undefined;
  }

  // Block 2: Data processing
  try {
    // Process data...
    return processedResult;
  } catch (e) {
    log.warn(`Error while processing someMethod(${paramString}) response: ${e}`);
    return undefined;
  }
}
```

### Linter

Always run `npm run lint` before submitting. Rules are in `eslint.config.js`.

---

## Return Shape Reference

### Balances

```javascript
[{ code: 'BTC', free: 0.5, freezed: 0.1, total: 0.6 }]
```

### Open Orders

```javascript
[{
  orderId: '12345',          // string
  symbol: 'BTC/USDT',       // pairReadable
  symbolPlain: 'BTC-USDT',  // pairPlain
  price: 30000,             // number
  side: 'buy',              // 'buy' | 'sell'
  type: 'limit',            // 'limit' | 'market'
  timestamp: 1701820952000, // ms unix
  amount: 0.001,            // number, base amount
  amountExecuted: 0,        // number
  amountLeft: 0.001,        // number
  status: 'new',            // 'new' | 'part_filled'
  // Optional:
  fee: 0.00001,             // number
}]
```

### Order Details

```javascript
{
  orderId: '12345',
  pairReadable: 'BTC/USDT',
  pairPlain: 'BTC-USDT',
  price: 30000,              // number
  side: 'buy',
  type: 'limit',
  timestamp: 1701820952000,  // ms unix
  amount: 0.001,             // number
  volume: 30,                // number, coin2 amount
  amountExecuted: 0.001,     // number
  volumeExecuted: 30,        // number
  status: 'filled',          // 'unknown' | 'new' | 'filled' | 'part_filled' | 'cancelled'
  // Optional:
  totalFeeInCoin2: 0.03,     // number
  updateTimestamp: 1701820960000,
  tradesCount: 1,
}
```

### Order Book

```javascript
{
  bids: [{ amount: 0.5, price: 29999, count: 1, type: 'bid' }],   // desc by price
  asks: [{ amount: 0.3, price: 30001, count: 1, type: 'ask' }],   // asc by price
}
```

### Rates / Ticker

```javascript
{ ask: 30001, bid: 29999, last: 30000, volume: 1234.5, volumeInCoin2: 37035000, high: 30500, low: 29500 }
```

### Place Order

```javascript
{ orderId: '12345', message: undefined }          // Success
{ orderId: undefined, message: 'Insufficient funds' }  // Pre-check failure
undefined                                          // API error
```

### Trade History

```javascript
[{
  coin1Amount: 0.001,        // number
  price: 30000,              // number
  coin2Amount: 30,           // number
  date: 1701820952000,       // ms unix
  type: 'buy',               // 'buy' | 'sell'
  tradeId: 'abc123',         // string, optional
}]
// Sorted by timestamp ascending
```

### Fees

```javascript
[{ pair: 'BTC/USDT', makerRate: 0.001, takerRate: 0.001 }]
```

### Market Info

```javascript
{
  pairReadable: 'BTC/USDT',
  pairPlain: 'BTC-USDT',
  coin1: 'BTC',
  coin2: 'USDT',
  coin1Decimals: 8,          // number of decimal places for base amount
  coin2Decimals: 2,          // number of decimal places for quote price
  coin1Precision: 0.00000001, // smallest step for base
  coin2Precision: 0.01,       // smallest step for quote
  coin1MinAmount: 0.00001,
  coin1MaxAmount: 9000,
  coin2MinAmount: 10,         // min notional / min quote
  coin2MaxAmount: null,
  coin2MinPrice: 0.01,
  coin2MaxPrice: 1000000,
  minTrade: 10,               // Legacy, duplicates coin2MinAmount or coin1MinAmount
  status: 'ONLINE',           // 'ONLINE' | 'OFFLINE'
}
```

### Currency Info

```javascript
{
  symbol: 'USDT',
  name: 'USDT',
  status: 'ONLINE',
  comment: undefined,
  confirmations: 0,
  withdrawalFee: undefined,    // May be per-network
  minWithdrawal: undefined,
  maxWithdrawal: undefined,
  logoUrl: undefined,
  exchangeAddress: undefined,
  decimals: 8,
  precision: 0.00000001,
  minSize: undefined,
  type: undefined,
  networks: {
    ERC20: {
      withdrawalFee: 3.5,
      minWithdrawal: 10,
      confirmations: 12,
      status: 'ONLINE',
      chainName: 'ETH',       // Exchange's raw name
      chainId: 'eth',         // Exchange's raw ID, if available
      chainMappedCode: 'ERC20',     // From networks.js
      chainMappedName: 'Ethereum',  // From networks.js
    },
    // ...more networks
  },
  defaultNetwork: undefined,
}
```

### Deposit Address

```javascript
[{ network: 'ERC20', address: '0x...', memo: undefined }]
// Or on error:
{ success: false, message: 'No deposit address found' }
```

---

## Terminology Reference

| Term | Definition |
| ------ | ----------- |
| **pairReadable** | Human-readable pair format: `ADM/USDT` |
| **pairPlain** | Exchange's native pair format: `ADM-USDT`, `ADM_USDT`, `ADMUSDT` |
| **pairPerpetual** | Perpetual contract format: `ADMUSDT` (no separator) |
| **coin1 / base** | First currency in pair (the asset being traded) |
| **coin2 / quote** | Second currency in pair (the pricing currency) |
| **bid** | Buy orders (below current price, green, left side of order book) |
| **ask** | Sell orders (above current price, red, right side of order book) |
| **decimals** | Number of decimal places. `decimals=4` → `0.0041` |
| **precision** | Smallest unit derived from decimals. `decimals=4` → `precision=0.0001` |
| **isTemporary** | Error that may succeed on retry (5xx, timeouts, rate limits) |
| **publicOnly** | Create API instance without private endpoint initialization |
| **loadMarket** | Whether to fetch market/currency lists on init (default: true) |
| **reduceOnly** | Perpetual: order can only reduce position size, never increase |
| **funding rate** | Perpetual: periodic fee exchanged between longs and shorts |
| **open interest** | Perpetual: total contracts currently held on the platform |
| **margin mode** | Perpetual: `isolated` (limited loss) or `cross` (full balance at risk) |
| **position mode** | Perpetual: `oneway` (single direction) or `hedge` (both directions) |
