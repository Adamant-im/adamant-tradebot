#!/usr/bin/env node
'use strict';

/**
 * ADAMANT Market-Making Software installer and maintenance CLI entrypoint.
 *
 * Exposed on PATH as `mm` and `adamant-tradebot` via package.json bin map.
 * This is intentionally separate from `bin/cli.js`, which sends trading commands
 * to an already running bot instance (`/balances`, `/start`, …).
 *
 * Unhandled promise rejections exit with code 3 (CLI/internal error).
 *
 * @module bin/mm
 * @typedef {import('types/bot/mm').MmCliModule} MmCliModule
 */

process.env.MM_CLI = '1';

require('../modules/mm/silence-diagnostics').installDiagnosticSilence();

/** @type {MmCliModule} */
const mmCli = require('../modules/mm/cli.js');

mmCli.main(process.argv.slice(2)).then((code) => {
  process.exit(typeof code === 'number' ? code : 0);
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
});
