'use strict';

/**
 * Docker Compose helpers for docker mode.
 *
 * Host-only: `./mm` runs Compose on the host. Inside a container, use runtime probes instead.
 *
 * @module modules/mm/docker
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmShellResult} MmShellResult
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const shell = require('./shell');
const { isInsideDocker } = require('./context');
const configUtil = require('./config-util');

const MM_CLI = ['node', 'bin/mm.js'];

/**
 * @returns {boolean}
 */
function canUseHostCompose(ctx) {
  return !isInsideDocker() && Boolean(ctx.composeFile);
}

/**
 * @returns {string[]} argv prefix, e.g. `['docker', 'compose']`
 */
function composeBaseArgs() {
  const compose = shell.getDockerComposeCommand();
  if (!compose) {
    throw new Error('Docker Compose is not installed. Install Docker Desktop or docker-compose.');
  }

  return compose.split(' ');
}

/**
 * @param {MmContext} ctx
 * @returns {{ composeFile: string, projectDir: string }}
 */
function resolveComposeTarget(ctx) {
  if (!canUseHostCompose(ctx)) {
    throw new Error('Docker Compose commands run on the host via ./mm, not inside the container.');
  }

  return {
    composeFile: /** @type {string} */ (ctx.composeFile),
    projectDir: ctx.composeProjectDir || path.dirname(/** @type {string} */ (ctx.composeFile)),
  };
}

/**
 * @param {MmContext} ctx
 * @param {string[]} args Compose subcommand and flags
 * @param {{ inherit?: boolean }} [options]
 * @returns {Promise<MmShellResult>}
 */
async function compose(ctx, args, options = {}) {
  const { composeFile, projectDir } = resolveComposeTarget(ctx);
  const base = composeBaseArgs();
  return shell.run(base[0], [...base.slice(1), '-f', composeFile, ...args], {
    cwd: projectDir,
    inherit: options.inherit,
  });
}

/**
 * @returns {boolean}
 */
function isAppEntryRunningLocally() {
  try {
    return fs.readFileSync('/proc/1/cmdline', 'utf8').includes('app.js');
  } catch {
    return false;
  }
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<boolean>}
 */
function probeTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * @returns {string | undefined}
 */
function getLocalContainerId() {
  try {
    const hostname = fs.readFileSync('/etc/hostname', 'utf8').trim();
    if (/^[0-9a-f]{12}$/i.test(hostname)) {
      return hostname;
    }

    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
    const match = cgroup.match(/([0-9a-f]{64})/i);
    return match ? match[1].slice(0, 12) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {MmContext} ctx
 * @returns {number | undefined}
 */
function resolveApiPort(ctx) {
  const userConfig = configUtil.loadUserConfig(ctx.configPath);
  const api = userConfig?.api;
  const apiPort = api && typeof api === 'object' && api !== null && 'port' in api ?
    /** @type {{ port?: number | false }} */ (api).port :
    undefined;
  return typeof apiPort === 'number' && apiPort > 0 ? apiPort : undefined;
}

/**
 * One-off `docker compose run` containers include `-run-` in the name.
 *
 * @param {string} nameOrLine Container name or `docker compose ps` line
 * @returns {boolean}
 */
function isEphemeralRunContainer(nameOrLine) {
  return nameOrLine.includes('-run-');
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @returns {Promise<Array<{ name: string, id: string }>>}
 */
async function listRunningContainers(ctx, service) {
  const result = await compose(ctx, [
    'ps', '--status', 'running', '--format', '{{.Name}}\t{{.ID}}', service,
  ]);

  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout.trim().split('\n').map((line) => {
    const [name, id] = line.split('\t');
    return { name: name || '', id: id || '' };
  }).filter((entry) => entry.name && entry.id);
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @returns {Promise<boolean>}
 */
async function isMainServiceRunning(ctx, service) {
  const containers = await listRunningContainers(ctx, service);
  return containers.some((entry) => !isEphemeralRunContainer(entry.name));
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @returns {Promise<string | undefined>}
 */
async function getMainContainerId(ctx, service) {
  const containers = await listRunningContainers(ctx, service);
  const main = containers.find((entry) => !isEphemeralRunContainer(entry.name));
  return main?.id.slice(0, 12);
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @param {{ inherit?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function stopService(ctx, service, options = {}) {
  await compose(ctx, ['stop', service], options);

  const containers = await listRunningContainers(ctx, service);
  for (const entry of containers) {
    if (isEphemeralRunContainer(entry.name)) {
      await shell.run('docker', ['stop', entry.id], { inherit: options.inherit });
    }
  }
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @returns {Promise<boolean>}
 */
async function isServiceRunning(ctx, service) {
  if (isInsideDocker()) {
    if (isAppEntryRunningLocally()) {
      return true;
    }

    const apiPort = resolveApiPort(ctx);
    if (apiPort) {
      if (await probeTcp(service, apiPort)) {
        return true;
      }
      if (await probeTcp('localhost', apiPort)) {
        return true;
      }
    }

    return false;
  }

  if (!ctx.composeFile) {
    return false;
  }

  return isMainServiceRunning(ctx, service);
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @returns {Promise<string | undefined>}
 */
async function getContainerId(ctx, service) {
  if (isInsideDocker()) {
    return isAppEntryRunningLocally() ? getLocalContainerId() : undefined;
  }

  if (!canUseHostCompose(ctx)) {
    return undefined;
  }

  return getMainContainerId(ctx, service);
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @param {string[]} mmArgs
 * @param {{ inherit?: boolean }} [options]
 * @returns {Promise<MmShellResult>}
 */
async function runMm(ctx, service, mmArgs, options = {}) {
  return compose(ctx, ['run', '--rm', service, ...MM_CLI, ...mmArgs], options);
}

/**
 * @param {MmContext} ctx
 * @param {string} service
 * @param {string[]} mmArgs
 * @param {{ inherit?: boolean }} [options]
 * @returns {Promise<MmShellResult>}
 */
async function execMm(ctx, service, mmArgs, options = {}) {
  return compose(ctx, ['exec', service, ...MM_CLI, ...mmArgs], options);
}

module.exports = {
  canUseHostCompose,
  compose,
  composeBaseArgs,
  execMm,
  getContainerId,
  getMainContainerId,
  isAppEntryRunningLocally,
  isEphemeralRunContainer,
  isMainServiceRunning,
  isServiceRunning,
  listRunningContainers,
  runMm,
  stopService,
};
