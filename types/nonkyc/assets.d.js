/**
 * Raw vendor payload from GET /asset/getlist
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Assets/asset-getlist
 * @typedef {object} NonkycAssetTokenOf
 * @prop {string} ticker Ticker of the parent token contract, for example ETH-ERC20
 *
 * @typedef {object} NonkycAsset
 * @prop {string} id Internal asset identifier
 * @prop {string | null} childOf Parent asset id when this asset is a network variant, or null for top-level assets
 * @prop {string} ticker Asset symbol, for example ADM or ADM-ERC20
 * @prop {string} name Human-readable asset name, for example "ADAMANT Messenger"
 * @prop {boolean} isActive Whether the asset is enabled on the exchange
 * @prop {boolean} isMaintenance Whether the asset is under maintenance
 * @prop {string | null} maintenanceNotes Maintenance details message, or null
 * @prop {string | null} logo URL of the asset logo image, or null
 * @prop {boolean} hasChildren Whether child network variants exist for this asset
 * @prop {string | null} network Full chain name, for example "Ethereum Main Chain (ETH)"
 * @prop {boolean} depositActive Whether deposits are currently enabled
 * @prop {boolean} withdrawalActive Whether withdrawals are currently enabled
 * @prop {string | null} withdrawalNotes Withdrawal details message, or null
 * @prop {string | number} confirmsRequired Required blockchain confirmations
 * @prop {string | number} withdrawFee Withdrawal fee amount
 * @prop {string | number} withdrawDecimals Decimal precision for withdrawals
 * @prop {NonkycAssetTokenOf | null} tokenOf Parent token contract info when this is a sub-token, or null
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw array directly. Processing happens in `trader_nonkyc.js`.
 *
 * @typedef {NonkycAsset[]} NonkycAssets
 *
 * @example
 * [
 *   {
 *     "id": "64e5a1f6849a420b2e913c02",
 *     "childOf": null,
 *     "ticker": "ADM",
 *     "name": "ADAMANT Messenger",
 *     "isActive": true,
 *     "isMaintenance": false,
 *     "maintenanceNotes": null,
 *     "logo": "https://nonkyc.io/images/assets/adm.png",
 *     "hasChildren": true,
 *     "network": "Ethereum Main Chain (ETH)",
 *     "depositActive": true,
 *     "withdrawalActive": true,
 *     "withdrawalNotes": null,
 *     "confirmsRequired": 30,
 *     "withdrawFee": "100",
 *     "withdrawDecimals": 8,
 *     "tokenOf": null
 *   },
 *   {
 *     "id": "64e5a1f6849a420b2e913c03",
 *     "childOf": "64e5a1f6849a420b2e913c02",
 *     "ticker": "ADM-ERC20",
 *     "name": "ADAMANT Messenger",
 *     "isActive": true,
 *     "isMaintenance": false,
 *     "maintenanceNotes": null,
 *     "logo": null,
 *     "hasChildren": false,
 *     "network": "Ethereum Main Chain (ETH)",
 *     "depositActive": true,
 *     "withdrawalActive": true,
 *     "withdrawalNotes": null,
 *     "confirmsRequired": 30,
 *     "withdrawFee": "100",
 *     "withdrawDecimals": 8,
 *     "tokenOf": { "ticker": "ETH-ERC20" }
 *   }
 * ]
 */

module.exports = {};
