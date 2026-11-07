'use strict';

/**
 * Support-price active flag vs stored floor.
 *
 * Legacy configs have no `mm_isPriceSupportActive`: a positive
 * `mm_priceSupportLowPrice` is the on-switch. After the flag exists,
 * `false` keeps a stored floor without enabling Price watcher support.
 *
 * @param {Record<string, unknown>} [tradeParams]
 * @returns {boolean}
 */
function isPriceSupportActive(tradeParams) {
  const price = Number(tradeParams?.mm_priceSupportLowPrice);
  const hasPrice = Number.isFinite(price) && price > 0;
  if (tradeParams?.mm_isPriceSupportActive === false) {
    return false;
  }
  return hasPrice;
}

/**
 * Floor used by Price watcher, or `0` when support price is off.
 *
 * @param {Record<string, unknown>} [tradeParams]
 * @returns {number}
 */
function getPriceSupportLowPrice(tradeParams) {
  if (!isPriceSupportActive(tradeParams)) {
    return 0;
  }
  return Number(tradeParams.mm_priceSupportLowPrice) || 0;
}

module.exports = {
  isPriceSupportActive,
  getPriceSupportLowPrice,
};
