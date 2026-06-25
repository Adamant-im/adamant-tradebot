/**
 * GET https://openapi.fameex.net/sapi/v1/symbols
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#symbol-pair-list
 * @typedef {object} _item
 * @prop {string} baseAsset Base asset for the symbol
 * @prop {number} limitPriceMin Minimum price limit for limit orders
 * @prop {number} limitVolumeMin Minimum quantity limit for limit order
 * @prop {number} marketBuyMin Minimum purchase quantity for market order
 * @prop {number} marketSellMin Minimum selling quantity for market orders
 * @prop {number} pricePrecision Price accuracy
 * @prop {number} quantityPrecision Quantity accuracy
 * @prop {string} quoteAsset Quote asset for the symbol
 * @prop {string} symbol Symbol name
 * @typedef {object} default
 * @prop {Array<_item>} symbols Object
 */

module.exports = {};
