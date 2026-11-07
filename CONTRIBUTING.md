# Contributing to ADAMANT TradeBot

Thank you for contributing to the open-source edition of ADAMANT Trading Bot!

---

## Code Requirements

- **Node.js**: `>=22.12.0` (see `package.json`)
- **Language**: JavaScript (ES2021, CommonJS modules)
- **Formatting**: ESLint (`npm run lint`)
- **Types**: JSDoc annotations checked via `npm run typecheck:webui-api`
- **Language Policy**: All code, comments, documentation, and commit messages must be in English.

---

## Directory Structure (Issue #149)

In version 10.0.0, the repository adheres to the following organization:

- `config/`: Named configuration files (`config.<name>.jsonc`). The project root acts as a fallback.
- `config.default.jsonc`: Master template configuration (stays in root).
- `trade/trader/`: Exchange adapters (`trader_azbit.js`, `trader_coinstore.js`, etc.).
- `trade/features/`: Market-making strategy modules (`mm_trader.js`, `mm_orderbook_builder.js`, etc.).
- `trade/`: Shared order utilities (`orderUtils.js`, `orderCollector.js`, `orderStats.js`).
- `helpers/`: Utilities for module iteration, logging, encryption, and math.
- `modules/`: Core configuration reader, database models, and command dispatchers.
- `api/`: Private WebUI API server.
- `tests/`: Automated Jest tests.

---

## Testing Guidelines

The project uses [Jest](https://jestjs.io/) for automated unit and integration tests.

### Do Not Run the Full Suite

**Never run bare `npm test` or bare `npx jest` without arguments.** Both are blocked by `scripts/run-jest.js` to ensure tests run in their intended scopes.

### Scoped Test Commands

```bash
# General helpers, config paths, and trade params
npm run test:general

# WebUI REST and WebSocket API
npm run test:api-webui

# Core MM feature tests (Price watcher)
npm run test:features

# Mocked exchange connector tests (Azbit, FameEXnet)
npm run test:trader

# Helpers and MM CLI suites
JEST_SCOPE=1 npx jest tests/helpers tests/mm

# Run an individual test file
npm test -- tests/trader/trader_azbit.test.js
npm test -- tests/features/mm_price_watcher.test.js
npm test -- tests/api-webui/webuiApi.test.js
```

### Config Selection in Tests

Tests that load `modules/configReader` automatically pick a valid configuration using `scripts/jest-resolve-config.js`:
1. `JEST_CONFIG_NAME` environment variable if set.
2. The first named config in `config/` matching an existing connector in `trade/trader/`.
3. `config.default.jsonc` as a fallback.

To pin a specific config during a test run:
```bash
JEST_CONFIG_NAME=azbit_adm_ezze_optimus npm run test:general
```

---

## Pull Request Guidelines

1. Ensure all scoped test suites pass.
2. Verify code quality with `npm run lint` and `npm run typecheck:webui-api`.
3. Keep code modular — use `utils.softRequire()` for optional submodules.
4. Keep fragments 1-in-1 with upstream where applicable to minimize future merge diffs.
5. Provide clear, descriptive commit messages in English.
