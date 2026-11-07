'use strict';

// Spot REST payloads from https://data.azbit.com/swagger/v1/swagger.json
// Optional response fields still require runtime validation before normalizing.
// The adapter also accepts finite decimal strings for numeric fields emitted by legacy serializers.

/**
 * AzbitMarket raw REST payload
 * The payload does not indicate whether market orders are available for the pair.
 * @typedef {object} AzbitMarket
 * @property {string | null} [code] Pair code in `BASE_QUOTE` form, e.g. `BTC_USDT`
 * @property {number} [digitsPrice] Decimal places a price may carry. Extra digits are dropped, never rounded up
 * @property {number} [digitsAmount] Decimal places an order or deal amount may carry
 * @property {number} [minQuoteAmount] Smallest order value in the QUOTE currency — for `BTC_USDT`, a minimum in USDT
 * @property {number} [minBaseAmount] Smallest order size in the BASE currency — for `BTC_USDT`, a minimum in BTC
 * @example
 * {
 *   "code": "ADM_USDT",
 *   "digitsPrice": 8,
 *   "digitsAmount": 8,
 *   "minBaseAmount": 1e-8,
 *   "minQuoteAmount": 0.5
 * }
 */

/**
 * AzbitOrder raw REST payload
 * @typedef {object} AzbitOrder
 * @property {Array<AzbitDeal> | null} [deals] Optional fills; may be empty even when execution is nonzero
 * @property {string | null} [id] id
 * @property {boolean} [isBid] true for buy, false for sell
 * @property {number} [price] price
 * @property {number} [initialAmount] Original base quantity
 * @property {number} [amount] Legacy order quantity (includes cancelled remainder) or available asset quantity on balance rows
 * @property {number} [amountExecuted] Explicit cumulative executed base quantity, excluding cancelled remainder
 * @property {number} [remainingAmount] Active remainder; zero after cancellation even if not fully filled
 * @property {string | null} [clientOrderId] clientOrderId
 * @property {number} [currencyTo] currencyTo
 * @property {number} [quoteAmount] Original quote notional
 * @property {number} [currencyFrom] currencyFrom
 * @property {string} [date] date
 * @property {string | null} [userId] userId
 * @property {boolean} [isCanceled] Whether the unfilled remainder was cancelled
 * @property {string | null} [status] Created, PartiallyCompleted, Completed or Canceled
 * @property {string | null} [currencyPairCode] Native BASE_QUOTE pair code
 * @example
 * {
 *   "id": "70192a8b-c34e-48ce-badf-889584670507",
 *   "currencyPairCode": "ADM_USDT",
 *   "isBid": false,
 *   "price": 0.02,
 *   "initialAmount": 60,
 *   "amount": 30,
 *   "amountExecuted": 30,
 *   "remainingAmount": 30,
 *   "quoteAmount": 1.2,
 *   "date": "2026-09-07T10:00:00Z",
 *   "status": "PartiallyCompleted",
 *   "isCanceled": false,
 *   "deals": []
 * }
 */

/**
 * AzbitDeal raw REST payload
 * @typedef {object} AzbitDeal
 * @property {string} [id] id
 * @property {string} [dealDateUtc] Execution time; UTC with or without a Z suffix
 * @property {string | null} [currencyPairCode] Native BASE_QUOTE pair code
 * @property {number} [volume] Executed base quantity
 * @property {number} [price] price
 * @property {boolean} [isBuy] Aggressor direction for public trades
 * @property {boolean | null} [isUserBuyer] isUserBuyer
 * @property {string} [orderId] orderId
 * @property {string | null} [clientOrderId] clientOrderId
 * @property {number | null} [commissionAmount] commissionAmount
 * @property {string | null} [commissionCurrencyCode] commissionCurrencyCode
 * @example
 * {
 *   "id": "b22533c8-f416-b1bd-18ae-83aaf439c68a",
 *   "currencyPairCode": "ADM_USDT",
 *   "volume": 30,
 *   "price": 0.02,
 *   "isBuy": true,
 *   "dealDateUtc": "2026-09-07T10:00:00Z"
 * }
 */

