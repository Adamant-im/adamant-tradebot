# AI Guide: Building a Basic Exchange Connector for Tradebot OSS

**Target audience**: AI coding assistants working in this repository.

Read `ai-agent-instructions.md` first.

Organization-wide governance rules from the ADAMANT org also apply here, especially English-only repository artifacts, issue and PR conventions, label policy, and linked governance references.

## Scope

This guide describes the preferred baseline for the open-source branch: a basic **spot REST** connector.

Current connectors in `trade/trader_*.js` are not perfectly identical yet. Some older adapters expose extra methods or structure things a bit differently. That is acceptable for now. When adding a new connector or refreshing an old one, use this guide as the target direction.

### Important constraints

- Baseline connectors are **spot only**
- Baseline connectors are **REST only**
- WebSocket support is **not required**
- Perpetual or futures support is **out of scope**
- Extended account, fee, transfer, and fund-history methods are usually **optional** in the first OSS version

The goal is a small, reliable connector that works with the existing market-making flow.

## Deliverables

### Required files

```text
trade/
├── trader_{exchange}.js
├── api/
│   ├── {exchange}_api.js
│   └── {exchange}_errors.js          # HTTP and exchange error code maps (RECOMMENDED)
├── tests/
│   ├── trader_{exchange}.test.js     # Automated Jest tests
│   ├── trader_{exchange}.mock.js     # Mock data for tests
│   └── manual.test.js                # Manual test runner (shared)
└── settings/
    └── tradeParams_{exchange}.js     # Exchange-specific param overrides (OPTIONAL)
```

### Recommended files

```text
trade/
├── settings/
│   └── tradeParams_{exchange}.js
└── api/
    └── {exchange}_errors.js

trade/tests/
├── trader_{exchange}.test.js
├── trader_{exchange}.mock.js
└── manual.test.js

types/
└── {exchange}/...
```

### Test inputs

- `config.{exchange}_test.jsonc` or another exchange-specific local config
- optional manual checks in `trade/tests/manual.test.js`

## Baseline Connector Contract

### Keep the factory signature compatible

Even when the connector is REST-only, keep the existing trader factory signature so current call sites continue to work.

```javascript
const config = require('../modules/configReader');

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
  // A basic OSS connector may ignore socket-related arguments.
};
```

### Implement this method set first

Required baseline methods:

- `features()`
- `getMarkets(pair?)`
- `marketInfo(pair)`
- `getBalances(nonzero?)`
- `getOpenOrders(pair)`
- `getOrderDetails(orderId, pair)`
- `placeOrder(side, pair, price, coin1Amount, limit, coin2Amount)`
- `cancelOrder(orderId, side, pair)`
- `cancelAllOrders(pair, side?)`
- `getRates(pair)`
- `getOrderBook(pair)`
- `getTradesHistory(pair)`

Common optional methods:

- `getCurrencies(coin?, forceUpdate?)`
- `currencyInfo(coin)`
- `getDepositAddress(coin)`
- `getFees(coinOrPair)`
- `withdraw(address, amount, coin, withdrawalFee, network)`

If an optional capability is not implemented, expose that honestly in `features()` and avoid adding stub behavior that looks successful.

## Step 1: Build the Plain API Client

**File**: `trade/api/{exchange}_api.js`

### JSDoc is required

For this repository, connector code should be documented with JSDoc in the same patch where it is added or changed.

- Add JSDoc for all public functions
- Add JSDoc for internal helper functions when their behavior is not obvious
- Document all parameters with `@param`
- Document return values with `@returns`
- Reuse typedefs from `types/*.d.js` or `types/{exchange}/` where possible
- Keep wording consistent with the repository writing style
- Update JSDoc whenever function behavior, accepted inputs, or return shapes change

This layer should only know exchange-specific HTTP details:

- base URL
- authentication headers
- request signing
- endpoint paths and parameters
- response classification

It should not normalize responses into the bot's final shapes. That belongs in `trader_{exchange}.js`.

### Recommended skeleton

