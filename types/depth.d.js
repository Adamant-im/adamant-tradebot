/**
 * Order book (market depth) object definition.
 *
 * @typedef {Object} DepthItem
 * @prop {number} amount Base coin volume
 * @prop {number} count Order count
 * @prop {number} price Order price
 * @prop {'sell' | 'buy'} side Order side
 *
 * @typedef {Object} DepthResult
 * @prop {Array<DepthItem>} asks Ask price
 * @prop {Array<DepthItem>} bids Bid price
 */

module.exports = {};
