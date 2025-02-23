'use strict';

/**
 * GET https://api.bybit.com/v5/account/wallet-balance?accountType=SPOT
 * @see https://bybit-exchange.github.io/docs/v5/account/wallet-balance#response-parameters
 * @typedef {Object} AssetsItem
 * @prop {string} availableToWithdraw "1.00129163" Available amount to withdraw of current coin.
 * @prop {string} coin "USDT" Coin name, such as BTC, ETH, USDT, USDC.
 * @prop {string} cumRealisedPnl Cumulative realised P&L.
 * @prop {string} equity "100" Equity of current coin (unified accounts).
 * @prop {string} free "80" Available balance for Spot wallet. This is a unique field for Classic SPOT.
 * @prop {string} locked "0" Locked balance due to the Spot open order.
 * @prop {string} totalPositionIM Sum of initial margin of all positions + Pre-occupied liquidation fee. For portfolio margin mode, it returns "".
 * @prop {string} unrealisedPnl Unrealised P&L.
 * @prop {string} usdValue USD value of current coin.
 * @prop {string} walletBalance "100" Wallet balance of current coin.
 * @typedef {Object} AccountItem
 * @prop {"CONTRACT" | "SPOT" | "UNIFIED"} accountType "SPOT" Account type.
 * @prop {Array<AssetsItem>} coin [AssetsItem, ...]
 * @typedef {Object} AssetsResult
 * @prop {Array<AccountItem>} list [AccountItem, ...]
 * @typedef {Object} Assets
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * prop {number} time 1719619515694 Response unix timestamp.
 * @prop {AssetsResult} result Object
 */

module.exports = {};
