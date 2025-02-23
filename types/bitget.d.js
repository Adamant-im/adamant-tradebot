'use strict';

/**
 * GET https://api.bitget.com/api/v2/spot/account/assets
 * @see https://www.bitget.com/api-doc/spot/account/Get-Account-Assets#response-parameters
 * @typedef {Object} AssetsItem
 * @prop {string} coin "USDT" Account asset name.
 * @prop {string} available "100.00000000" Available assets amount.
 * prop {string} limitAvailable "0" Restricted availability. For spot copy trading.
 * @prop {string} frozen "0.00000000" Frozen assets amount. Usually frozen when the order placed.
 * prop {string} locked "0.00000000" Locked assets amount. Locked assets are required to become a fiat merchants, for example.
 * prop {null | string} uTime "1715159982216" Update time, unix timestamp. Bitget API returns `null` due to a bug if `coin` provided in request.
 * @typedef {Object} Assets
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<AssetsItem>} data [AssetsItem, ...]
 */

/**
 * GET https://api.bitget.com/api/v2/spot/market/fills-history?symbol=BTCUSDT
 * @see https://www.bitget.com/api-doc/spot/market/Get-Market-Trades#response-parameters
 * @typedef {Object} FillsItem
 * prop {string} symbol "BTCUSDT" Trading pair.
 * @prop {string} tradeId "0123456789012345678" Filled order id.
 * @prop {"Buy" | "Sell"} side Fill direction.
 * @prop {string} price "61608.19" Fill price in quote currency.
 * @prop {string} size "0.00589" Filled quantity in base currency.
 * @prop {string} ts "1715680628784" Transaction time, unix timestamp.
 * @typedef {Object} Fills
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<FillsItem>} data [FillsItem, ...]
 */

/**
 * GET https://api.bitget.com/api/v2/spot/market/orderbook?symbol=BTCUSDT
 * @see https://www.bitget.com/api-doc/spot/market/Get-Orderbook#response-parameters
 * @typedef {number} baseVolume 61.944924 Base currency volume.
 * @typedef {number} orderPrice 61650.0 Order price.
 * @typedef {Object} DepthData
 * @prop {Array<[orderPrice,baseVolume]>} asks Ask depth.
 * @prop {Array<[orderPrice,baseVolume]>} bids Ask depth.
 * prop {string} ts "1715680628784" Current unix timestamp.
 * @typedef {Object} Depth
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {DepthData} data { asks: [], bids: [], ts: string }
 */

/**
 * GET https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT
 * @see https://www.bitget.com/api-doc/spot/market/Get-Tickers#response-parameters
 * @typedef {Object} TickersItem
 * prop {string} open "63062.41" 24h open price.
 * prop {string} symbol "BTCUSDT" Trading pair.
 * @prop {string} high24h "63452.38" 24h highest price.
 * @prop {string} low24h "61406.94" 24h lowest price.
 * @prop {string} lastPr "61782.97" Latest price.
 * @prop {string} quoteVolume "408053097.049289" Trading volume in quote currency.
 * @prop {string} baseVolume "6504.094744" Trading volume in base currency.
 * prop {string} usdtVolume "408053097.04928844" Trading volume in USDT.
 * prop {string} ts "1715680628784" Current unix timestamp.
 * @prop {string} bidPr "61782.97" Bid 1 price.
 * @prop {string} askPr "61782.98" Ask 1 price.
 * prop {string} bidSz "0.315208" Buying 1 amount.
 * prop {string} askSz "0.336085" Selling 1 amount.
 * prop {string} openUtc "62940.77" UTC Entry price.
 * prop {string} changeUtc24h "-0.01839" Change at UTC+0, 0.01 means 1%.
 * prop {string} change24h "-0.01945" 24-hour change, 0.01 means 1%.
 * @typedef {Object} Tickers
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<TickersItem>} data [TickersItem, ...]
 */

