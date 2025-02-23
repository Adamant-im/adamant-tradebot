'use strict';

/**
 * GET asset/transfer/query-account-coins-balance?accountType=SPOT
 * @see https://bybit-exchange.github.io/docs/v5/asset/balance/all-balance#response-parameters
 * @typedef {Object} AssetsItem
 * @prop {string} coin "USDT" Coin name, such as BTC, ETH, USDT, USDC.
 * @prop {string} transferBalance "80" Transferable balance.
 * @prop {string} walletBalance "100" Wallet balance.
 * @typedef {Object} AssetsResult
 * @prop {"FUND" | "SPOT" | "UNIFIED"} accountType "SPOT" Account type.
 * @prop {Array<AssetsItem>} balance [AssetsItem, ...]
 * prop {string} memberId "123456789"
 * @typedef {Object} Assets
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {string} [bybitErrorInfo] E.g., '[131203] request parameter err: accountType is invalid for current user'
 * prop {number} time 1719619515694 Response unix timestamp.
 * @prop {AssetsResult} result Object
 */

module.exports = {};
