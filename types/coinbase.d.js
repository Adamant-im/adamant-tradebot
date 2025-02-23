'use strict';

/**
 * POST https://api.coinbase.com/v2/accounts/{{accountUuid}}/addresses
 * @see https://docs.cdp.coinbase.com/coinbase-app/docs/api-addresses#create-address
 * @typedef {Object} AddressData
 * @prop {string} address "0123456789ABCDEFGHIJKLmnopqrstuvwx" Deposit address.
 * @prop {string} network "bitcoin" Network name.
 * @prop {string} address_label "BTC address" Currency name.
 * @prop {string} name null User defined label for the address.
 * @typedef {Object} Address
 * @prop {AddressData} data {}
 */

/**
 * GET https://api.coinbase.com/v2/accounts/{{accountUuid}}/addresses
 * @see https://docs.cdp.coinbase.com/coinbase-app/docs/api-addresses#list-addresses
 * @typedef {Object} AddressAll
 * @prop {Array<AddressData>} data {}
 */

/**
 * GET https://api.coinbase.com/api/v2/currencies/crypto
 * @see https://docs.cdp.coinbase.com/coinbase-app/docs/api-currencies/#response
 * @typedef {Object} CurrenciesItem
 * prop {string} address_regex "^([13][a-km-zA-HJ-NP-Z1-9]{25,34})|^(bc1[qzry9x8gf2tvdw0s3jn54khce6mua7l]([qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}|[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}))$"
 * @prop {string} asset_id "01234567-89ab-cdef-0123-456789abcdef" Currency UUID.
 * @prop {string} code "BTC" Currency code.
 * prop {string} color "#FFFFFF"
 * @prop {number} exponent 8
 * @prop {string} name "Bitcoin" Currency name.
 * prop {number} sort_index 101
 * prop {"crypto"} type "crypto"
 * @typedef {Object} Currencies
 * @prop {Array<CurrenciesItem>} data [CurrenciesItem, ...]
 * @prop {string} [error] Request error code.
 * prop {string} [error_details] Request error details.
 * @prop {string} [message] Request status message.
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/accounts
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getaccounts/#response-dropdown-button
 * @typedef {Object} AccountData
 * @prop {string} uuid "01234567-89ab-cdef-0123-456789abcdef"
 * @prop {string} currency "BTC"
 * @typedef {Object} Accounts
 * @prop {Array<AccountData>} accounts {}
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id={{product_id}}
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getpublicproductbook/#response-dropdown-button
 * @typedef {Object} DepthDataItem
 * @prop {string} price 61650.0 Order price.
 * @prop {string} size 61.944924 Base currency volume.
 * @typedef {Object} DepthData
 * @prop {Array<DepthDataItem>} asks Ask depth.
 * @prop {Array<DepthDataItem>} bids Ask depth.
 * prop {string} product_id "BTC-USDT" Trading pair.
 * prop {string} time "1970-01-01T00:00:00.000Z" Transaction time, ISO UTC timestamp.
 * @typedef {Object} Depth
 * @prop {DepthData} pricebook { asks: [], bids: [] }
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/market/products/{{product_id}}/ticker
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getpublicmarkettrades/#response-dropdown-button
 * @typedef {Object} TradesItem
 * @prop {string} product_id "BTC-USDT" Trading pair.
 * @prop {string} trade_id "0123456" Trade ID.
 * @prop {"BUY" | "SELL"} side "BUY" Fill direction.
 * @prop {string} price "61608.19" Fill price in quote currency.
 * @prop {string} size "0.00589" Filled quantity in base currency.
 * @prop {string} time "1970-01-01T00:00:00.000Z" Transaction time, ISO UTC timestamp.
 * @typedef {Object} Trades
 * @prop {Array<TradesItem>} trades [TradesItem, ...]
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/market/products?product_type=SPOT
 * GET https://api.coinbase.com/api/v3/brokerage/products?product_type=SPOT
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getpublicproducts/#response-dropdown-button
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getproducts/#response-dropdown-button
 * @typedef {Object} MarketsItem
 * @prop {string} product_id "BTC-USD" Trading pair.
 * @prop {string} base_currency_id Symbol of the base currency.
 * @prop {string} base_display_symbol "BTC" Base currency, e.g. "BTC" in the pair "BTCUSDT".
 * @prop {"USD"} quote_display_symbol "USD" Quoting currency, e.g. "USDT" in the trading pair "BTCUSDT".
 * @prop {string} quote_min_size "1" Minimum size that can be represented of quote currency.
 * @prop {string} quote_max_size "150000000" Maximum size that can be represented of quote currency.
 * @prop {"0.00000001"} base_min_size "0.00000001" Minimum order.
 * @prop {string} base_max_size "3400" Maximum order.
 * prop {string} price_increment "0.00000001" Pricing precision incremental step.
 * @prop {string} base_increment "0.00000001" Base currency precision incremental step.
 * @prop {string} quote_currency_id Symbol of the quote currency.
 * @prop {string} quote_increment "0.01" Quote currency precision incremental step.
 * @prop {"online"} status "online" Release status. Offline: maintenance. Gray: grey scale. Online: released.
 * @prop {"1"} quote_min_size "1" Minimum trading volume (USDT).
 * @typedef {Object} Markets
 * prop {string} num_products 652 Amount of available currency pairs for trading.
 * @prop {Array<MarketsItem>} products [MarketsItem, ...]
 * @prop {string} [error] Request error code.
 * prop {string} [error_details] Request error details.
 * @prop {string} [message] Request status message.
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/orders/historical/fills?product_id=BTC-USDT
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getfills/#response-dropdown-button
 * @typedef {Object} FillsItem
 * @prop {string} product_id "BTC-USDT" Trading pair.
 * @prop {string} order_id "01234567-89ab-cdef-0123-456789abcdef" Filled order UUID.
 * @prop {"BUY" | "SELL"} side "BUY" Fill direction.
 * @prop {string} price "61608.19" Fill price in quote currency.
 * @prop {string} size "0.00589" Filled quantity in base currency.
 * @prop {string} trade_time "1970-01-01T00:00:00.000Z" Transaction time, ISO UTC timestamp.
 * @typedef {Object} Fills
 * @prop {Array<FillsItem>} fills [FillsItem, ...]
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/portfolios
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getportfolios/#response-dropdown-button
 * @typedef {Object} PortfoliosItem
 * prop {string} name "Default"
 * @prop {string} uuid "01234567-89ab-cdef-0123-456789abcdef"
 * @prop {string} type "DEFAULT"
 * prop {string} deleted false
 * @typedef {Object} Portfolios
 * @prop {Array<PortfoliosItem>} portfolios [AssetsItem, ...]
 * @prop {string} [error] Request error code.
 * prop {string} [error_details] Request error details.
 * @prop {string} [message] Request status message.
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/portfolios/{{portfolioUuid}}
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getportfoliobreakdown/#response-dropdown-button
 * @typedef {Object} AssetsItem
 * @prop {string} asset "USDT" Account asset name.
 * @prop {string} total_balance_crypto "100.00000000" Available assets amount.
 * @prop {string} available_to_trade_crypto "0.00000000" Available to trade assets amount. Usually frozen when the order placed.
 * @prop {string} available_to_transfer_crypto "0.00000000" Available to transfer (withdraw) assets amount.
 * @typedef {Object} Assets
 * @prop {{ spot_positions: Array<AssetsItem> }} breakdown [AssetsItem, ...]
 * @prop {string} [error] Request error code.
 * prop {string} [error_details] Request error details.
 * @prop {string} [message] Request status message.
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/orders/historical/{{orderUuid}}
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_gethistoricalorder/#response-dropdown-button
 * @typedef {Object} OrderInfoLimitItem
 * @prop {{ base_size: string, limit_price: string }} limit_limit_gtc { "base_size": "0.1", "limit_price": "100" } Order price and amount (base currency).
 * @typedef {Object} OrderInfoMarketItem
 * @prop {{ base_size: string, quote_size: string }} market_market_ioc { "base_size": "0.1", "quote_size": "10" } Order price and amount (base currency for sell order; quote currency for buy order).
 * @typedef {Object} OrderInfoItem
 * @prop {string} product_id "BTC-USDT" Trading pair name.
 * @prop {string} order_id "01234567-89ab-cdef-0123-456789abcdef" Order UUID.
 * @prop {string} average_filled_price "0" Filled price.
 * @prop {OrderInfoLimitItem & OrderInfoMarketItem} order_configuration  Order configuration for each order type.
 * @prop {"LIMIT" | "MARKET"} order_type "UNKNOWN_ORDER_TYPE" Order type.
 * @prop {"BUY" | "SELL"} side "buy" Trade direction.
 * @prop {"CANCEL_QUEUED" | "CANCELLED" | "EXPIRED" | "FAILED" | "FILLED" | "OPEN"
 *   | "PENDING" | "QUEUED" | "UNKNOWN_ORDER_STATUS"} status "OPEN" Order status.
 * @prop {string} created_time "1970-01-01T00:00:00.000Z" Creation date, ISO UTC timestamp.
 * @prop {string} filled_size "0" Filled volume in base currency.
 * @prop {string} filled_value "0"
 * prop {string} product_type "SPOT"
 * @prop {string} last_fill_time "1970-01-01T00:00:00.000Z" Time of the most recent fill for this order, ISO UTC timestamp.
 * @prop {string} number_of_fills "2" Number of fills that have been posted for this order.
 * @prop {string} total_fees "0.1185770750988142" The total fees for the order.
 * @typedef {Object} OrderInfo
 * @prop {OrderInfoItem} order [OrderInfoItem, ...]
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/orders/historical/batch?order_status=OPEN
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_gethistoricalorders/#response-dropdown-button
 * @typedef {Object} OrderLimitItem
 * @prop {{ base_size: string, limit_price: string }} limit_limit_gtc { "base_size": "0.1", "limit_price": "100" } Order price and amount (base currency).
 * @typedef {Object} OrderMarketItem
 * @prop {{ base_size: string, quote_size: string }} market_market_ioc { "base_size": "0.1", "quote_size": "10" } Order price and amount (base currency for sell order; quote currency for buy order).
 * @typedef {Object} OrdersItem
 * @prop {string} order_id "01234567-89ab-cdef-0123-456789abcdef" Order UUID.
 * @prop {string} average_filled_price "10000" Order price.
 * @prop {OrderLimitItem & OrderMarketItem} order_configuration  Order configuration for each order type.
 * prop {"LIMIT" | "MARKET" | "UNKNOWN_ORDER_TYPE"} order_type "UNKNOWN_ORDER_TYPE" Order type.
 * @prop {"BUY" | "SELL"} side "buy" Trade direction.
 * @prop {"CANCELLED" | "EXPIRED" | "FILLED" | "OPEN"} status "OPEN" Order status.
 * @prop {string} created_time "1970-01-01T00:00:00.000Z" Creation date, ISO UTC timestamp.
 * @prop {string} filled_size "0" Filled volume in base currency.
 * prop {string} filled_value "0"
 * prop {string} product_type "SPOT"
 * @typedef {Object} Orders
 * @prop {Array<OrdersItem>} orders [OrdersItem, ...]
 */