/**
 * GET https://api.bitget.com/api/v2/spot/public/coins
 * @see https://www.bitget.com/api-doc/spot/market/Get-Coin-List#response-parameters
 * @typedef {Object} ChainsItem
 * @prop {string} chain "BTC" Chain name.
 * prop {"false" | "true"} needTag "false" Need tag.
 * @prop {"false" | "true"} withdrawable "true" Withdrawal supported.
 * @prop {"false" | "true"} rechargeable "true" Deposit supported.
 * @prop {string} withdrawFee "0.00025" Withdrawal transaction fee.
 * prop {string} extraWithDrawFee "0" Extra charge. On chain destruction: 0.1 means 10%.
 * prop {string} depositConfirm "1" Deposit confirmation blocks.
 * @prop {string} withdrawConfirm "1" Withdrawal confirmation blocks.
 * prop {string} minDepositAmount "0.00001" Minimum deposit amount.
 * @prop {string} minWithdrawAmount "0.001" Minimum withdrawal amount.
 * prop {string} browserUrl "https://explorer.btc.com/btc/transaction/" Blockchain explorer address.
 * prop {null | string} contractAddress null Currency contract address.
 * prop {string} withdrawStep "0" Withdrawal count step. If the value is not 0, it indicates that the withdrawal size should be multiple of the value. If it's 0, that means there is no the limit above.
 * @typedef {Object} CurrenciesItem
 * @prop {string} coinId "1" Currency ID.
 * @prop {string} coin "BTC" Token name.
 * @prop {"false" | "true"} transfer "true" Transferability.
 * @prop {Array<ChainsItem>} chains [ChainsItem, ...] Support chain list.
 * @typedef {Object} Currencies
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<CurrenciesItem>} data [CurrenciesItem, ...]
 */

/**
 * GET https://api.bitget.com/api/v2/spot/public/symbols
 * @see https://www.bitget.com/api-doc/spot/market/Get-Symbols#response-parameters
 * @typedef {Object} MarketsItem
 * @prop {string} symbol "BTCUSDT" Trading pair.
 * @prop {string} baseCoin "BTC" Base currency, e.g. "BTC" in the pair "BTCUSDT".
 * @prop {"BRL" | "BTC" | "ETH" | "EUR" | "SBTC" | "SUSDT" | "USDC" | "USDT"} quoteCoin "USDT" Quoting currency, e.g. "USDT" in the trading pair "BTCUSDT".
 * @prop {"0"} minTradeAmount "0" Minimum order.
 * @prop {string} maxTradeAmount "10000000000" Maximum order.
 * prop {string} takerFeeRate "0.002" Default taker transaction fee, can be overridden by individual transaction fee.
 * prop {string} makerFeeRate "0.002" Default maker transaction fee, can be overridden by individual transaction fee.
 * @prop {string} pricePrecision "2" Pricing precision.
 * @prop {string} quantityPrecision "6" Base currency precision.
 * @prop {string} quotePrecision "6" Quote currency precision.
 * @prop {"gray" | "halt" | "online"} status "online" Release status. Offline: maintenance. Gray: grey scale. Online: released.
 * @prop {"0.1" | "5"} minTradeUSDT "5" Minimum trading volume (USDT).
 * prop {string} buyLimitPriceRatio "0.05" Percentage spread between bid and ask, in decimal form. E.g. 0.05 means 5%.
 * prop {string} sellLimitPriceRatio "0.05" Percentage spread between sell and current price, in decimal form. E.g. 0.05 means 5%.
 * prop {string} areaSymbol "no" ?
 * @typedef {Object} Markets
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<MarketsItem>} data [MarketsItem, ...]
 */

