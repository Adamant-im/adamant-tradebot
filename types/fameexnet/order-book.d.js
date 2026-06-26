/**
 * GET https://openapi.fameex.net/sapi/v1/depth
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#depth
 * @typedef {number} _price Price.
 * @typedef {number} _quantity Quantity corresponding to the current price.
 * @typedef {[_price, _quantity]} _ask
 * @typedef {[_price, _quantity]} _bid
 * @typedef {object} default
 * @prop {Array<_ask>} asks Order book selling information
 * @prop {Array<_bid>} bids Order book buying information
 * @prop {number} time Timestamp
 */

module.exports = {};