/**
 * POST https://api.coinbase.com/api/v3/brokerage/orders
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_postorder/#response-dropdown-button
 * @typedef {Object} OrderPlace
 * @prop {string} failure_reason "UNKNOWN_FAILURE_REASON" Request failure reason
 * @prop {string} order_id "01234567-89ab-cdef-0123-456789abcdef" Order UUID.
 * @prop {{ order_id: string }} success_response The ID of the order.
 * @prop {boolean} success true Request status code.
 */

/**
 * POST https://api.coinbase.com/api/v3/brokerage/orders/batch_cancel
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_cancelorders/#response-dropdown-button
 * @typedef {Object} OrderCancelData
 * @prop {string} failure_reason "UNKNOWN_CANCEL_FAILURE_REASON" Request failure reason
 * @prop {string} order_id "01234567-89ab-cdef-0123-456789abcdef" Order UUID.
 * @prop {boolean} success true Request status code.
 * @typedef {Object} OrderCancel
 * @prop {Array<OrderCancelData>} results [ failure_reason, order_id, success ]
 */

/**
 * POST https://api.coinbase.com/api/v3/brokerage/orders/batch_cancel
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_cancelorders/#response-dropdown-button
 * @typedef {Object} OrdersCancel
 * @prop {Array<OrderCancelData>} results [ failure_reason, order_id, success ]
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USDT/ticker?limit=1
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getpublicmarkettrades/#response-dropdown-button
 * @typedef {Object} TickersItem
 * prop {string} ask "" Always empty string.
 * prop {string} bid "" Always empty string.
 * prop {string} product_id "BTC-USDT" Trading pair.
 * @prop {string} price "2593.24" The price of the trade, in quote currency.
 * prop {"BUY" | "SELL"} side "BUY" The side of the trade..
 * @prop {string} size "0.31181" The size of the trade, in base currency.
 * prop {string} time "2024-08-19T12:02:11.123767Z" Timestamp of the trade.
 * prop {string} trade_id "12345678" The ID of the trade that was placed.
 * @typedef {Object} Tickers
 * @prop {string} best_ask "2591.08" Ask 1 price.
 * @prop {string} best_bid "2590.73" Bid 1 price.
 * @prop {Array<TickersItem>} trades [TickersItem, ...]
 */

/**
 * GET https://api.coinbase.com/api/v3/brokerage/market/products/${product_id}
 * @see https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getpublicproduct/#response-dropdown-button
 * @typedef {Object} TickersVolume
 * @prop {string} approximate_quote_24h_volume "17218422.59" The approximate trading volume for the product in the last 24 hours based on the current quote.
 * @prop {string} price "2762.88" The current price for the product, in quote currency.
 * @prop {string} volume_24h "6232.05589325" The trading volume for the product in the last 24 hours..
 */

/**
 * Internal object with comprehensive information about response error for debugging.
 * @typedef {Object} ResponseError
 * @prop {string} [error] Original request status code from exchange.
 * @prop {{
 *   description: string,
 *   error: string,
 *   error_details: string,
 *   message: string
 * }} [error_response] Original request status code from exchange.
 * @prop {string} [message] Original request status message from exchange.
 * @prop {string} [coinbaseadvErrorInfo] Description from `trade/api/coinbaseadv_errors.js` composed in format `[code] message (description)`.
 */

module.exports = {};