/**
 * AzbitBalances raw REST payload
 * @typedef {object} AzbitBalances
 * @property {Array<AzbitBalance> | null} [balances] Available asset amounts in the main spot wallet
 * @property {Array<AzbitBalance> | null} [balancesBlockedInOrder] Order-locked amounts; absent currencies have zero locked funds
 * @property {Array<AzbitBalance> | null} [balancesInCurrencyOfferingsVesting] balancesInCurrencyOfferingsVesting
 * @property {Array<AzbitWithdrawalLimit> | null} [withdrawalLimits] withdrawalLimits
 * @property {number | null} [totalBtc] totalBtc
 * @property {number | null} [totalUsdt] totalUsdt
 * @property {number | null} [totalInternalToken] totalInternalToken
 * @property {number | null} [totalInOrderBtc] totalInOrderBtc
 * @property {number | null} [totalInOrderUsdt] totalInOrderUsdt
 * @property {number | null} [totalInOrderInternalToken] totalInOrderInternalToken
 * @property {boolean} [cantRefill] cantRefill
 * @property {boolean} [cantWithdraw] cantWithdraw
 * @property {number} [digitsBtc] digitsBtc
 * @property {number} [digitsUsdt] digitsUsdt
 * @property {number} [digitsInternalToken] digitsInternalToken
 * @example
 * {
 *   "balances": [
 *     {
 *       "currencyCode": "ADM",
 *       "amount": 100
 *     }
 *   ],
 *   "balancesBlockedInOrder": []
 * }
 */

/**
 * AzbitBalance raw REST payload
 * @typedef {object} AzbitBalance
 * @property {number} [amount] Legacy order quantity (includes cancelled remainder) or available asset quantity on balance rows
 * @property {number | null} [amountBtc] amountBtc
 * @property {number | null} [amountUsdt] amountUsdt
 * @property {number | null} [amountInternalToken] amountInternalToken
 * @property {string | null} [currencyCode] currencyCode
 * @property {string | null} [currencyName] currencyName
 * @property {number} [digits] digits
 * @property {boolean} [currencyIsFiat] currencyIsFiat
 * @example
 * {
 *   "currencyCode": "ADM",
 *   "amount": 100
 * }
 */

/**
 * AzbitCandle raw REST payload
 * @typedef {object} AzbitCandle
 * @property {string} [date] date
 * @property {number} [open] open
 * @property {number} [max] max
 * @property {number} [min] min
 * @property {number} [close] close
 * @property {number} [volume] Base asset volume (verified live)
 * @property {number} [volumeBase] Quote asset volume despite the field name (verified live)
 * @example
 * {
 *   "date": "2026-09-07T10:00:00",
 *   "open": 0.02,
 *   "max": 0.021,
 *   "min": 0.02,
 *   "close": 0.021,
 *   "volume": 100,
 *   "volumeBase": 2.1
 * }
 */

/**
 * AzbitTicker raw REST payload
 * @typedef {object} AzbitTicker
 * @property {number} [timestamp] Unix time in seconds at which this snapshot was taken — not milliseconds or the last-trade time
 * @property {string | null} [currencyPairCode] Pair code in `BASE_QUOTE` form, e.g. `BTC_USDT`
 * @property {number | null} [price] Last traded price. Null on a pair that has never traded
 * @property {number | null} [price24hAgo] Last traded price 24 hours ago, used as the price-change baseline; null when unavailable
 * @property {number} [priceChangePercentage24h] Change over 24 hours as a percentage — 2.5 means up 2.5%, not 0.025
 * @property {number} [volume24h] Quote turnover (live REST contradicts the OpenAPI base-volume description)
 * @property {number} [bidPrice] Best bid: the highest current buy price; 0 when the bid side is empty
 * @property {number} [askPrice] Best ask: the lowest price a seller is currently asking. 0 when that side is empty
 * @property {number} [low24h] Lowest traded price over 24 hours. 0 when there were no trades in the window
 * @property {number} [high24h] Highest traded price over 24 hours. 0 when there were no trades in the window
 * @example
 * {
 *   "currencyPairCode": "ADM_USDT",
 *   "price": 0.02,
 *   "volume24h": 10,
 *   "bidPrice": 0.019,
 *   "askPrice": 0.021,
 *   "high24h": 0.021,
 *   "low24h": 0.019
 * }
 */

/**
 * AzbitAccount raw REST payload
 * @typedef {object} AzbitAccount
 * @property {string} [id] Account identifier — the value to pass as `futuresAccountId` on the other endpoints
 * @property {string | null} [userId] Owner of the account — the caller
 * @property {string | null} [name] Editable display label; do not use it for account routing
 * @property {AzbitAccountType} [accountType] Stable account classification, independent of its editable name
 * @property {number} [balance] Settled balance in currencyCode, excluding unrealized PnL
 * @property {number} [blockedCopyTradingBalance] Part of Balance reserved for copy-trading and unavailable as margin
 * @property {number} [usedMargin] Part of Balance currently committed as margin to open positions
 * @property {number} [leverage] Default leverage for new positions on this account
 * @property {number} [equity] Balance plus unrealized PnL — what the account is worth if every position closed at the current mark
 * @property {number} [unrealizedPnl] Profit or loss on open positions at the current mark, not yet booked to the balance
 * @property {number} [freeMargin] Balance not yet committed as margin. Computed, not stored
 * @property {number} [marginLevel] Equity as a percentage of used margin; zero when no positions are open
 * @property {boolean} [isLiquidated] True while the account is liquidated and cannot open new positions
 * @property {string | null} [liquidationTimestamp] When the account was last liquidated (UTC), or null if it was never liquidated
 * @property {string | null} [currencyCode] Currency the account is denominated in and settles in, e.g. `USDT`
 * @example
 * {
 *   "id": "57bfeb8c-2123-43cf-f07d-2f5fb77a6960",
 *   "accountType": "UnifiedTradingMain",
 *   "currencyCode": "USDT",
 *   "balance": 60,
 *   "freeMargin": 60,
 *   "usedMargin": 0,
 *   "blockedCopyTradingBalance": 0
 * }
 */

