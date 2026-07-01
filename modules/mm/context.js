'use strict';

/**
 * Install mode detection and path resolution for the `mm` CLI.
 *
 * The CLI supports two runtime modes:
 * - **npm/local** — config at `./config.jsonc`, bot managed via PM2
 * - **docker** — user data under `./docker/` on the host (`config/`, `trade-config/`, `logs/`);
 *   inside the container volumes mount at `/app/config`, `/app/trade-config`, `/app/logs`
 *
 * Mode is inferred from the environment unless `--mode` is passed explicitly.
 * Docker mode applies when running inside a container, via the `./mm` wrapper
 * (`MM_HOST_CLI=1`), or when `--mode docker` is set. Global `mm` defaults to npm.
 *
 * @module modules/mm/context
 * @typedef {import('types/bot/mm').MmMode} MmMode
 * @typedef {import('types/bot/mm').MmInstallMethod} InstallMethod
 * @typedef {import('types/bot/mm').MmContext} MmContext
 */

const fs = require('fs');
const path = require('path');

const packageInfo = require('../../package.json');

/** PM2 application name — must match `mm on` / `mm off` expectations. */
const PM2_PROCESS_NAME = 'mm-app';

/** Docker Compose service name — must match docker-compose.yml. */
const COMPOSE_SERVICE = 'mm-app';

/** Host directory for Docker Compose project and user data (config, logs). */
const DOCKER_DIR_NAME = 'docker';

/**
 * Returns the directory where the npm package is installed.
 *
 * @returns {string} Absolute package root path
 */
function getPackageRoot() {
  return path.join(__dirname, '../..');
}

/**
 * @returns {string} Absolute working directory path
 */
function getWorkDir() {
  return process.env.MM_WORKDIR ? path.resolve(process.env.MM_WORKDIR) : process.cwd();
}

/**
 * @returns {boolean} True when MM_DOCKER=1 or /.dockerenv exists
 */
function isInsideDocker() {
  return process.env.MM_DOCKER === '1' || fs.existsSync('/.dockerenv');
}

/**
 * Resolves the compose file path under `docker/docker-compose.yml`.
 *
 * @param {string} workDir Project directory
 * @returns {string | undefined}
 */
function getComposeFile(workDir) {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml']) {
    const candidate = path.join(workDir, DOCKER_DIR_NAME, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * @param {string} workDir
 * @returns {boolean}
 */
function hasComposeFile(workDir) {
  return Boolean(getComposeFile(workDir));
}

/**
 * Host path for Docker user data (`docker/`). Inside a container returns `workDir` (/app).
 *
 * @param {string} workDir
 * @returns {string}
 */
function getDockerDataRoot(workDir) {
  if (isInsideDocker()) {
    return workDir;
  }

  return path.join(workDir, DOCKER_DIR_NAME);
}

/**
 * @param {string | undefined} modeFlag
 * @param {string} workDir
 * @returns {MmMode}
 */
function resolveMode(modeFlag, workDir) {
  if (modeFlag === 'npm' || modeFlag === 'docker') {
    return modeFlag;
  }

  if (isInsideDocker() || process.env.MM_HOST_CLI === '1') {
    return 'docker';
  }

  return 'npm';
}

/**
 * @param {string} workDir
 * @param {MmMode} mode
 * @returns {string}
 */
function getConfigPath(workDir, mode) {
  if (process.env.MM_CONFIG_PATH) {
    return path.resolve(process.env.MM_CONFIG_PATH);
  }

  const dockerConfig = path.join(getDockerDataRoot(workDir), 'config', 'config.jsonc');
  const localConfig = path.join(workDir, 'config.jsonc');

  if (mode === 'docker') {
    return dockerConfig;
  }

  return localConfig;
}

/**
 * @param {string} workDir
 * @param {MmMode} mode
 * @returns {string}
 */
function getTradeSettingsDir(workDir, mode) {
  if (process.env.MM_TRADE_SETTINGS_DIR) {
    return path.resolve(process.env.MM_TRADE_SETTINGS_DIR);
  }

  const dockerDir = path.join(getDockerDataRoot(workDir), 'trade-config');
  if (mode === 'docker') {
    return dockerDir;
  }

  return path.join(getPackageRoot(), 'trade', 'settings');
}

/**
 * @param {string} workDir
 * @param {MmMode} mode
 * @returns {string}
 */
function getLogsDir(workDir, mode) {
  if (mode === 'docker' || isInsideDocker()) {
    return path.join(getDockerDataRoot(workDir), 'logs');
  }

  return path.join(workDir, 'logs');
}

/**
 * @param {MmMode} mode
 * @param {string} workDir
 * @returns {InstallMethod}
 */
function detectInstallMethod(mode, workDir) {
  if (mode === 'docker' || isInsideDocker()) {
    return 'docker';
  }

  if (process.argv[1]?.includes(`${path.sep}node_modules${path.sep}`)) {
    return 'npm';
  }

  const packageRoot = getPackageRoot();
  if (fs.existsSync(path.join(workDir, '.git')) && fs.existsSync(path.join(workDir, 'app.js'))) {
    return 'git-manual';
  }

  if (workDir !== packageRoot && fs.existsSync(path.join(packageRoot, 'package.json'))) {
    return 'npm';
  }

  if (fs.existsSync(path.join(workDir, 'package.json')) && fs.existsSync(path.join(workDir, 'app.js'))) {
    return 'git-manual';
  }

  return 'unknown';
}

/**
 * @param {{ mode?: string, workDir?: string }} [options]
 * @returns {MmContext}
 */
function createContext(options = {}) {
  const workDir = options.workDir ? path.resolve(options.workDir) : getWorkDir();
  const mode = resolveMode(options.mode, workDir);
  const configPath = getConfigPath(workDir, mode);
  const composeFile = getComposeFile(workDir);

  if (process.env.MM_CLI === '1') {
    process.env.MM_CONFIG_PATH = configPath;
  }

  return {
    mode,
    installMethod: detectInstallMethod(mode, workDir),
    workDir,
    packageRoot: getPackageRoot(),
    configPath,
    tradeSettingsDir: getTradeSettingsDir(workDir, mode),
    logsDir: getLogsDir(workDir, mode),
    composeFile,
    composeProjectDir: composeFile ? path.dirname(composeFile) : undefined,
    pm2ProcessName: PM2_PROCESS_NAME,
    composeService: COMPOSE_SERVICE,
    version: packageInfo.version,
    mmExecutable: process.argv[1] || 'mm',
  };
}

/**
 * @param {MmContext} ctx
 */
function ensureLayoutDirs(ctx) {
  const configDir = path.dirname(ctx.configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(ctx.logsDir)) {
    fs.mkdirSync(ctx.logsDir, { recursive: true });
  }

  if (ctx.mode === 'docker' && !fs.existsSync(ctx.tradeSettingsDir)) {
    fs.mkdirSync(ctx.tradeSettingsDir, { recursive: true });
  }
}

/**
 * @param {MmContext} ctx
 * @returns {string}
 */
function getAppEntry(ctx) {
  return path.join(ctx.packageRoot, 'app.js');
}

module.exports = {
  createContext,
  ensureLayoutDirs,
  getAppEntry,
  getComposeFile,
  getDockerDataRoot,
  getPackageRoot,
  getWorkDir,
  hasComposeFile,
  isInsideDocker,
  resolveMode,
};
