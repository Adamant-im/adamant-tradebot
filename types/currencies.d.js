'use strict';

/**
 * Currencies object definition.
 * @typedef {string} currencySymbol
 * @typedef {string} networkChain
 * @typedef {Object} CurrenciesNetworkItem
 * @prop {string} withdrawalFee Withdrawal fee
 * @prop {string} minDeposit Minimal deposit fee
 * @prop {string} minWithdrawal Minimal withdrawal fee
 * @prop {string} confirmations Number of network confirmations to withdraw
 * @prop {"OFFLINE" | "ONLINE"} status Network status
 * @prop {string} depositStatus Deposit status on network
 * @prop {string} withdrawalStatus Withdrawal status on network
 * @prop {string} chainName Network chain name
 * @prop {string} chainNameFormatted Commonly used network name
 * @prop {string} chainNamePlain Network chain name in exchange API format
 * @typedef {Object} ResultItem
 * @prop {currencySymbol} symbol Currency symbol, e.g. "BTC"
 * @prop {string} name Readable currency symbol, e.g. "Bitcoin"
 * @prop {"OFFLINE" | "ONLINE"} status Status
 * @prop {string | null} comment Comment about currency
 * @prop {string | null} confirmations Amount of confirmations
 * @prop {boolean | null} depositEnabled Deposit enabled or not
 * @prop {string | null} id Currency symbol
 * @prop {string | null} maxWithdraw Maximum amount allowed to withdraw
 * @prop {string | null} minWithdraw Minimum amount allowed to withdraw
 * @prop {boolean | null} withdrawEnabled Withdraw enabled or not
 * @prop {string | null} withdrawalFee Withdrawal fee
 * @prop {string | null} logoUrl Logotype URL for specific currency
 * @prop {string | null} exchangeAddress Exchange address for specific currency
 * @prop {number | null} decimals Decimals amount in fractional part of precision, e.g 6
 * @prop {number | null} precision The precision of withdraw or deposit, e.g 0.000001
 * @prop {{[key: networkChain]: CurrenciesNetworkItem}} networks Networks on which currencies available
 * @prop {string | null} defaultNetwork undefined
 * @typedef {{[key: currencySymbol]: ResultItem}} CurrenciesResult
 */

module.exports = {};
