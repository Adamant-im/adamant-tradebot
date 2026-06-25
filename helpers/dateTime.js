'use strict';

/**
 * Local date/time formatting helpers for logs and notifications.
 *
 * @module helpers/dateTime
 */

/**
 * @typedef {import('types/bot/helpers.d.js').FormattedDate} FormattedDate
 */

/**
 * Returns the current local time as `hh:mm:ss`.
 *
 * @returns {string}
 */
function time() {
  const formatted = formatDate(Date.now());
  return formatted ? formatted.hh_mm_ss : '';
}

/**
 * Returns the current local date as `YYYY-MM-DD`.
 *
 * @returns {string}
 */
function date() {
  const formatted = formatDate(Date.now());
  return formatted ? formatted.YYYY_MM_DD : '';
}

/**
 * Returns the current local date and time as `YYYY-MM-DD hh:mm:ss`.
 *
 * @returns {string}
 */
function fullTime() {
  return `${date()} ${time()}`;
}

/**
 * Formats a Unix timestamp (milliseconds) into date/time parts and pre-built strings.
 *
 * @param {number} timestamp Unix timestamp in milliseconds
 * @returns {FormattedDate | false} Formatted parts, or `false` when `timestamp` is falsy
 */
function formatDate(timestamp) {
  if (!timestamp) {
    return false;
  }

  const formattedDate = /** @type {FormattedDate} */ ({});
  const dateObject = new Date(timestamp);

  formattedDate.year = dateObject.getFullYear();
  formattedDate.month = (`0${dateObject.getMonth() + 1}`).slice(-2);
  formattedDate.date = (`0${dateObject.getDate()}`).slice(-2);
  formattedDate.hours = (`0${dateObject.getHours()}`).slice(-2);
  formattedDate.minutes = (`0${dateObject.getMinutes()}`).slice(-2);
  formattedDate.seconds = (`0${dateObject.getSeconds()}`).slice(-2);
  formattedDate.YYYY_MM_DD = `${formattedDate.year}-${formattedDate.month}-${formattedDate.date}`;
  formattedDate.YYYY_MM_DD_hh_mm = `${formattedDate.YYYY_MM_DD} ${formattedDate.hours}:${formattedDate.minutes}`;
  formattedDate.hh_mm_ss = `${formattedDate.hours}:${formattedDate.minutes}:${formattedDate.seconds}`;

  return formattedDate;
}

module.exports = {
  time,
  date,
  fullTime,
};
