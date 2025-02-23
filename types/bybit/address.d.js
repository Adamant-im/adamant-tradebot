'use strict';

/**
 * GET https://api.bybit.com/v5/asset/deposit/query-address?chainType=BTC&coin=BTC
 * @see https://bybit-exchange.github.io/docs/v5/asset/deposit/master-deposit-addr#response-parameters
 * see https://bybit-exchange.github.io/docs/v5/asset/deposit/sub-deposit-addr#response-parameters
 * @typedef {Object} AddressItem
 * @prop {string} addressDeposit "0x0123456789abcdef0123456789abcdef01234567" The address for deposit.
 * @prop {string} chain "ETH" Network.
 * @prop {string} chainType "ERC20" Network name.
 * @prop {string} tagDeposit "" Tag of deposit.
 * @typedef {Object} AddressData
 * prop {string} [coin] "ETH" Coin.
 * @prop {Array<AddressItem>} [chains] [{ addressDeposit, ... }]
 * @typedef {Object} Address
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {AddressData} result { [chains]: [{ addressDeposit, ... }] }
 */

module.exports = {};