/**
 * AzbitAccountType raw REST payload
 * @typedef {"Funding" | "UnifiedTradingMain" | "UnifiedTradingSubAccount" | "System" | "Demo"} AzbitAccountType
 */

/**
 * AzbitCommissions raw REST payload
 * @typedef {object} AzbitCommissions
 * @property {Array<AzbitCommission> | null} [commissions] commissions
 * @property {boolean} [userNoTradeCommissions] Whether the user is exempt from trade commissions
 * @example
 * {
 *   "userNoTradeCommissions": false,
 *   "commissions": [
 *     {
 *       "currencyCode": "ADM",
 *       "percent": 0.2,
 *       "minimum": 0,
 *       "commissionTypeCode": "3"
 *     }
 *   ]
 * }
 */

/**
 * AzbitCommission raw REST payload
 * @typedef {object} AzbitCommission
 * @property {string} [commissionId] commissionId
 * @property {string | null} [currencyCode] currencyCode
 * @property {number} [percent] Percentage units, e.g. 0.2 means 0.2 percent
 * @property {number} [minimum] Minimum absolute commission
 * @property {string | null} [commissionCurrencyCode] commissionCurrencyCode
 * @property {string | null} [commissionTypeCode] Exchange commission code: 3 is buy/maker and 4 is sell/taker
 * @property {number} [chain] Numeric chain ID resolved through /api/currencies/chains
 * @property {string | null} [chainName] Native chain name when present
 * @property {AzbitWithdrawalType} [currencyChainType] currencyChainType
 * @property {AzbitCommissionType} [commissionType] commissionType
 */

/**
 * AzbitCommissionType raw REST payload
 * @typedef {object} AzbitCommissionType
 * @property {string | null} [code] code
 * @property {string | null} [value] value
 * @property {string | null} [valueKey] valueKey
 */

/**
 * AzbitWithdrawalType raw REST payload
 * @typedef {0 | 10 | 20 | 30 | 40 | 50 | 60 | 70} AzbitWithdrawalType
 */

/**
 * AzbitWithdrawalLimit raw REST payload
 * @typedef {object} AzbitWithdrawalLimit
 * @property {number} [id] id
 * @property {string | null} [currencyCode] currencyCode
 * @property {number} [minAmount] minAmount
 */

/**
 * AzbitQueryResult raw REST payload
 * @typedef {object} AzbitQueryResult
 * @property {boolean} [succeeded] Business success; HTTP 200 alone does not imply success
 * @property {Array<string> | null} [errors] errors
 * @property {string | null} [logicError] Stable business rejection reason, such as OrderNotFound
 * @property {string | null} [errorsString] errorsString
 * @example
 * {
 *   "succeeded": false,
 *   "logicError": "OrderNotFound",
 *   "errors": [
 *     "Order not found"
 *   ]
 * }
 */

/**
 * AzbitCreateResult raw REST payload
 * @typedef {object} AzbitCreateResult
 * @property {AzbitCreatedOrder} [data] Creation result on success
 * @property {boolean} [succeeded] Business success; HTTP 200 alone does not imply success
 * @property {Array<string> | null} [errors] errors
 * @property {string | null} [logicError] Stable business rejection reason, such as OrderNotFound
 * @property {string | null} [errorsString] errorsString
 * @example
 * {
 *   "succeeded": true,
 *   "data": {
 *     "id": "70192a8b-c34e-48ce-badf-889584670507"
 *   }
 * }
 */

/**
 * AzbitCreatedOrder raw REST payload
 * @typedef {object} AzbitCreatedOrder
 * @property {string} [id] id
 * @property {number} [effectiveFeeMode] effectiveFeeMode
 * @property {string | null} [clientOrderId] clientOrderId
 */

/**
 * AzbitDeposit raw REST payload
 * @typedef {object} AzbitDeposit
 * @property {string | null} [address] address
 * @property {string | null} [addressPublicKey] addressPublicKey
 * @property {string | null} [addressMemo] Deposit memo/tag; must not be discarded
 * @property {number} [comissionPercent] comissionPercent
 * @property {number} [comissionMinimum] comissionMinimum
 * @property {number | null} [minAmount] minAmount
 * @property {number} [chain] Numeric chain ID resolved through /api/currencies/chains
 * @property {string | null} [chainName] Native chain name when present
 * @property {string | null} [chainContractAddress] chainContractAddress
 * @example
 * {
 *   "address": "example-deposit-address",
 *   "addressMemo": "123",
 *   "chain": 240,
 *   "chainName": "TRX"
 * }
 */

