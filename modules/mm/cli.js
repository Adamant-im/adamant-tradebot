'use strict';

/**
 * Command router for the `mm` CLI.
 *
 * Parses argv, resolves runtime context, and dispatches to subcommand modules.
 * Exit codes: 0 success, 1 command failure, 3 CLI usage/internal error.
 *
 * @module modules/mm/cli
 * @typedef {import('types/bot/mm').MmParsedArgs} ParsedArgs
 */

const { createContext } = require('./context');
const terminal = require('./terminal');
const packageInfo = require('../../package.json');

const COMMANDS = {
  init: require('./commands/init').init,
  on: require('./commands/on').on,
  off: require('./commands/off').off,
  restart: require('./commands/restart').restart,
  status: require('./commands/status').status,
  config: require('./commands/config').config,
  doctor: require('./commands/doctor').doctor,
  logs: require('./commands/logs').logs,
  update: require('./commands/update').update,
};

/**
 * Reads the next argv token for an option that requires a value.
 *
 * @param {string[]} argv
 * @param {number} index Current flag index
 * @param {string} flag Flag name for error messages
 * @returns {string}
 */
function consumeOptionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

/**
 * Parses process.argv slice into structured options and positional args.
 *
 * @param {string[]} argv Arguments after `node mm.js`
 * @returns {ParsedArgs}
 * @throws {Error} When an unknown flag is encountered
 */
function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const parsed = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--no-color') {
      parsed.noColor = true;
      continue;
    }

    if (arg === '--json') {
      parsed.json = true;
      continue;
    }

    if (arg === '--short') {
      parsed.short = true;
      continue;
    }

    if (arg === '--all') {
      parsed.all = true;
      continue;
    }

    if (arg === '--edit') {
      parsed.edit = true;
      continue;
    }

    if (arg === '--restart') {
      parsed.restart = true;
      continue;
    }

    if (arg === '-f' || arg === '--follow') {
      parsed.follow = true;
      continue;
    }

    if (arg === '--check') {
      parsed.check = true;
      continue;
    }

    if (arg === '--mode') {
      const raw = consumeOptionValue(argv, i, '--mode');
      if (raw !== 'npm' && raw !== 'docker') {
        throw new Error(`Invalid --mode value: ${raw}. Use npm or docker.`);
      }
      parsed.mode = raw;
      i++;
      continue;
    }

    if (arg === '--workdir') {
      parsed.workDir = consumeOptionValue(argv, i, '--workdir');
      i++;
      continue;
    }

    if (arg === '--tail') {
      const raw = argv[++i];
      const tail = Number(raw);
      if (!Number.isFinite(tail) || tail < 0 || !Number.isInteger(tail)) {
        throw new Error(`Invalid --tail value: ${raw ?? '(missing)'}`);
      }
      parsed.tail = tail;
      continue;
    }

    if (arg === '--since') {
      parsed.since = consumeOptionValue(argv, i, '--since');
      i++;
      continue;
    }

    if (arg === '--level') {
      parsed.level = consumeOptionValue(argv, i, '--level');
      i++;
      continue;
    }

    if (arg === '--grep') {
      parsed.grep = consumeOptionValue(argv, i, '--grep');
      i++;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!parsed.command) {
      parsed.command = arg;
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}

/** Prints usage text to stdout. */
function printHelp() {
  const { bold, cyan, dim } = terminal;
  const ctx = createContext({});
  const cliName = terminal.isHostDockerCli(ctx) ? './mm' : 'mm';

  console.log(`${bold(`\nADAMANT Market-Making Software v${packageInfo.version} CLI`)} ${dim(`(${cliName})`)}

Usage:
  ${cyan(cliName)} ${dim('<command>')} [options]

${bold('Commands')}:
  ${cyan('init')}       Interactive first-time setup
  ${cyan('on')}         Start the bot in the background
  ${cyan('off')}        Stop the bot
  ${cyan('restart')}    Restart the bot
  ${cyan('status')}     Show installation and runtime status
  ${cyan('config')}     Show or change config parameters
  ${cyan('doctor')}     Diagnose installation and runtime
  ${cyan('logs')}       Show bot logs
  ${cyan('update')}     Update the app

${bold('Options')}:
  ${dim('--mode npm|docker')}   Force install mode
  ${dim('--workdir <path>')}    Working directory for config/logs
  ${dim('--json')}              Machine-readable output (status, doctor)
  ${dim('--short')}             Short health summary (status)
  ${dim('--all')}               Stop all services (off, docker)
  ${dim('--edit')}              Open config in editor (config)
  ${dim('--restart')}           Restart after config change
  ${dim('-f, --follow')}        Follow logs
  ${dim('--tail <n>')}          Number of log lines
  ${dim('--since <duration>')}  Logs since duration (e.g. 1h)
  ${dim('--level <level>')}     Filter logs by level
  ${dim('--grep <text>')}       Filter logs by text
  ${dim('--check')}             Check for updates only
  ${dim('--no-color')}          Disable colored output
  ${dim('-h, --help')}          Show help
`);
}

/**
 * CLI entry point invoked from bin/mm.js.
 *
 * @param {string[]} argv Raw command-line arguments (without node/binary)
 * @returns {Promise<number>} Process exit code
 */
async function main(argv) {
  const args = parseArgs(argv);

  if (args.noColor) {
    terminal.setColorEnabled(false);
  }

  if (args.help || !args.command) {
    printHelp();
    return 0;
  }

  const handler = COMMANDS[args.command];
  if (!handler) {
    console.error(terminal.red(`Unknown command: ${args.command}`));
    printHelp();
    return 3;
  }

  const ctx = createContext({ mode: args.mode, workDir: args.workDir });

  if (!args.mode && ctx.installMethod === 'unknown') {
    console.error(terminal.red('Could not detect install mode. Use --mode npm or --mode docker.'));
    return 3;
  }

  return handler(args);
}

module.exports = { main, parseArgs, printHelp };
