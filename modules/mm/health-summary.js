'use strict';

/**
 * Short health/config summary helpers for `mm on`, `mm status --short`, etc.
 *
 * @module modules/mm/health-summary
 * @typedef {import('types/bot/mm').MmDoctorSection} MmDoctorSection
 */

const terminal = require('./terminal');

/**
 * Maps doctor exit code to aggregate health label.
 *
 * @param {number} doctorCode
 * @returns {'OK' | 'WARNING' | 'FAILED'}
 */
function doctorCodeToHealth(doctorCode) {
  return doctorCode === 0 ? 'OK' : doctorCode === 2 ? 'WARNING' : 'FAILED';
}

/**
 * Prints config section status and warning/error messages.
 *
 * @param {MmDoctorSection} section Doctor Config section
 */
function printConfigSection(section) {
  console.log(`Config: ${terminal.formatStatus(section.status)}`);
  if (section.status !== 'OK' && section.messages.length) {
    for (const message of section.messages) {
      console.log(`  ${message}`);
    }
  }
}

module.exports = { doctorCodeToHealth, printConfigSection };
