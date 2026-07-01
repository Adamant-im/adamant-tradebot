'use strict';

/**
 * `mm config` — show and change config parameters.
 *
 * @module modules/mm/commands/config
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const fs = require('fs');
const { spawnSync } = require('child_process');
const { createContext } = require('../context');
const configUtil = require('../config-util');
const prompts = require('../prompts');
const { runStatus } = require('./status');
const { runDoctor } = require('./doctor');
const { runRestart } = require('./restart');
const terminal = require('../terminal');

/**
 * @param {string} key Config key being edited
 * @param {unknown} current Current value
 * @returns {Promise<unknown | undefined>}
 */
async function promptNewValue(key, current) {
  if (Array.isArray(current)) {
    console.log(`Current ${key}:`);
    current.forEach((item, index) => console.log(`  ${index + 1}: ${configUtil.maskConfigValue(key, item)}`));
    return prompts.askArray(`${key} entry`);
  }

  const display = configUtil.SECRET_KEYS.has(key) ? configUtil.maskSecret(current) : String(current ?? '');
  console.log('\nCurrent value:');
  console.log(display);
  const next = await prompts.ask('\nNew value [leave empty to keep current]: ');
  if (!next) {
    return undefined;
  }

  return next;
}

/**
 * Coerces interactive input to match the current config value type.
 *
 * @param {string} key Config key (may be dotted)
 * @param {unknown} current Current config value
 * @param {unknown} raw User input from prompt
 * @returns {unknown}
 */
function coerceConfigValue(key, current, raw) {
  if (Array.isArray(current)) {
    return raw;
  }

  const leafKey = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;

  if (leafKey === 'passPhrase') {
    const phrase = String(raw);
    if (!configUtil.isPassphrase(phrase)) {
      throw new Error('Invalid ADAMANT passphrase.');
    }
    return phrase;
  }

  if (leafKey === 'pair') {
    return configUtil.normalizePair(String(raw));
  }

  if (typeof current === 'boolean') {
    const lower = String(raw).trim().toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
    throw new Error(`Expected true or false, got: ${raw}`);
  }

  if (typeof current === 'number') {
    const num = Number(String(raw).trim());
    if (!Number.isFinite(num)) {
      throw new Error(`Expected a number, got: ${raw}`);
    }
    return num;
  }

  if (current === null) {
    const lower = String(raw).trim().toLowerCase();
    if (lower === 'null') {
      return null;
    }
    return String(raw);
  }

  return String(raw);
}

/**
 * Parses $EDITOR / $VISUAL (supports args, e.g. `code --wait`).
 *
 * @param {string} editor
 * @returns {{ cmd: string, args: string[] }}
 */
function parseEditorCommand(editor) {
  /** @type {string[]} */
  const tokens = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < editor.length; i++) {
    const ch = editor[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < editor.length) {
        current += editor[++i];
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return { cmd: tokens[0] || 'vi', args: tokens.slice(1) };
}

/**
 * @param {MmContext} ctx
 */
async function openEditor(ctx) {
  const fallback = spawnSync('sh', ['-c', 'command -v nano'], { encoding: 'utf8' }).status === 0 ? 'nano' : 'vi';
  const editor = process.env.VISUAL || process.env.EDITOR || fallback;
  const { cmd, args } = parseEditorCommand(editor);
  const backupPath = configUtil.backupConfig(ctx.configPath);
  const contentBeforeEdit = fs.readFileSync(backupPath, 'utf8');
  console.log(terminal.dim(`Backup saved: ${terminal.formatUserPath(ctx, backupPath)}`));

  const result = spawnSync(cmd, [...args, ctx.configPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(terminal.red('Editor exited with an error.'));
    return 1;
  }

  const contentAfterEdit = fs.readFileSync(ctx.configPath, 'utf8');
  if (contentBeforeEdit === contentAfterEdit) {
    console.log(terminal.dim('No changes made.'));
    return 0;
  }

  const doctorCode = await runDoctor(ctx);
  if (doctorCode === 1) {
    console.error(terminal.red('\nConfig validation failed after editing.'));
    const restore = await prompts.confirm('Restore backup?');
    if (restore) {
      fs.copyFileSync(backupPath, ctx.configPath);
      console.log(terminal.green('Backup restored.'));
    }
    return 1;
  }

  const restart = await prompts.confirm('\nRestart bot to apply changes?');
  if (restart) {
    await runRestart(ctx);
  }

  return 0;
}

/**
 * Opens $EDITOR or prompts for a single config key, with optional bot restart.
 *
 * @param {MmContext} ctx Runtime context
 * @param {MmParsedArgs} args Parsed CLI arguments
 * @returns {Promise<number>} Process exit code
 */
async function runConfig(ctx, args) {
  const userConfig = configUtil.loadUserConfig(ctx.configPath);
  if (!userConfig) {
    console.error(`Config not found: ${terminal.formatUserPath(ctx, ctx.configPath)}. Run ${terminal.highlightMmCommand(ctx, 'init')}.`);
    return 1;
  }

  if (args.edit) {
    return openEditor(ctx);
  }

  const positional = args._.filter((item) => !item.startsWith('-'));
  if (!positional.length) {
    return runStatus(ctx, { short: false });
  }

  const key = positional[0];
  const current = key.includes('.') ?
    configUtil.getNestedValue(userConfig, key) :
    userConfig[key];

  if (current === undefined) {
    console.error(terminal.red(`Unknown config key: ${key}`));
    return 1;
  }

  const next = await promptNewValue(key, current);
  if (next === undefined) {
    console.log(terminal.dim('No changes made.'));
    return 0;
  }

  let valueToSave;
  try {
    valueToSave = coerceConfigValue(key, current, next);
  } catch (error) {
    console.error(terminal.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }

  configUtil.backupConfig(ctx.configPath);
  if (key.includes('.')) {
    const updated = configUtil.setNestedValue(userConfig, key, valueToSave);
    configUtil.saveConfig(ctx.configPath, updated);
  } else if (key === 'passPhrase') {
    configUtil.updatePassPhraseKey(ctx.configPath, String(valueToSave));
  } else {
    configUtil.updateConfigKey(ctx.configPath, key, valueToSave);
  }
  console.log(terminal.green('\nConfig updated.'));

  if (args.restart) {
    await runRestart(ctx);
  } else {
    const restart = await prompts.confirm('\nRestart bot to apply changes?');
    if (restart) {
      await runRestart(ctx);
    }
  }

  return 0;
}

/** @param {MmParsedArgs} args @returns {Promise<number>} */
async function config(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runConfig(ctx, args);
}

module.exports = { config, runConfig };
