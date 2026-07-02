'use strict';

/**
 * Interactive readline prompts for the `mm` CLI, `mm init`, and `mm config` wizards.
 *
 * @module modules/mm/prompts
 */

const readline = require('readline');
const terminal = require('./terminal');

/**
 * Asks a free-form question and returns the trimmed answer.
 *
 * @param {string} question Prompt text (without trailing space)
 * @returns {Promise<string>} User input
 */
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Yes/no confirmation with configurable default.
 *
 * @param {string} question Prompt text
 * @param {boolean} [defaultYes=false] Return value when user presses Enter
 * @returns {Promise<boolean>}
 */
async function confirm(question, defaultYes = false) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${suffix} `)).toLowerCase();

  if (!answer) {
    return defaultYes;
  }

  return answer === 'y' || answer === 'yes';
}

/**
 * Prompts for a value, returning the default when input is empty.
 *
 * @param {string} label Field label
 * @param {string} [defaultValue=''] Default shown in brackets
 * @returns {Promise<string>}
 */
async function askWithDefault(label, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await ask(`${label}${suffix}: `);
  return answer || defaultValue;
}

/**
 * Numbered menu selection (1-based index).
 *
 * @param {string} label Menu title
 * @param {string[]} choices Option labels
 * @returns {Promise<string>} Selected choice string
 */
async function choose(label, choices) {
  console.log(terminal.bold(label));
  choices.forEach((choice, index) => {
    console.log(`  ${terminal.cyan(String(index + 1))}. ${choice}`);
  });

  while (true) {
    const answer = await ask('Enter number: ');
    const index = Number(answer) - 1;
    if (index >= 0 && index < choices.length) {
      return choices[index];
    }
    console.log(terminal.red('Invalid choice, try again.'));
  }
}

/**
 * Collects array items until the user submits an empty line.
 *
 * Used for `admin_accounts` and similar list fields in `mm config`.
 *
 * @param {string} label Prefix printed before the index (e.g. `admin_accounts entry`)
 * @returns {Promise<string[]>}
 */
async function askArray(label) {
  /** @type {string[]} */
  const values = [];
  let index = 1;

  while (true) {
    const value = await ask(`${label} ${index}: `);
    if (!value) {
      break;
    }
    values.push(value);
    index += 1;
  }

  return values;
}

module.exports = {
  ask,
  askArray,
  askWithDefault,
  choose,
  confirm,
};