```javascript
const axios = require('axios');

module.exports = function() {
  let apiServer;
  let apiKey;
  let secretKey;
  let tradePassword;
  let log;

  function setConfig(server, key, secret, pwd, logger) {
    apiServer = server;
    apiKey = key;
    secretKey = secret;
    tradePassword = pwd;
    log = logger;
  }

  function publicRequest(method, path, params) {
    const url = `${apiServer}${path}`;

    return axios({
      method,
      url,
      params,
      timeout: 10000,
    })
        .then((response) => handleResponse(response, path, params))
        .catch((error) => handleResponse(error, path, params));
  }

  function protectedRequest(method, path, data) {
    const url = `${apiServer}${path}`;
    const timestamp = Date.now();

    return axios({
      method,
      url,
      data,
      timeout: 10000,
      headers: buildHeaders(method, path, data, timestamp),
    })
        .then((response) => handleResponse(response, path, data))
        .catch((error) => handleResponse(error, path, data));
  }

  function buildHeaders(method, path, data, timestamp) {
    return {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      'X-API-SIGN': signRequest(method, path, data, timestamp, secretKey),
      'X-API-TIMESTAMP': timestamp,
      'X-API-PASSPHRASE': tradePassword,
    };
  }

  function handleResponse(responseOrError, path, payload) {
    const httpCode = responseOrError?.status || responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText || responseOrError?.response?.statusText;
    const data = responseOrError?.data || responseOrError?.response?.data;

    const result = classifyResponse(httpCode, data);

    if (result.ok) {
      return result.data;
    }

    const details = `${httpCode ?? 'No code'} ${httpMessage ?? 'No message'}`;
    const requestData = JSON.stringify(payload ?? {});

    if (result.temporary) {
      const error = new Error(`Request ${path} failed temporarily. ${details}. Payload: ${requestData}. ${result.message}`);
      log.warn(error.message);
      throw error;
    }

    log.warn(`Request ${path} failed. ${details}. Payload: ${requestData}. ${result.message}`);
    return result.data;
  }

  return {
    setConfig,
    markets() {},
    getBalances() {},
    getOrders() {},
    getOrder() {},
    addOrder() {},
    cancelOrder() {},
    cancelAllOrders() {},
    ticker() {},
    orderBook() {},
    getTradesHistory() {},
  };
};

module.exports.axios = axios;
```

### Response classification rules

At this layer, distinguish three cases:

1. Success: return parsed exchange payload
2. Temporary failure: throw or reject so the caller can retry or abort safely
3. Final failure: return structured error data so the trader adapter can decide what to do

Typical temporary failures:

- HTTP `429`
- HTTP `5xx`
- network timeout
- temporary gateway failures

Typical final failures:

- invalid API key
- invalid params
- unknown order id
- insufficient balance

### Optional error map file

If the exchange has a stable error-code catalog, create `trade/api/{exchange}_errors.js`.

```javascript
const httpErrorCodeDescriptions = {
  401: { description: 'Invalid API key' },
  429: { description: 'Rate limit exceeded', isTemporary: true },
  503: { description: 'Service unavailable', isTemporary: true },
  5: { description: 'Server error', isTemporary: true },
};

const exchangeErrorCodeDescriptions = {
  '1001': { description: 'Insufficient balance' },
  '2001': { description: 'Order does not exist' },
};

module.exports = {
  httpErrorCodeDescriptions,
  exchangeErrorCodeDescriptions,
};
```

Keep it small and useful. Do not add hundreds of speculative mappings no one will read.

## Step 2: Build the Trader Adapter

**File**: `trade/trader_{exchange}.js`

This layer converts exchange-native responses into the bot's common shapes.

### Recommended structure

```javascript
const config = require('../modules/configReader');
const utils = require('../helpers/utils');
const ExchangeApi = require('./api/{exchange}_api');

const apiServer = 'https://api.exchange.example';
const exchangeName = 'ExampleExchange';

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

  return {
    get markets() {
      return module.exports.exchangeMarkets;
    },

    get currencies() {
      return module.exports.exchangeCurrencies;
    },

    features,
    getMarkets,
    marketInfo,
    getBalances,
    getOpenOrders,
    getOrderDetails,
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    getRates,
    getOrderBook,
    getTradesHistory,
  };
};
```

### Shared module-level caches

This pattern already exists in current OSS connectors and is safe to keep.

