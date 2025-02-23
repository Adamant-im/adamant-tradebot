'use strict';

/**
 * GET https://api.bybit.com/v5/asset/coin/query-info
 * @see https://bybit-exchange.github.io/docs/v5/asset/coin-info#response-parameters
 * @typedef {Object} ChainsItem
 * @prop {string} chain "ETH" Network name.
 * prop {string} chainType "ERC20" Network type.
 * @prop {string} confirmation "1" The number of confirmation for deposit (and withdraw?).
 * @prop {"0" | "1"} chainDeposit "1" The chain status of deposit (0: suspend, 1: normal).
 * @prop {"0" | "1"} chainWithdraw "1" The chain status of withdraw (0: suspend, 1: normal).
 * @prop {string} depositMin "0.000006" Minimum deposit amount.
 * @prop {string} minAccuracy "8" The precision of withdraw or deposit.
 * @prop {string} withdrawFee "0.00012" Withdraw fee. If withdraw fee is empty, It means that this coin does not support withdrawal.
 * @prop {string} withdrawMin "0.0013" Minimum withdrawal amount.
 * @typedef {Object} CurrenciesItem
 * @prop {string} coin "BTC" Currency.
 * @prop {Array<ChainsItem>} chains [ChainsItem, ...] Support chain list.
 * @typedef {Object} CurrenciesResult
 * @prop {Array<CurrenciesItem>} rows [CurrenciesItem, ...]
 * @typedef {Object} Currencies
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * prop {number} time 1719619515694 Response unix timestamp.
 * @prop {CurrenciesResult} result Object
 */

module.exports = {};
