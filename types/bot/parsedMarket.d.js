'use strict';

/**
 * @typedef {Object} ParsedMarket
 * @property {string} pair Spot trading pair ADM/USDT or Perpetual contract ticker ADMUSDT
 * @property {string | undefined} perpetual Perpetual contract ticker, ADMUSDT
 * @property {string} pairReadable Readable name independent of spot or perpetual, ADM/USDT
 * @property {string} coin1 ADM
 * @property {string} coin2 USDT
 * @property {number} coin1Decimals E.g., 4
 * @property {number} coin2Decimals E.g., 6
 * @property {boolean} marketInfoSupported Exchange offers spotInfo() or instrumentInfo()
 * @property {boolean} isParsed Pair or contract successfully parsed and an exchange returned market/contract info
 * @property {Object} exchangeApi traderapi or perpetualApi instance
 * @property {boolean} isReversed DEX pair may have coin1/coin2 reversed
 */
