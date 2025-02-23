'use strict';

/**
 * Markets object definition.
 * @typedef {Object} ResultItem
 * @prop {string} pairReadable Pair in format "BTC/USDT".
 * @prop {string} pairPlain Pair in format like "BTCUSDT", "BTC_USDT", or "BTC-USDT".
 * @prop {string} coin1 Base currency.
 * @prop {string} coin2 Quote currency.
 * @prop {number} coin1Decimals Base currency precision (digits amount after period).
 * @prop {number} coin1Precision Base currency precision in format 0.01.
 * @prop {number} coin2Decimals Quote currency precision (digits amount after period).
 * @prop {number} coin2Precision Quote currency precision in format 0.01.
 * @prop {number} [priceDecimals] Price precision (digits amount after period). For most exchanges, fallback to Quote currency.
 * @prop {number} [pricePrecision] Precision precision in format 0.01. For most exchanges, fallback to Quote currency.
 * @prop {number | null} coin1MinAmount Minimum tradeable amount of base currency.
 * @prop {number | null} coin1MaxAmount Maximum tradeable amount of base currency.
 * @prop {number | null} coin2MinAmount Minimum tradeable amount of quote currency.
 * @prop {number | null} coin2MaxAmount Maximum tradeable amount of quote currency.
 * @prop {number | null} coin2MinPrice Minimal price.
 * @prop {number | null} coin2MaxPrice Maximal price.
 * @prop {number} minTrade Duplicates coin2MinAmount or coin1MinAmount
 * @prop {"OFFLINE" | "ONLINE"} status "ONLINE"
 * @prop {boolean} [isSpotTradingAllowed] Indicates whether spot trading allowed or not.
 * @typedef {{[key: string]: ResultItem}} MarketsResult
 */

module.exports = {};