/**
 * POST https://api.bitget.com/api/v2/spot/trade/batch-cancel-order
 * @see https://www.bitget.com/api-doc/spot/trade/Batch-Cancel-Orders#response-parameter
 * @typedef {Object} OrdersBatchCancelSuccess
 * @prop {string} orderId "0123456789012345678" Order ID.
 * prop {string} clientOid "01234567-89ab-cdef-0123-456789abcdef" Client order UUID.
 * @typedef {Object} OrdersBatchCancelFailure
 * @prop {string} orderId "0123456789012345678" Order ID.
 * prop {null | string} clientOid "01234567-89ab-cdef-0123-456789abcdef" Client order UUID.
 * prop {string} errorMsg "The order does not exist" Error information.
 * prop {string} errorCode "43001" Error code.
 * @typedef {Object} OrdersBatchCancelData
 * @prop {Array<OrdersBatchCancelSuccess>} successList Successful orders list.
 * @prop {Array<OrdersBatchCancelFailure>} failureList Failed orders list.
 * @typedef {Object} OrdersBatchCancel
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {OrdersBatchCancelData} data { successList: [], failureList: [] }
 */

/**
 * POST https://api.bitget.com/api/v2/spot/trade/cancel-order
 * @see https://www.bitget.com/api-doc/spot/trade/Cancel-Order#response-parameters
 * @typedef {Object} OrderCancelData
 * @prop {string} orderId "0123456789012345678" Order ID.
 * prop {string} clientOid "01234567-89ab-cdef-0123-456789abcdef" Client order UUID.
 * @typedef {Object} OrderCancel
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {OrderCancelData | null} data { orderId, clientOid }
 */

/**
 * POST https://api.bitget.com/api/v2/spot/trade/cancel-symbol-order
 * @see https://www.bitget.com/api-doc/spot/trade/Cancel-Symbol-Orders#response-parameter
 * @typedef {Object} OrdersCancelData
 * prop {string} symbol "BTCUSDT" Trading pair name.
 * @typedef {Object} OrdersCancel
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {OrdersCancelData} data { symbol }
 */

/**
 * GET https://api.bitget.com/api/v2/spot/trade/orderInfo
 * @see https://www.bitget.com/api-doc/spot/trade/Get-Order-Info#response-parameter
 * @typedef {Object} OrderInfoItem
 * prop {string} userId "0123456789" User account id.
 * @prop {string} symbol "BTCUSDT" Trading pair name.
 * @prop {string} orderId "0123456789012345678" Order ID.
 * prop {string} clientOid "01234567-89ab-cdef-0123-456789abcdef" Client order UUID.
 * @prop {string} price "10000" Order price.
 * @prop {string} size "0.001" Amount (base currency for limit and market-sell order; quote currency for market-buy order).
 * @prop {"limit" | "market"} orderType "limit" Order type.
 * @prop {"buy" | "sell"} side "buy" Trade direction.
 * @prop {"cancelled" | "filled" | "init" | "live" | "new" | "partially_filled"} status "live" Order status.
 * @prop {string} priceAvg "0" Filled price.
 * @prop {string} baseVolume "0" Filled volume in base currency.
 * @prop {string} quoteVolume "0" Filled volume in quote currency.
 * prop {"ANDROID" | "APP" | "API" | "IOS" | "SYS" | "WEB"} enterPointSource "API" Client type.
 * prop {string} feeDetail "" Transaction fee breakdown.
 * prop {"market" | "normal" | "spot_follower_buy" | "spot_follower_sell" | "spot_trader_buy" | "spot_trader_sell"} orderSource "normal" Order source.
 * prop {"normal" | "tpsl"} tpslType "normal" Normal spot or TPSL order.???
 * prop {null | string} triggerPrice null Spot TPSL trigger price.
 * @prop {"BRL" | "BTC" | "ETH" | "EUR" | "SBTC" | "SUSDT" | "USDC" | "USDT"} quoteCoin "USDT" Quoting currency, e.g. "USDT" in the trading pair "BTCUSDT".
 * @prop {string} baseCoin "BTC" Base currency, e.g. "BTC" in the pair "BTCUSDT".
 * @prop {string} cTime "1716037044487" Creation date, unix timestamp.
 * @prop {string} uTime "1716037044554" Update date, unix timestamp.
 * @typedef {Object} OrderInfo
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<OrderInfoItem> | null} data [OrderInfoItem, ...]
 */

