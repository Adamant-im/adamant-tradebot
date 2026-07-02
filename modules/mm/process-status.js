'use strict';

/**
 * Process status helpers shared by mm commands.
 *
 * Abstracts PM2 (npm mode) and Docker Compose (docker mode) behind one API.
 *
 * @module modules/mm/process-status
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmProcessStatusSummary} MmProcessStatusSummary
 */

const fs = require('fs');
const path = require('path');
const pm2 = require('./pm2');
const docker = require('./docker');

/**
 * Recursively sums file sizes under a directory.
 *
 * @param {string} dir Root directory
 * @returns {number} Total size in bytes
 */
function getDirectorySize(dir) {
  if (!fs.existsSync(dir)) {
    return 0;
  }

  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }

  return total;
}

/**
 * Formats a byte count for human-readable status output.
 *
 * @param {number} bytes Size in bytes
 * @returns {string} e.g. `24.0 MB`
 */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Returns whether the bot is running and basic process identifiers.
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<MmProcessStatusSummary>}
 */
async function getProcessStatus(ctx) {
  if (ctx.mode === 'docker') {
    const running = await docker.isServiceRunning(ctx, ctx.composeService);
    const containerId = running ? await docker.getContainerId(ctx, ctx.composeService) : undefined;
    return {
      running,
      containerId,
      source: 'docker',
    };
  }

  try {
    const proc = await pm2.getProcess(ctx.pm2ProcessName);
    const desc = pm2.describeProcess(proc);
    return {
      ...desc,
      source: 'pm2',
    };
  } finally {
    pm2.disconnect();
  }
}

/**
 * Collects log disk usage and live CPU/memory when available.
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<{ logsSize: string, cpu?: number, memory?: string }>}
 */
async function getResourceSummary(ctx) {
  const logsSize = formatBytes(getDirectorySize(ctx.logsDir));
  let cpu;
  let memory;

  if (ctx.mode !== 'docker') {
    try {
      cpu = await pm2.getCpu(ctx.pm2ProcessName);
      memory = await pm2.getMemory(ctx.pm2ProcessName);
    } finally {
      pm2.disconnect();
    }
  }

  return {
    logsSize,
    cpu,
    memory: memory ? formatBytes(memory) : undefined,
  };
}

module.exports = {
  formatBytes,
  getDirectorySize,
  getProcessStatus,
  getResourceSummary,
};