```javascript
module.exports.exchangeMarkets = {};
module.exports.exchangeCurrencies = {};
module.exports.gettingMarkets = false;
module.exports.gettingCurrencies = false;
```

### `features()` for a basic OSS connector

Expose only what you actually support.

```javascript
function features() {
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
    selfTradeProhibited: false,
    orderNumberLimit: undefined,
    apiProcessingDelayMs: undefined,
    socketSupport: false,
    socketPullSupport: false,
    socketEnabled: false,
  };
}
```

If the exchange supports more, add only the fields you can verify.

### Pair parsing helper

Define pair formatting helpers once and reuse them.

```javascript
function formatPairName(pair) {
  const upperPair = pair?.toUpperCase();

  if (!upperPair?.includes('/')) {
    return {
      pairReadable: upperPair,
      pairPlain: upperPair,
      coin1: undefined,
      coin2: undefined,
    };
  }

  const [coin1, coin2] = upperPair.split('/');

  return {
    coin1,
    coin2,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}_${coin2}`,
  };
}
```

The exact `pairPlain` format depends on the exchange.

### `getMarkets()`

This method is the foundation for decimals, minimums, and pair validation.

Required fields per market object:

- `pairReadable`
- `pairPlain`
- `coin1`
- `coin2`
- `coin1Decimals`
- `coin2Decimals`
- `coin1Precision`
- `coin2Precision`
- `coin1MinAmount`
- `coin1MaxAmount`
- `coin2MinPrice`
- `coin2MaxPrice`
- `coin2MinAmount` when known
- `minTrade`
- `status`

Example shape:

```javascript
async function getMarkets(pair) {
  if (module.exports.gettingMarkets) return;

  if (module.exports.exchangeMarkets && pair) {
    return module.exports.exchangeMarkets[formatPairName(pair).pairPlain];
  }

  module.exports.gettingMarkets = true;

  let markets;

  try {
    markets = await exchangeApiClient.markets();
  } catch (error) {
    log.warn(`API request getMarkets() failed. ${error}`);
    module.exports.gettingMarkets = false;
    return undefined;
  }

  try {
    const result = {};

    for (const market of markets) {
      const pairNames = formatPairName(`${market.base}/${market.quote}`);

      result[pairNames.pairPlain] = {
        pairReadable: pairNames.pairReadable,
        pairPlain: pairNames.pairPlain,
        coin1: pairNames.coin1,
        coin2: pairNames.coin2,
        coin1Decimals: +market.amountPrecision,
        coin2Decimals: +market.pricePrecision,
        coin1Precision: utils.getPrecision(+market.amountPrecision),
        coin2Precision: utils.getPrecision(+market.pricePrecision),
        coin1MinAmount: +market.minAmount,
        coin1MaxAmount: +market.maxAmount || null,
        coin2MinAmount: +market.minNotional || null,
        coin2MinPrice: +market.minPrice || null,
        coin2MaxPrice: +market.maxPrice || null,
        minTrade: +market.minAmount,
        status: market.active ? 'ONLINE' : 'OFFLINE',
      };
    }

    module.exports.exchangeMarkets = result;
    return pair ? result[formatPairName(pair).pairPlain] : result;
  } catch (error) {
    log.warn(`Error while processing getMarkets() response: ${error}`);
    return undefined;
  } finally {
    module.exports.gettingMarkets = false;
  }
}
```

### `marketInfo(pair)`

Keep it simple.

```javascript
function marketInfo(pair) {
  return module.exports.exchangeMarkets?.[formatPairName(pair).pairPlain];
}
```

### Two-stage `try/catch` rule

For methods that call the exchange, use one `try/catch` for the request and one for normalization.

This avoids mixing transport failures with payload-shape failures.

### `getBalances(nonzero = true)`

Return:

```javascript
[{ code: 'BTC', free: 1.2, freezed: 0.3, total: 1.5 }]
```

On request or parsing failure, return `undefined`.

### `getOpenOrders(pair)`

Return only open or partially filled orders.

Required order fields:

- `orderId`
- `symbol`
- `price`
- `side`
- `type`
- `timestamp`
- `amount`
- `amountExecuted`
- `amountLeft`
- `status`

Allowed statuses here:

- `new`
- `part_filled`

If the exchange paginates, implement `getOpenOrdersPage()` and loop until done.

### `getOrderDetails(orderId, pair)`

This method is important for order tracking and reconciliation.

Expected statuses:

- `unknown`
- `new`
- `filled`
- `part_filled`
- `cancelled`

Recommended behavior:

- temporary API problem: `undefined`
- order not found: `{ orderId, status: 'unknown' }`
- found order: normalized detail object

### `placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount)`

This is the highest-risk method in the connector.

Required checks before sending the request:

1. the market exists
2. amount and price round correctly to exchange precision
3. rounded amount is still positive
4. minimum amount and notional constraints are satisfied
5. side and order type are mapped correctly for the exchange API

Recommended return shapes:

```javascript
{ orderId: '12345', message: 'Order placed ...' }
{ orderId: false, message: 'Insufficient funds' }
undefined
```

Do not claim success without a real exchange order id.

### `cancelOrder(orderId, side, pair)`

Recommended results:

- `true`: cancelled or already absent in a safe, understood way
- `false`: final business failure
- `undefined`: transport or processing failure

### `cancelAllOrders(pair, side)`

Prefer the exchange bulk-cancel endpoint when it exists.

### `getRates(pair)`

Return a compact ticker object:

```javascript
{
  ask: 1.01,
  bid: 1.00,
  last: 1.005,
  volume: 100000,
  volumeInCoin2: 100500,
  high: 1.08,
  low: 0.98,
}
```

### `getOrderBook(pair)`

Return:

```javascript
{
  bids: [{ amount: 10, price: 1.0, count: 1, type: 'bid-buy-left' }],
  asks: [{ amount: 12, price: 1.1, count: 1, type: 'ask-sell-right' }],
}
```

Rules:

- bids sorted by price descending
- asks sorted by price ascending
- numeric fields must be numbers, not strings

### `getTradesHistory(pair)`

Return ascending by timestamp.

```javascript
[{ coin1Amount: 10, price: 1.01, coin2Amount: 10.1, date: 1700000000000, type: 'buy', tradeId: 'abc' }]
```

## Step 3: Add Optional Currency and Deposit Methods Later

If the exchange exposes useful currency metadata, then add:

- `getCurrencies()`
- `currencyInfo()`
- `getDepositAddress()`

These are useful, but they are not the first thing that makes the market-making loop safe.

When currency networks exist, normalize network names through `helpers/networks.js` or a small exchange-specific mapping.

## Step 4: Register the Exchange

### Create a config file for testing

The runtime resolves custom config names through `node app.js <name>`, so a test file can look like this:

```jsonc
{
  "exchange": "Exampleexchange",
  "pair": "BTC/USDT",
  "apikey": "your-key",
  "apisecret": "your-secret",
  "apipassword": "",
  "admin_accounts": [],
  "socket": true,
  "api": {
    "port": 3000,
    "health": true,
    "debug": true
  },
  "db": {
    "name": "tradebotdb",
    "url": "mongodb://127.0.0.1:27017/"
  }
}
```

Save it as `config.exampleexchange_test.jsonc` and run:

```bash
node app.js exampleexchange_test
```

### Update exchange lists if needed

If the config validator or docs rely on the exchange name list, update `config.default.jsonc` accordingly.

### Add exchange-specific trade params only when necessary

If the defaults are good enough, do not create `trade/settings/tradeParams_{exchange}.js` yet.

## Step 5: Manual Testing

The practical OSS testing path is straightforward.

### Use the built-in manual runner in dev mode

`trade/tests/manual.test.js` already contains examples for direct method checks.

Useful checks:

- `features()`
- `marketInfo()`
- `getRates()`
- `getOrderBook()`
- `getTradesHistory()`
- `getOpenOrders()`
- `placeOrder()`
- `getOrderDetails()`
- `cancelOrder()`
- `cancelAllOrders()`

Run it with:

```bash
npm run start:dev
```

or

```bash
node app.js dev
```

### Minimum acceptance checklist

Before calling a basic connector ready, verify all of this:

1. `getMarkets()` loads and `marketInfo(config.pair)` returns sane decimals and minimums
2. `getRates()` returns numbers
3. `getOrderBook()` returns sorted asks and bids
4. `getTradesHistory()` returns ascending trades
5. `getBalances()` matches the exchange UI closely enough
6. `placeOrder()` returns a real order id on success
7. `getOpenOrders()` can see the placed order
8. `getOrderDetails()` reports the right status transitions
9. `cancelOrder()` or `cancelAllOrders()` removes the order cleanly

### Recommended live test sequence

Use a quiet pair and very small safe amounts.

1. Load markets and ticker
2. Place one small limit order far from market price
3. Confirm it appears in open orders
4. Fetch its order details
5. Cancel it
6. Confirm it disappears from open orders

If any of these steps are unreliable, the connector is not ready for the market-making loop.

## Step 6: Keep the First Version Small

For the OSS branch, a connector is already useful when it can support the active spot modules safely.

Do not block delivery of a good REST connector because the exchange also has:

- a WebSocket API
- a funding API
- internal account transfer APIs
- perpetual contracts
- dozens of secondary endpoints

Those can be added later if the branch genuinely starts using them.

## Explicitly Out of Scope for the Baseline

These topics are intentionally excluded from the default connector definition in this repository:

- public WebSocket subscriptions
- private WebSocket account streams
- WebSocket pull APIs
- perpetual or futures contract adapters
- leverage, margin mode, position mode, TP or SL management
- compatibility matrices for spot vs perpetual modules

If such support is ever added to this repo later, document it separately after the plain REST spot connector already works.

## Coding Rules

### Use JSDoc, but do not over-engineer it

Document public methods and include links to the exchange docs when useful.

- At minimum, every connector function should have a purpose line, `@param` entries for all parameters, and `@returns`
- Parameter descriptions should explain semantics and constraints, not only the raw type
- If a function returns `undefined` on failure, say that explicitly
- If a function normalizes exchange-specific statuses or payload fields, document that mapping

### Prefer explicit validation over permissive fallbacks

Bad:

```javascript
const orders = response?.data?.list || [];
```

Better:

```javascript
if (!Array.isArray(response?.data?.list)) {
  log.warn('Invalid getOpenOrders() payload');
  return undefined;
}
```

### Keep catch blocks safe

Catch blocks should only log and return. Do not add fragile logic there.

### Reuse repo helpers when it helps

Useful helpers already exist in:

- `helpers/utils.js`
- `helpers/networks.js`
- `trade/orderUtils.js`

### Run lint before finishing

```bash
npm run lint
```

## Return Shape Reference

### Balances

```javascript
[{ code: 'BTC', free: 0.5, freezed: 0.1, total: 0.6 }]
```

### Open orders

```javascript
[{
  orderId: '12345',
  symbol: 'BTC/USDT',
  price: 30000,
  side: 'buy',
  type: 'limit',
  timestamp: 1701820952000,
  amount: 0.001,
  amountExecuted: 0,
  amountLeft: 0.001,
  status: 'new',
}]
```

### Order details

```javascript
{
  orderId: '12345',
  pairReadable: 'BTC/USDT',
  pairPlain: 'BTC_USDT',
  price: 30000,
  side: 'buy',
  type: 'limit',
  timestamp: 1701820952000,
  amount: 0.001,
  volume: 30,
  amountExecuted: 0.001,
  volumeExecuted: 30,
  status: 'filled',
}
```

### Place order result

```javascript
{ orderId: '12345', message: 'Order placed ...' }
{ orderId: false, message: 'Insufficient funds' }
undefined
```

### Rates

```javascript
{ ask: 30001, bid: 29999, last: 30000, volume: 1234.5, volumeInCoin2: 37035000, high: 30500, low: 29500 }
```

### Order book

```javascript
{
  bids: [{ amount: 0.5, price: 29999, count: 1, type: 'bid-buy-left' }],
  asks: [{ amount: 0.3, price: 30001, count: 1, type: 'ask-sell-right' }],
}
```

### Trades history

```javascript
[{ coin1Amount: 0.001, price: 30000, coin2Amount: 30, date: 1701820952000, type: 'buy', tradeId: 'abc123' }]
```

## Final Rule of Thumb

For this repository, a good new connector is not the most feature-rich one. It is the smallest connector that safely supports spot trading, order tracking, and the active market-making modules without pretending unsupported features exist.