/**
 * Detailed currency metadata from the official API2 service
 * @typedef {object} AzbitCurrency
 * @property {string | null} [code] Currency code, e.g. `USDT`
 * @property {string | null} [value] Human-readable currency name
 * @property {boolean} [isHalted] Whether the whole currency is unavailable
 * @property {boolean} [isFiat] Whether Azbit classifies the currency as fiat
 * @property {number} [digits] Decimal places used to display balances
 * @property {boolean} [allowDeposits] Whether deposits are enabled
 * @property {boolean} [allowWithdrawals] Whether withdrawals are enabled
 * @property {string | null} [networkConfirmations] Required deposit confirmations
 * @property {string | null} [website] Project website
 * @property {string | null} [whitePaper] Project white paper
 * @property {string | null} [about] Project description
 * @property {boolean} [isFuturesOnlyCurrency] Whether the asset is unavailable on spot
 * @property {AzbitCurrencyChain[] | null} [currencyChains] Supported deposit and withdrawal chains
 */

/**
 * One currency chain from the official API2 service
 * @typedef {object} AzbitCurrencyChain
 * @property {number} [chainId] Stable Azbit chain identifier
 * @property {boolean} [isNativeToken] Whether this currency is native to the chain
 * @property {string | null} [contractAddress] Token contract address, when applicable
 * @property {string | null} [chainName] Native Azbit chain name
 * @property {string | null} [displayName] User-facing chain name
 * @property {AzbitWithdrawalType} [type] Withdrawal address type
 */

/**
 * Per-currency network commissions from the official API2 service
 * @typedef {object} AzbitNetworkCommissions
 * @property {string | null} [currencyCode] Currency code
 * @property {AzbitChainCommission[] | null} [chainCommissions] Fees and limits by chain
 */

/**
 * One network fee definition from the official API2 service
 * @typedef {object} AzbitChainCommission
 * @property {string | null} [chainName] Native Azbit chain name
 * @property {number} [chainId] Stable Azbit chain identifier
 * @property {number} [minimalWithdrawal] Minimum amount sent in one withdrawal
 * @property {string | null} [minimalWithdrawalCurrency] Currency of the minimum amount
 * @property {number} [depositFee] Deposit fee
 * @property {string | null} [withdrawalFee] Fixed amount or percentage string such as `1.5` or `22.5%`
 * @property {string | null} [withdrawalFeeCurrency] Currency used to pay the withdrawal fee
 */

/**
 * AzbitKeyInfo raw REST payload
 * @typedef {object} AzbitKeyInfo
 * @property {string | null} [publicKey] The key used to authenticate this request
 * @property {string | null} [userId] Owner of the key — the same id that appears on orders and deals
 * @property {string | null} [description] Free-text label set when the key was created
 * @property {string} [dateCreated] When the key was issued
 * @property {boolean} [canTrade] Place and cancel orders
 * @property {boolean} [canReadUserInfo] Read orders, deals and balances
 * @property {boolean} [canWithdraw] Whether this key may request withdrawals
 * @property {Array<string> | null} [ipWhitelist] Allowed caller IP addresses; an empty whitelist means no restriction
 * @example
 * {
 *   "canReadUserInfo": true,
 *   "canTrade": true,
 *   "canWithdraw": false
 * }
 */

/**
 * AzbitProfile raw REST payload
 * @typedef {object} AzbitProfile
 * @property {string | null} [userId] Identifier of the account this key authenticates as
 */

/**
 * Processable exchange rejection, never a successful empty response
 * @typedef {object} AzbitError
 * @property {string} azbitErrorInfo Safe description without request headers
 * @property {number} httpStatus HTTP response status
 * @property {string} [logicError] Stable business reason when provided
 * @property {number} [code] Exchange numeric code when provided
 * @example
 * { azbitErrorInfo: 'OrderNotFound', httpStatus: 200, logicError: 'OrderNotFound' }
 */

/**
 * @typedef {object} AzbitChain
 * @property {number} code Chain identifier used in deposit responses
 * @property {string} name Exchange network name
 * @example
 * { code: 350, name: 'ADM' }
 */

/**
 * One ungrouped level from the public order book
 * @typedef {object} AzbitBookLevel
 * @property {boolean} isBid true for bids, false for asks
 * @property {number} price Quote price per base asset
 * @property {number} amount Base quantity
 * @example
 * { isBid: true, price: 0.02, amount: 100 }
 */

module.exports = {};
