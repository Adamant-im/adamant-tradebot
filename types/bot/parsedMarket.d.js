'use strict';

/**
 * @typedef {Object} ParsedMarket
 * @property {string} pair Spot trading pair (e.g., `ADM/USDT`) or perpetual contract ticker (e.g., `ADMUSDT`)
 * @property {boolean} isPerpetual Whether the market is a perpetual contract
 * @property {string | undefined} perpetual Perpetual contract ticker (e.g., `ADMUSDT`). If the market is not a perpetual contract, the value is `undefined`.
 * @property {string} pairReadable "Readable" pair name, independent of spot or perpetual format (e.g., `ADM/USDT`)
 * @property {string} coin1 Base asset (e.g., `ADM`)
 * @property {string} coin2 Quote asset (e.g., `USDT`)
 * @property {number} coin1Decimals Number of decimals for the base asset (e.g., `4`)
 * @property {number} coin2Decimals Number of decimals for the quote asset (e.g., `6`)
 * @property {number} coin2DecimalsForStable Number of sufficient decimal places to use for the quote asset when it is a stablecoin (e.g., `4`). Use it for amounts, don't use it for price.
 * @property {boolean} marketInfoSupported Whether the exchange provides `spotInfo()` or `instrumentInfo()`
 * @property {boolean} isParsed Whether the pair or contract was successfully parsed and market/contract info was returned by the exchange
 * @property {Object} exchangeApi The `traderapi` or `perpetualApi` instance associated with this market (public only)
 * @property {boolean} isReversed Whether the DEX pair uses reversed coin1/coin2 order
 */

module.exports = {};
