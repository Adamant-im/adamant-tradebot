'use strict';

const { resolveJestConfigName } = require('./scripts/jest-resolve-config');

/**
 * Injects a config suffix into argv so eager `configReader` imports do not treat
 * Jest flags as a config name. Prefer `JEST_CONFIG_NAME=<name>`; otherwise the
 * first live `config.*.jsonc` (exchange still has `trade/trader/trader_<exchange>.js`).
 */
process.argv = [process.argv[0], process.argv[1], resolveJestConfigName()];
