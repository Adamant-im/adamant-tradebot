'use strict';

/**
 * Currencies object definition.
 * @typedef {string} currencySymbol
 * @typedef {string} networkChain
 * @typedef {Object} CurrenciesNetworkItem
 * @prop {string} withdrawalFee Withdrawal fee.
 * @prop {string} minWithdrawal Minimal withdrawal fee.
 * @prop {string} confirmations Number of network confirmations to withdraw.
 * @prop {string} status Network status.
 * @prop {string} depositStatus Deposit status on network.
 * @prop {string} withdrawalStatus Withdrawal status on network.
 * @prop {string} chainName Network chain name.
 * @typedef {Object} ResultItem
 * @prop {currencySymbol} symbol Currency symbol, e.g. "BTC".
 * @prop {string} name Readable currency symbol, e.g. "Bitcoin".
 * @prop {"OFFLINE" | "ONLINE"} status Status.
 * @prop {string | null} comment null,
 * @prop {string | null} confirmations null,
 * @prop {string | null} withdrawalFee null,
 * @prop {string | null} logoUrl null,
 * @prop {string | null} exchangeAddress null,
 * @prop {number | null} decimals Decimals amount in fractional part of precision.
 * @prop {number | null} precision The precision of withdraw or deposit.
 * @prop {{[key: networkChain]: CurrenciesNetworkItem}} networks Networks on which currencies available.
 * @prop {string | null} defaultNetwork undefined
 * @typedef {{[key: currencySymbol]: ResultItem}} CurrenciesResult
 */

module.exports = {};
