'use strict';

/**
 * @typedef {Object} FormattedPairObj
 * @property {string} pair (Deprecated) The default trading pair string, ADMUSDT
 * @property {string} pairReadable A human-readable trading pair, ADM/USDT
 * @property {string} pairPlain Bybit's spot ticker, ADMUSDT
 * @property {string} pairPerpetual Bybit's perpetual contract ticker format, ADMUSDT
 * @property {string} coin1 ADM
 * @property {string} coin2 USDT
 * @property {boolean} isPerpetual Indicates if the pair is a perpetual contract
 * @property {boolean} isParsed Pair or contract successfully parsed
 */
