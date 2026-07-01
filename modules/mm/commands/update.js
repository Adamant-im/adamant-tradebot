'use strict';

/**
 * `mm update` — update the app without touching user config.
 *
 * @module modules/mm/commands/update
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const { execSync } = require('child_process');
const { createContext } = require('../context');
const docker = require('../docker');
const { runDoctor } = require('./doctor');
const { runRestart } = require('./restart');
const packageInfo = require('../../../package.json');
const terminal = require('../terminal');

/**
 * @returns {Promise<{ latest: string, notes: string[] }>}
 */
async function fetchLatestVersion() {
  try {
    const output = execSync('npm view adamant-tradebot version --json', { encoding: 'utf8' }).trim();
    const latest = JSON.parse(output);
    const notes = [];
    try {
      const notesRaw = execSync('npm view adamant-tradebot version --json 2>/dev/null', { encoding: 'utf8' });
      void notesRaw;
    } catch {
      // Release notes are optional
    }
    return { latest: String(latest), notes };
  } catch {
    return { latest: packageInfo.version, notes: [] };
  }
}

/**
 * Updates npm global package or Docker image, then runs doctor.
 *
 * User config and trade-config are never modified by this command.
 *
 * @param {MmContext} ctx Runtime context
 * @param {{ check?: boolean }} [options] When true, only prints available version
 * @returns {Promise<number>} Doctor exit code after update, or 0 for --check
 */
async function runUpdate(ctx, options = {}) {
  const current = ctx.version;
  const { latest, notes } = await fetchLatestVersion();

  if (options.check) {
    console.log(`Current version: ${terminal.dim(current)}`);
    console.log(`Latest version: ${current === latest ? terminal.green(latest) : terminal.cyan(latest)}`);
    if (notes.length) {
      console.log('\nRelease notes:');
      notes.forEach((note) => console.log(`- ${note}`));
    }
    console.log(`\n${terminal.bold('Update command')}:`);
    if (ctx.mode === 'docker') {
      console.log(terminal.highlightMmCommand(ctx, 'update'));
    } else {
      console.log(`npm install -g adamant-tradebot@latest && ${terminal.mmCommand(ctx, 'restart')}`);
    }

    console.log('');

    return 0;
  }

  if (current === latest) {
    console.log(terminal.green(`Already on latest version (${current}).`));
    return runDoctor(ctx);
  }

  console.log(`Updating from ${terminal.dim(current)} to ${terminal.cyan(latest)}…`);

  if (ctx.mode === 'docker') {
    await docker.compose(ctx, ['pull', ctx.composeService], { inherit: true });
    await docker.compose(ctx, ['up', '-d', ctx.composeService], { inherit: true });
  } else {
    execSync('npm install -g adamant-tradebot@latest', { stdio: 'inherit' });
    await runRestart(ctx);
  }

  console.log(terminal.green('\nUpdate complete. Running doctor…'));
  return runDoctor(ctx);
}

/** @param {MmParsedArgs} args @returns {Promise<number>} */
async function update(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runUpdate(ctx, { check: args.check });
}

module.exports = { update, runUpdate };
