'use strict';

/**
 * GET https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT
 * @see https://bybit-exchange.github.io/docs/v5/market/tickers#response-parameters
 * @typedef {Object} TickersItem
 * @prop {string} highPrice24h "63452.38" The highest price in the last 24 hours.
 * @prop {string} lowPrice24h "61406.94" The lowest price in the last 24 hours.
 * @prop {string} lastPrice "61782.97" Latest price.
 * @prop {string} turnover24h "408053097.049289" Trading volume in quote currency.
 * @prop {string} volume24h "6504.094744" Trading volume in base currency.
 * @prop {string} bid1Price "61782.97" Best bid price.
 * @prop {string} ask1Price "61782.98" Best ask price.
 * @prop {string} openInterest "123456.1" Open interest in base currency.
 * @prop {string} openInterestValue "6172835000.2" Open interest in quote currency.
 * @prop {string} fundingRate "-0.0001234" Funding rate.
 * @typedef {Object} TickersList
 * @prop {Array<TickersItem>} list [TickersItem, ...]
 * @typedef {Object} Tickers
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {TickersList} result { list: [TickersItem, ...] }
 */

module.exports = {};
