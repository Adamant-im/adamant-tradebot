'use strict';

/**
 * Ticker 24-hour rates statistics object definition.
 * @typedef {Object} RatesResult
 * @prop {number} ask Ask price.
 * @prop {number} bid Bid price.
 * @prop {number} high 24h highest price.
 * @prop {number} last Latest price.
 * @prop {number} low 24h lowest price.
 * @prop {number} volume Trading volume in base currency.
 * @prop {number} volumeInCoin2 Trading volume in quote currency.
 * Perpetual contracts.
 * @typedef {Object} RatesPerpetualResult
 * @extends RatesResult
 * @prop {number} openInterest Open interest in base currency.
 * @prop {number} openInterestValue Open interest in quote currency.
 * @prop {number} fundingRate Funding rate, e.g. -0.0001234
 */

module.exports = class Rates {};
