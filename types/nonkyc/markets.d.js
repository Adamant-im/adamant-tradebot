/**
 * Raw vendor payload from GET /market/getlist
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Markets/get_market_getlist
 * @typedef {object} NonkycMarket
 * @prop {string} id Internal market identifier (alias of `_id`)
 * @prop {string} _id Internal MongoDB identifier
 * @prop {string} symbol Trading pair symbol, for example ADM/USDT
 * @prop {string} primaryTicker Base currency ticker, for example ADM
 * @prop {string} primaryName Base currency full name, for example ADAMANT Messenger
 * @prop {string} primaryAsset Base asset object ID
 * @prop {string} secondaryAsset Quote asset object ID
 * @prop {number} quantityDecimals Base currency decimal precision
 * @prop {number} priceDecimals Quote currency / price decimal precision
 * @prop {number | string} minimumQuantity Minimum order quantity in base currency
 * @prop {number | string | null} minAllowedPrice Minimum allowed order price, or null if unrestricted
 * @prop {number | string | null} maxAllowedPrice Maximum allowed order price, or null if unrestricted
 * @prop {number} minQuote Minimum order volume in quote currency; effective only when `isMinQuoteActive` is true
 * @prop {boolean} minQuoteActive Whether `minQuote` restriction is active
 * @prop {boolean} isMinQuoteActive Alias of `minQuoteActive`
 * @prop {boolean} isActive Whether the market is active
 * @prop {boolean} isPaused Whether all trading is temporarily paused
 * @prop {boolean} pauseBuys Whether buy orders are paused
 * @prop {boolean} pauseSells Whether sell orders are paused
 * @prop {string} lastPrice Last trade price as string
 * @prop {number} lastPriceNumber Last trade price as number
 * @prop {string} yesterdayPrice Price 24 h ago as string
 * @prop {number} yesterdayPriceNumber Price 24 h ago as number
 * @prop {string} highPrice 24 h high price as string
 * @prop {number} highPriceNumber 24 h high price as number
 * @prop {string} lowPrice 24 h low price as string
 * @prop {number} lowPriceNumber 24 h low price as number
 * @prop {string} bestBid Current highest bid as string
 * @prop {number} bestBidNumber Current highest bid as number
 * @prop {string} bestAsk Current lowest ask as string
 * @prop {number} bestAskNumber Current lowest ask as number
 * @prop {string} volume 24 h volume in base currency as string
 * @prop {number} volumeNumber 24 h volume in base currency as number
 * @prop {string} volumeSecondary 24 h volume in quote currency as string
 * @prop {number} volumeSecondaryNumber 24 h volume in quote currency as number
 * @prop {number} volumeUsdNumber 24 h volume in USD
 * @prop {number} marketcapNumber Market capitalization in USD
 * @prop {string} changePercent 24 h price change percent as string
 * @prop {number} changePercentNumber 24 h price change percent as number
 * @prop {string} spreadPercent Current spread as percent string
 * @prop {number} spreadPercentNumber Current spread as percent number
 * @prop {string} lastPriceUpDown Direction of last price move: 'up' or 'down'
 * @prop {string} lineChart JSON-encoded array of hourly prices for the last 24 h
 * @prop {number} lastTradeAt Unix timestamp (ms) of the last trade
 * @prop {number} createdAt Unix timestamp (ms) of market creation
 * @prop {number} updatedAt Unix timestamp (ms) of last update
 * @prop {string} primaryUsdValue Primary asset price in USD as string
 * @prop {string} primaryCirculation Primary asset circulating supply as string
 * @prop {string} secondaryUsdValue Quote asset price in USD as string
 * @prop {string} secondaryCirculation Quote asset circulating supply as string
 * @prop {boolean} primaryIsPrivate Whether the primary asset is private / unlisted
 * @prop {boolean} secondaryIsPrivate Whether the secondary asset is private / unlisted
 * @prop {boolean} [apiExcluded] Whether this market is excluded from public API listings
 * @prop {string} [imageUUID] Market image UUID
 * @prop {number} [engineId] Internal matching engine identifier
 * @prop {string} [assignedWebsites] Website assignment ID
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw array directly. Processing happens in `trader_nonkyc.js`.
 *
 * @typedef {NonkycMarket[]} NonkycMarkets
 *
 * @example
 * [
 *   {
 *     "_id": "656730e422c2f8146507a377",
 *     "symbol": "ADM/USDT",
 *     "primaryName": "ADAMANT Messenger",
 *     "primaryTicker": "ADM",
 *     "lastPrice": "0.01085391",
 *     "yesterdayPrice": "0.01105558",
 *     "highPrice": "0.01110534",
 *     "lowPrice": "0.01078384",
 *     "volume": "614971.0590",
 *     "lastTradeAt": 1776346142475,
 *     "priceDecimals": 8,
 *     "quantityDecimals": 4,
 *     "isActive": true,
 *     "primaryAsset": "655e2baf2fe4008f8d03f452",
 *     "secondaryAsset": "64367cb8fff6d79a1a316869",
 *     "isPaused": false,
 *     "bestAsk": "0.01122399",
 *     "bestBid": "0.01078384",
 *     "createdAt": 1701261540265,
 *     "updatedAt": 1776346161216,
 *     "lastPriceNumber": 0.01085391,
 *     "bestBidNumber": 0.01078384,
 *     "bestAskNumber": 0.01122399,
 *     "yesterdayPriceNumber": 0.01105558,
 *     "changePercentNumber": -1.82,
 *     "highPriceNumber": 0.01110534,
 *     "lowPriceNumber": 0.01078384,
 *     "volumeNumber": 614971.059,
 *     "volumeSecondary": "6691.0231",
 *     "volumeSecondaryNumber": 6691.0231,
 *     "volumeUsdNumber": 6691.02,
 *     "marketcapNumber": 1240678,
 *     "changePercent": "-1.82",
 *     "spreadPercent": "3.921",
 *     "spreadPercentNumber": 3.921,
 *     "lastPriceUpDown": "up",
 *     "lineChart": "[0.01146508,0.01146476,0.01152270]",
 *     "primaryUsdValue": "0.010850413684",
 *     "primaryCirculation": "114343814",
 *     "secondaryUsdValue": "1.00000",
 *     "secondaryCirculation": "185742292039.7219",
 *     "minimumQuantity": 0,
 *     "maxAllowedPrice": 999999999,
 *     "minAllowedPrice": 0,
 *     "pauseBuys": false,
 *     "pauseSells": false,
 *     "minQuote": 1,
 *     "minQuoteActive": true,
 *     "isMinQuoteActive": true,
 *     "apiExcluded": true,
 *     "id": "656730e422c2f8146507a377",
 *     "primaryIsPrivate": false,
 *     "secondaryIsPrivate": false
 *   }
 * ]
 */

module.exports = {};
