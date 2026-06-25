# Contributing

> **Note:** This guide was written for the **premium** (full-featured) tradebot build. The open-source [`adamant-tradebot`](https://github.com/Adamant-im/adamant-tradebot) repository is intentionally smaller — fewer exchanges, optional strategy modules loaded via `utils.softRequire`, and simulators or connectors that may be absent in your checkout. Sections that name a specific exchange, simulator, or optional feature may therefore not apply as written.
>
> Most of the testing workflow still applies here: scoped Jest runs (never bare `npm test`), `jest.setup.js` / config selection, WebUI API suites under `tests/api-webui/`, mocked `tests/trader/trader_*.test.js` connectors that exist in this repo, and live scripts under `tests/trader_live/` when you have a matching `config.<name>.jsonc`. Skip or adapt anything that references code or configs you do not have locally.

## Tests

The project uses [Jest](https://jestjs.io/) for automated unit and integration tests, plus several Node.js scripts for interactive simulators and live exchange checks.

### Do not run the full suite

**Never run `npm test` without arguments** and **never run bare `npx jest`** — both are blocked on purpose.

The full suite is slow (trader tests may hit real exchange APIs when mocks miss), mixes unrelated areas, and is not used in day-to-day development. `jest.config.js` ignores `tests/` unless `JEST_SCOPE=1` is set by scoped npm scripts or `scripts/run-jest.js`.

Use a scoped script or an explicit file path instead.

### Quick start

```bash
npm run test:general    # utils helpers
npm run test:features   # fillsEngine, Nice Chart, liquidity
npm run test:api-webui  # WebUI API (auth, market, config)
npm run test:trader     # mocked exchange trader unit tests

# Single file
npm test -- tests/trader/trader_dextrade.test.js
npm test -- tests/api-webui/webuiApi.test.js
npm test -- tests/features/fillsEngine.test.js
npm test -- tests/general/utils.test.js

node tests/trader_live/bifinance_live_test.js bifinance_zeyo
```

Requirements: Node.js v22+, `npm i` completed. MongoDB is **not** required for most Jest suites (API tests mock the DB; trader tests mock HTTP).

### Test layout

```
tests/
├── general/          # utils.test.js, manual.test.js (manual runner)
├── api-webui/        # WebUI API Jest suites (auth, market, webui config)
├── features/         # fillsEngine, liquidity & Nice Charts (some are not Jest, see below)
├── trader/           # trader_*.test.js + *.mock.js (mocked HTTP)
└── trader_live/      # live exchange scripts (node, not Jest, see below)
```

### Config files and Jest

Many modules import `modules/configReader` at load time. Jest passes its own CLI flags in `process.argv` (`--no-cache`, `--runInBand`, …), which `configReader` would otherwise mistake for a config name and exit the worker.

`jest.setup.js` fixes this before tests run. It injects a valid config suffix into `process.argv`:

1. `JEST_CONFIG_NAME` env var, if `config.<name>.jsonc` exists
2. otherwise `config.test.jsonc`
3. otherwise `config.default.jsonc`
4. otherwise `config.dev.jsonc`
5. otherwise the first available `config.*.jsonc` in the repo root

Override for a specific run (suites that rely on `jest.setup.js` only, e.g. Nice Chart unit tests):

```bash
JEST_CONFIG_NAME=bifinance_zeyo npm test -- tests/features/nice_chart.test.js
```

`tests/features/fillsEngine.test.js` and `tests/general/utils.test.js` inject their own config name at load time and ignore `JEST_CONFIG_NAME` (first custom `config.*.jsonc` alphabetically). For Nice Chart Jest suites use `NICE_CHART_TEST_CONFIG=<name>` instead.

**Trader unit tests (`tests/trader/trader_*.test.js`) do not use a real exchange config or trade params.** They mock HTTP and pass dummy API keys. A config file may appear only because `jest.setup.js` (or an in-test `jest.mock` of `configReader`) prevents import-time crashes — see [Exchange trader Jest tests](#exchange-trader-jest-tests-mocked-connectors) below.

Ensure at least one config exists locally (`config.test.jsonc`, `config.default.jsonc`, or a named `config.<name>.jsonc`). Named configs are gitignored; copy from `config.default.jsonc` if needed:

```bash
cp config.default.jsonc config.test.jsonc
```

### Jest suites by area

| Area | Path | Config needed | Notes |
|------|------|---------------|-------|
| Helpers / utils | `tests/general/utils.test.js` | Auto (`jest.setup.js`) | Order book, depth, quote-hunter helpers |
| WebUI API | `tests/api-webui/` | Auto | Auth, market service, webui config |
| Fills engine | `tests/features/fillsEngine.test.js` | Auto | Fill processing and logging |
| Exchange traders | `tests/trader/trader_*.test.js` | Auto | Mocked HTTP per exchange API |
| Nice Chart (unit) | `tests/features/nice_chart.test.js` | Auto; optional `NICE_CHART_TEST_CONFIG` | Large Jest suite + optional CLI simulator |
| Nice Chart (gapless) | `tests/features/nice_chart.no-gap-tail.test.js` | Auto | Open/close candle integration |
| MM Nice Chart | `tests/features/mm_nice_chart.test.js` | Auto (mocked config) | Native candle precedence in `mm_nice_chart` |

**Excluded from Jest** (see `jest.config.js`):

* `tests/general/manual.test.js` — manual integration runner, not a Jest suite
* `tests/trader_live/` — live exchange scripts

### Running specific Jest suites

```bash
# One exchange
npm test -- tests/trader/trader_dextrade.test.js

# Nice Chart unit tests
JEST_CONFIG_NAME=bifinance_zeyo npm test -- tests/features/nice_chart.test.js
npm test -- tests/features/nice_chart.no-gap-tail.test.js
npm test -- tests/features/mm_nice_chart.test.js

# Helpers
npm test -- tests/general/utils.test.js
npm test -- tests/features/fillsEngine.test.js

# Debug a single file (sequential, no cache)
JEST_SCOPE=1 npx jest tests/trader/trader_dextrade.test.js --runInBand --no-cache
```

`jest.config.js` sets `forceExit: true` because some trader modules leave open handles (config file watchers, sockets). Not worth refactoring.

### Type checking (not Jest)

```bash
npm run typecheck:nice-chart   # Nice Chart / candlestick helpers
npm run typecheck:webui-api    # WebUI API TypeScript surfaces
```

### Interactive simulators (Node.js, not Jest)

These scripts need a **real config name** — the exchange and pair from that config drive the simulation.

#### Liquidity SS Test (`tests/features/liquidity_test.js`)

Interactive simulation for the Spread-Support (SS) liquidity strategy. Runs a local web server with a browser UI for visualizing bot SS orders alongside the live exchange order book.

```bash
node tests/features/liquidity_test.js <config_name> [paper|live]
```

* `config_name` — e.g. `bifinance_zeyo` for `config.bifinance_zeyo.jsonc`
* `paper` (default) — simulate SS orders locally without placing real orders
* `live` — place real SS orders on the exchange (use with caution)

Example:

```bash
node tests/features/liquidity_test.js bifinance_zeyo paper
```

Opens `http://localhost:3456` (or the next free port).

**Browser UI features:**

* Live order book with SS bot orders highlighted alongside external exchange orders
* `% Init.Mid` and `% Cur.Mid` columns — price deviation from initial/current mid
* Click any bot order row to simulate a market sweep (fill all orders up to that price)
* Controls panel: run SS iterations manually, refresh order book, reset all state
* SS Statistics panel: open/cancelled/filled counts, VWAP, total amounts and volumes
* Last Iteration Delta panel: summary of changes in the last iteration
* Trade Params and SS Constants panels (collapsed by default, click header to expand)

Stop accumulated server processes: `pkill -f liquidity_test.js`

#### Nice Chart Simulator (`tests/features/nice_chart.test.js` CLI)

Same file as the Jest suite, but run **directly with Node** for the interactive chart report (not via `npm test`).

```bash
node tests/features/nice_chart.test.js <config_name> [candles|trader] [snapshot|db] [speed=N/s] [fulllogs] [tradeParam=value...]
```

* `config_name` — config without `config.` prefix and `.jsonc` suffix
* `candles` — inspect restored/reconstructed history and per-timeframe source quality
* `trader` — compare a baseline simulation against Nice Chart on the same synthetic input cadence
* `snapshot` — seed from current exchange snapshot and short runtime history
* `db` — seed from accumulated DB history first, then extend with fresh exchange data
* `speed=N/s` — animation speed in simulated base candles per second
* `fulllogs` — print raw Nice Chart corridor logs during simulation
* `tradeParam=value` — override any `tradeParams` field, e.g. `mm_Policy=optimal`

Examples:

```bash
node tests/features/nice_chart.test.js bifinance_zeyo candles snapshot
node tests/features/nice_chart.test.js bifinance_zeyo trader db
node tests/features/nice_chart.test.js azbit_adm_ezze_optimus trader db mm_Policy=spread mm_isLiquidityActive=true fulllogs
```

Starts a local server on `http://localhost:3457` (or next free port). Report includes:

* `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `12h`, `1d` charts
* source quality markers: `native`, `reconstructed`, `db`, `degraded`, `unavailable`
* min ask / max bid overlays and optional full order book level overlays
* baseline vs Nice Chart quality metrics in `trader` mode

**Developer note:**

* Shared candle and trade history lives in `modules/marketHistory.js`
* The shared service is keyed by `exchange:pair` and can be used directly by any optional module
* Default `trade/mm_nice_chart.js` uses that same shared history service for its runtime path
* Direct consumers should use `utils.softRequire('../modules/marketHistory')` from `trade/` (path relative to the caller) and call `getSharedMarketHistoryService({ exchange, pair, traderapi, isPerpetual, ... })`
* `createNiceChartService(overrides)` still creates an isolated Nice Chart instance for tests and custom runs

For Jest runs of the same file, optional override: `NICE_CHART_TEST_CONFIG=bifinance_zeyo npm test -- tests/features/nice_chart.test.js`

### Live exchange test scripts (Node.js, real API)

These hit the **real exchange** with API keys from the named config. Use a disposable test account.

```bash
node tests/trader_live/bifinance_live_test.js <config_name>
node tests/trader_live/bifinance_live_tester.js <config_name>
node tests/trader_live/nonkyc_live_test.js <config_name>
```

Example: `node tests/trader_live/bifinance_live_test.js bifinance_zeyo`

### Manual integration runner

`tests/general/manual.test.js` is a collection of commented-out manual checks (DB, order utils, exchange APIs). It is **not** a Jest suite. In dev mode the bot calls `manual.test.run()` when `config.dev` is true. You can also load and call methods from a Node REPL after setting `process.argv[2] = '<config_name>'` before requiring `configReader`.

### Exchange trader Jest tests (mocked connectors)

```bash
npm test -- tests/trader/trader_dextrade.test.js
```

This is a **unit test of the exchange connector adapter**, not an end-to-end bot run and not a live exchange check.

#### What is being tested

The test exercises `trade/trader_<exchange>.js` — the adapter that implements the bot's unified trader interface (`getRates`, `getOrderBook`, `placeOrder`, `getBalances`, …) on top of the exchange REST API.

Indirectly, the HTTP layer in `trade/api/<exchange>_api.js` is involved too: the test mocks the shared `axios` instance exported by that module. The adapter builds URLs, signs requests, parses raw JSON, normalizes field names, converts decimals, and maps exchange-specific statuses — **that logic is what we verify**.

Typical assertions (see `tests/trader/trader_dextrade.test.js`):

* public methods return objects with the **expected unified shape** (`orderId`, `coin1Amount`, `side`, `status`, …)
* exchange-specific quirks are normalized (e.g. Dex-Trade order statuses → `new` / `filled` / `part_filled` / `cancelled`)
* market metadata (`marketInfo`) exposes decimals, pair names, limits
* candles, order book, balances, deposit addresses parse correctly from fixture JSON

The test does **not** check MM policies, order placement strategy, DB, Telegram, or `tradeParams_*` behaviour.

#### Files involved (Dex-Trade example)

| File | Role |
|------|------|
| `tests/trader/trader_dextrade.test.js` | Jest suite: wires mocks, creates trader, runs assertions |
| `tests/trader/trader_dextrade.mock.js` | Fixture responses — raw JSON as returned by the exchange API |
| `trade/trader_dextrade.js` | **Code under test** — connector adapter |
| `trade/api/dextrade_api.js` | Low-level HTTP client; its `axios` instance is intercepted |

Other exchanges follow the same pattern: `trader_binance.test.js` + `trader_binance.mock.js` → `trade/trader_binance.js` + `trade/api/binance_api.js`, etc.

#### How the mock layer works

In `beforeAll` the test:

1. Creates `axios-mock-adapter` on `require('../../trade/api/dextrade_api').axios`
2. Registers handlers per endpoint URL (regex on base URL + path)
3. Each handler returns a object from `trader_dextrade.mock.js`
4. Instantiates the trader: `createDextradeTrader('apikey', 'secret', 'pwd', log, false, false)`
5. Calls `getMarkets()` to warm the markets cache

`onNoMatch: 'passthrough'` means **unmocked requests go to the real exchange**. If a new endpoint is called or a regex does not match, the test may hit live API (slow, flaky, may fail). Mocks must cover every HTTP call the adapter makes in the tested methods.

#### Config, API keys, trade params — what is actually used

| Input | Used in mock trader test? | Notes |
|-------|---------------------------|-------|
| `config.<name>.jsonc` for the target exchange | **No** | Test is not tied to `config.dextrade_*.jsonc` or any real bot config |
| `jest.setup.js` config (`config.test.jsonc`, …) | **Sometimes** | Needed only so `configReader` does not crash on import in modules that load it eagerly |
| `trade/settings/tradeParams_*.js` | **No** | Never loaded |
| Real API keys from config | **No** | Constructor gets dummy strings (`'apikey'`, `'secret'`, …) or keys from jest setup config — mocks never validate signatures |
| Real exchange HTTP | **No** (if mocks are complete) | All responses come from `*.mock.js` |

Some connectors (e.g. Dex-Trade, BiFinance) **`jest.mock` `configReader` entirely** inside the test file with a minimal stub (`pair: 'BTC/USDT'`, `exchange: 'dextrade'`). Others read `config` from `jest.setup.js` but still only use it to pass `apikey` / `apisecret` into the constructor — the values do not affect mocked responses.

**Summary:** the pair and exchange name in the test are whatever the test (or mock config) sets — usually `BTC/USDT`. No live bot configuration is required to run `npm test -- tests/trader/trader_dextrade.test.js`.

#### Mock tests vs live tests

| | `tests/trader/trader_*.test.js` | `tests/trader_live/*_live_test.js` |
|--|--------------------------------|-------------------------------------|
| Runner | Jest (`npm test -- …`) | Node (`node tests/trader_live/… <config_name>`) |
| HTTP | Mocked (`axios-mock-adapter`) | Real exchange API |
| Config | Not required (stub / jest.setup) | **Required** — `config.<name>.jsonc` with valid keys |
| Trade params | Not used | Loaded from config's exchange |
| Purpose | Parsing, normalization, interface contract | Real connectivity, edge cases, regressions |

For new connectors, start with the mock suite, then add live scripts under `tests/trader_live/` (see `.github/exchange-connector-guide.md`).

#### All mock trader suites

One file per supported exchange connector:

`trader_binance`, `trader_binanceus`, `trader_bifinance`, `trader_bitfinex`, `trader_bitmart`, `trader_bittrex`, `trader_coinbase`, `trader_cointiger`, `trader_dextrade`, `trader_digifinex`, `trader_ftx`, `trader_gateio`, `trader_hitbtc`, `trader_huobi`, `trader_kraken`, `trader_kucoin`, `trader_latoken`, `trader_lbank`, `trader_mexc`, `trader_okcoin`, `trader_okx`, `trader_poloniex`

Each pairs with `tests/trader/trader_<exchange>.mock.js` response fixtures.

## Optional modules (`utils.softRequire`)

Use `utils.softRequire(moduleName, fromFile?)` in `helpers/utils.js` for modules that may be absent in trimmed builds (extra trade features, optional command packs, chart helpers).

| Behaviour | Detail |
|-----------|--------|
| Relative paths | Resolved from the **calling source file** (stack trace), same as a normal `require()` in that file |
| `fromFile` (optional) | Explicit absolute path as the `require` base — use in tests or when stack detection is unreliable |
| Missing module | Returns `undefined` (no throw) |
| Package names | Global `require()` as usual |

Examples:

```javascript
// modules/commands/account.js
const bw = utils.softRequire('../../trade/mm_balance_watcher');

// modules/commandTxs.js — optional /make, /remote, …
const makeModule = utils.softRequire('./commands/make');

// trade/mm_trader.js
const vv = utils.softRequire('../trade/mm_volume_volatility');

// tests — explicit base
utils.softRequire('../../helpers/const', __filename);
```

Tests: `tests/general/utils.test.js` (`describe('softRequire')`).

Command handlers live under `modules/commands/`; see `.github/ai-agent-instructions.md` (Command System, Cross-Module Communication).
