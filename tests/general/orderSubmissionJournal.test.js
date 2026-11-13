'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { appendSubmissionEvent } = require('../../helpers/orderSubmissionJournal');

let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-submission-journal-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

test('journal retains normalized uncertain intent and recovered exchange identity across independent reads', () => {
  const intent = { clientOrderId: 'tb_0123456789abcdef01', pair: 'C98/USDT', side: 'buy', type: 'LIMIT',
    quantity: '500.1', price: '0.012' };
  appendSubmissionEvent('xt', '0123456789abcdef', { ...intent, state: 'pending' }, directory);
  appendSubmissionEvent('xt', '0123456789abcdef', { ...intent, state: 'recovered', orderId: '6216559590087220004' }, directory);
  const file = path.join(directory, 'xt-0123456789abcdef.jsonl');
  const contents = fs.readFileSync(file, 'utf8');
  expect(contents.match(/\n/g)).toHaveLength(2);
  const rows = contents.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  expect(rows).toEqual([
    expect.objectContaining({ ...intent, exchange: 'xt', state: 'pending', timestamp: expect.any(Number) }),
    expect.objectContaining({ ...intent, exchange: 'xt', state: 'recovered', orderId: '6216559590087220004' }),
  ]);
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
});

test('journals for different credential fingerprints are isolated', () => {
  const event = { clientOrderId: 'tb_0123456789abcdef01', pair: 'C98/USDT', side: 'buy', type: 'LIMIT', state: 'uncertain' };
  for (const account of ['0123456789abcdef', 'fedcba9876543210']) appendSubmissionEvent('xt', account, event, directory);
  expect(fs.readdirSync(directory)).toHaveLength(2);
});

test('default journal follows the working directory rather than the installed package location', () => {
  const script = [
    "const { appendSubmissionEvent } = require(process.argv[1]);",
    "appendSubmissionEvent('xt', '0123456789abcdef', {",
    "  clientOrderId: 'test_cwd', pair: 'C98/USDT', side: 'buy', type: 'LIMIT', state: 'uncertain'",
    '});',
  ].join('\n');
  const child = spawnSync(process.execPath, ['-e', script, require.resolve('../../helpers/orderSubmissionJournal')], {
    cwd: directory,
    encoding: 'utf8',
  });

  expect(child.stderr).toBe('');
  expect(child.status).toBe(0);
  const file = path.join(directory, 'logs/order-submissions/xt-0123456789abcdef.jsonl');
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ clientOrderId: 'test_cwd', state: 'uncertain' });
});

test('invalid identities cannot write outside the journal directory', () => {
  const event = { clientOrderId: 'test', pair: 'C98/USDT', side: 'buy', type: 'LIMIT', state: 'uncertain' };
  expect(() => appendSubmissionEvent('../outside', '0123456789abcdef', event, directory)).toThrow('identity');
  expect(() => appendSubmissionEvent('xt', '../outside', event, directory)).toThrow('identity');
  expect(fs.readdirSync(directory)).toEqual([]);
});

test('storage errors propagate to the caller instead of claiming durable evidence', () => {
  const file = path.join(directory, 'not-a-directory');
  fs.writeFileSync(file, 'existing file');
  expect(() => appendSubmissionEvent('xt', '0123456789abcdef',
      { clientOrderId: 'test', pair: 'C98/USDT', side: 'buy', type: 'LIMIT', state: 'uncertain' }, file)).toThrow();
});

test('caller-controlled rotation retains four previous segments and keeps a separate uncertainty stream', () => {
  const intent = { clientOrderId: 'adm-test', pair: 'CHESS/USDT', side: 'buy', type: 'LIMIT', state: 'pending' };
  const account = '0123456789abcdef';
  const file = path.join(directory, `qutrade-${account}.jsonl`);
  const uncertainFile = path.join(directory, `qutrade-${account}-uncertain.jsonl`);
  const uncertain = { ...intent, state: 'uncertain', orderId: '3708000' };
  const maxBytes = 4 * 1024 * 1024;

  appendSubmissionEvent('qutrade', account, uncertain, directory, { stream: 'uncertain' });
  fs.writeFileSync(file, '');
  fs.truncateSync(file, maxBytes);
  for (let index = 1; index <= 4; index++) fs.writeFileSync(`${file}.${index}`, String(index));

  appendSubmissionEvent('qutrade', account, intent, directory, { rotation: { maxBytes, archives: 4 } });

  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject(intent);
  expect(JSON.parse(fs.readFileSync(uncertainFile, 'utf8'))).toMatchObject(uncertain);
  expect(fs.statSync(`${file}.1`).size).toBe(maxBytes);
  expect(fs.readFileSync(`${file}.4`, 'utf8')).toBe('3');
  expect(fs.readdirSync(directory)).toHaveLength(6);
});