/**
 * POST https://api.bitget.com/api/v2/spot/trade/place-order
 * @see https://www.bitget.com/api-doc/spot/trade/Place-Order#response-parameter
 * @typedef {Object} OrderPlaceData
 * @prop {string} orderId "0123456789012345678" Order ID.
 * prop {string} clientOid "01234567-89ab-cdef-0123-456789abcdef" Client order UUID.
 * @typedef {Object} OrderPlace
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {OrderPlaceData} data { orderId, clientOid }
 */

/**
 * GET https://api.bitget.com/api/v2/spot/trade/unfilled-orders
 * @see https://www.bitget.com/api-doc/spot/trade/Get-Unfilled-Orders#response-parameter
 * @typedef {Object} OrdersItem
 * prop {string} userId "0123456789" User account id.
 * prop {string} symbol "BTCUSDT" Trading pair name.
 * @prop {string} orderId "0123456789012345678" Order ID.
 * prop {string} clientOid "01234567-89ab-cdef-0123-456789abcdef" Client order UUID.
 * @prop {string} priceAvg "10000" Order price.
 * @prop {string} size "0.001" Amount (base currency for limit and market-sell order; quote currency for market-buy order).
 * @prop {"limit" | "market"} orderType "limit" Order type.
 * @prop {"buy" | "sell"} side "buy" Trade direction.
 * @prop {"cancelled" | "filled" | "live" | "partially_filled"} status "live" Order status.
 * prop {string} basePrice "0" Filled price.
 * @prop {string} baseVolume "0" Filled volume in base currency.
 * prop {string} quoteVolume "0" Filled volume in quote currency.
 * prop {"ANDROID" | "APP" | "API" | "IOS" | "SYS" | "WEB"} enterPointSource "API" Client type.
 * prop {"market" | "normal" | "spot_follower_buy" | "spot_follower_sell" | "spot_trader_buy" | "spot_trader_sell"} orderSource "normal" Order source.
 * prop {null | string} triggerPrice null Spot TPSL trigger price.
 * prop {"normal" | "tpsl"} tpslType "normal" Normal spot or TPSL order.
 * @prop {string} cTime "1716037044487" Creation date, unix timestamp.
 * prop {string} uTime "1716037044554" Update date, unix timestamp.
 * @typedef {Object} Orders
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {Array<OrdersItem>} data [OrdersItem, ...]
 */

/**
 * GET https://api.bitget.com/api/v2/spot/wallet/deposit-address
 * @see https://www.bitget.com/api-doc/spot/account/Get-Deposit-Address#response-parameter
 * @typedef {Object} AddressData
 * @prop {string} address "0x0123456789abcdef0123456789abcdef01234567" Deposit address.
 * @prop {string} chain "ERC20" Chain name.
 * prop {string} coin "USDT" Currency name.
 * @prop {string} tag null Tag.
 * prop {string} url "https://etherscan.io/tx/" Blockchain address.
 * @typedef {Object} Address
 * @prop {string} code "00000" Request status code.
 * @prop {string} msg "success" Request status message.
 * prop {number} requestTime 1715680629822 Request unix timestamp?
 * @prop {AddressData} data { orderId, clientOid }
 */

/**
 * Internal object with comprehensive information about response error for debugging.
 * @typedef {Object} ResponseError
 * @prop {string} code Original request status code from exchange.
 * @prop {string} msg Original request status message from exchange.
 * @prop {string} [bitgetErrorInfo] Description from `trade/api/bitget_errors.js` composed in format `[code] message (description)`.
 */

module.exports = {};
