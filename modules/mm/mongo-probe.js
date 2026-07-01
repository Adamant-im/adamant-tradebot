'use strict';

/**
 * MongoDB connectivity probes for `mm doctor` and `mm status`.
 *
 * Docker configs use `mongodb://mongo:27017/` — resolvable only inside the stack.
 * When the CLI runs on the host, probes MongoDB via `docker compose exec mongo`.
 *
 * @module modules/mm/mongo-probe
 * @typedef {import('types/bot/mm').MmContext} MmContext
 */

const { MongoClient } = require('mongodb');
const { isInsideDocker } = require('./context');
const docker = require('./docker');
const { formatBytes } = require('./process-status');

const DEFAULT_URL = 'mongodb://127.0.0.1:27017/';
const DEFAULT_NAME = 'tradebotdb';
const DOCKER_MONGO_SERVICE = 'mongo';

/**
 * @param {Record<string, unknown>} userConfig
 * @returns {{ url: string, name: string, options: object }}
 */
function parseDbConfig(userConfig) {
  const dbConfig = /** @type {{ url?: string, name?: string, options?: object }} */ (userConfig.db || {});
  return {
    url: dbConfig.url || DEFAULT_URL,
    name: dbConfig.name || DEFAULT_NAME,
    options: dbConfig.options || { serverSelectionTimeoutMS: 3000 },
  };
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function usesDockerMongoHost(url) {
  try {
    const normalized = url.replace(/^mongodb(\+srv)?:\/\//, 'http://');
    const hostname = new URL(normalized).hostname;
    return hostname === DOCKER_MONGO_SERVICE;
  } catch {
    return url.includes(`://${DOCKER_MONGO_SERVICE}:`) || url.includes(`://${DOCKER_MONGO_SERVICE}/`);
  }
}

/**
 * @param {MmContext} ctx
 * @param {string} url
 * @returns {boolean}
 */
function shouldProbeMongoViaDockerExec(ctx, url) {
  return ctx.mode === 'docker' && !isInsideDocker() && usesDockerMongoHost(url) && docker.canUseHostCompose(ctx);
}

/**
 * @param {number | undefined} dataSize
 * @param {string | undefined} statsError
 * @returns {string}
 */
function formatDataSize(dataSize, statsError) {
  if (typeof dataSize === 'number') {
    return formatBytes(dataSize);
  }

  if (statsError?.includes('dbStats') || statsError?.includes('API Version')) {
    return 'connected';
  }

  return statsError ? 'unavailable' : 'connected';
}

/**
 * @param {string} url
 * @param {string} name
 * @param {object} options
 * @param {{ writeProbe?: boolean }} [probeOptions]
 * @returns {Promise<{ dataSize?: number, statsError?: string }>}
 */
async function probeMongoDirect(url, name, options, probeOptions = {}) {
  let client;
  try {
    client = new MongoClient(url, options);
    await client.connect();
    const db = client.db(name);
    await db.command({ ping: 1 });

    if (probeOptions.writeProbe) {
      await db.collection('_mm_doctor_probe').insertOne({ ts: new Date() });
      await db.collection('_mm_doctor_probe').deleteMany({});
    }

    try {
      const stats = await db.stats();
      return { dataSize: stats.dataSize || 0 };
    } catch (statsError) {
      return {
        statsError: String(statsError instanceof Error ? statsError.message : statsError),
      };
    }
  } finally {
    await client?.close().catch(() => undefined);
  }
}

/**
 * @param {MmContext} ctx
 * @param {string} name
 * @param {{ writeProbe?: boolean }} [probeOptions]
 * @returns {Promise<{ dataSize?: number, statsError?: string }>}
 */
async function probeMongoViaDockerExec(ctx, name, probeOptions = {}) {
  const running = await docker.isServiceRunning(ctx, DOCKER_MONGO_SERVICE);
  if (!running) {
    throw new Error('MongoDB Docker service is not running.');
  }

  const safeName = name.replace(/'/g, '');
  /** @type {string[]} */
  const statements = [
    `db = db.getSiblingDB('${safeName}');`,
    'db.adminCommand({ ping: 1 });',
  ];

  if (probeOptions.writeProbe) {
    statements.push(
        'db.getCollection("_mm_doctor_probe").insertOne({ ts: new Date() });',
        'db.getCollection("_mm_doctor_probe").deleteMany({});',
    );
  }

  statements.push('print(JSON.stringify({ dataSize: db.stats().dataSize }));');

  const result = await docker.compose(ctx, [
    'exec', '-T', DOCKER_MONGO_SERVICE,
    'mongosh', '--quiet', '--eval', statements.join(' '),
  ]);

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'mongosh exec failed');
  }

  const match = result.stdout.match(/\{[\s\S]*"dataSize"[\s\S]*\}/);
  if (!match) {
    return { statsError: 'Could not read database stats from mongosh output' };
  }

  try {
    const parsed = JSON.parse(match[0]);
    return { dataSize: typeof parsed.dataSize === 'number' ? parsed.dataSize : undefined };
  } catch {
    return { statsError: 'Could not parse database stats from mongosh output' };
  }
}

/**
 * @param {MmContext} ctx
 * @param {Record<string, unknown>} userConfig
 * @param {{ writeProbe?: boolean }} [probeOptions]
 * @returns {Promise<{ url: string, name: string, displaySize: string, dataSize?: number, statsError?: string, viaDockerExec?: boolean }>}
 */
async function probeMongo(ctx, userConfig, probeOptions = {}) {
  const { url, name, options } = parseDbConfig(userConfig);

  if (shouldProbeMongoViaDockerExec(ctx, url)) {
    const result = await probeMongoViaDockerExec(ctx, name, probeOptions);
    return {
      url,
      name,
      viaDockerExec: true,
      dataSize: result.dataSize,
      statsError: result.statsError,
      displaySize: formatDataSize(result.dataSize, result.statsError),
    };
  }

  const result = await probeMongoDirect(url, name, options, probeOptions);
  return {
    url,
    name,
    dataSize: result.dataSize,
    statsError: result.statsError,
    displaySize: formatDataSize(result.dataSize, result.statsError),
  };
}

module.exports = {
  parseDbConfig,
  probeMongo,
  shouldProbeMongoViaDockerExec,
  usesDockerMongoHost,
};
