/**
 * types/bot/commandTxs.d.js
 *
 * Type definitions for the bot command processor (`modules/commandTxs.js`)
 * and split handlers in `modules/commands/`.
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/general.d.js').CommandReply} CommandReply
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').IncomingAdmTxDbRecord} IncomingAdmTxDbRecord
 * @typedef {import('types/bot/telegramBot.d.js').TelegramCommandTx} TelegramCommandTx
 * @typedef {import('types/bot/telegramBot.d.js').IncomingTgTxDbRecord} IncomingTgTxDbRecord
 * @typedef {import('types/bot/cli.d.js').CLICommandTx} CLICommandTx
 * @typedef {import('types/bot/cli.d.js').IncomingCliTxDbRecord} IncomingCliTxDbRecord
 * @typedef {import('types/bot/featureValidateResult.d.js').FeatureValidateResult} FeatureValidateResult
 * @typedef {import('types/rates.d').RatesResult} RatesResult
 */

/**
 * Incoming command source: ADM chat transaction or Telegram management message.
 *
 * @typedef {Object} CommandTx
 * @property {string} id Message or transaction id
 * @property {string|number} senderId ADM address (`U…`) or Telegram user id
 * @property {string} [senderTgUsername] Human-readable Telegram sender label
 * @property {string} [senderShellUsername] Human-readable OS shell username (CLI)
 * @property {number} [timestamp] Original message or transaction timestamp (Unix seconds for ADM/TG; ms for CLI)
 */

/**
 * MongoDB record for a command message (`incomingtxs` or `incomingtgtxs`).
 *
 * @typedef {IncomingAdmTxDbRecord | IncomingTgTxDbRecord | IncomingCliTxDbRecord} CommandItx
 */

/**
 * Bot feature short code used in `/enable` and `/disable`.
 *
 * @typedef {'t'|'ob'|'liq'|'pw'|'bw'|'ld'|'ag'|'cl'|'sp'|'qh'|'vc'|'vv'|'pmv'|'fb'|'be'|'sm'|'on'} BotFeatureKey
 */

/**
 * Static metadata for one market-making feature.
 *
 * @typedef {Object} BotFeatureDefinition
 * @property {string} description Human-readable feature label
 * @property {string} [module] Relative path to `trade/mm_*.js`; when omitted, no standalone module file is required
 * @property {string} tradeParamActiveName `tradeParams` boolean/number field that toggles the feature
 * @property {boolean} perpetual Whether the feature is available on perpetual contracts
 * @property {string} [requires] Another `tradeParamActiveName` that must be active first
 */

/**
 * Registry of feature metadata keyed by {@link BotFeatureKey}.
 *
 * @typedef {Record<BotFeatureKey, BotFeatureDefinition>} BotFeaturesRegistry
 */

/**
 * In-memory `/y` confirmation state for destructive commands.
 *
 * @typedef {Object} PendingConfirmationState
 * @property {string} command Full command text to re-run after `/y`
 * @property {number} timestamp Unix ms when the command was queued
 */

/**
 * Cached balances snapshot per trade account and per sender.
 *
 * Outer index: `0` = first account, `1` = second account, `2` = combined.
 * Inner key: sender id → `{ timestamp, balances }`.
 *
 * @typedef {Record<string, { timestamp: number, balances: Object }>[]} PreviousBalancesCache
 */

/**
 * Cached open orders per trade account, keyed by sender id.
 *
 * @typedef {Record<string, Object>[]} PreviousOrdersCache
 */

/**
 * Result of {@link GetCoinRatesInfo}.
 *
 * @typedef {Object} CoinRatesInfoResult
 * @property {boolean} success Whether Currencyinfo returned at least one pair
 * @property {Object} exchangeRates Full Currencyinfo rates map (passthrough)
 * @property {string} ratesString Markdown reply fragment for the user
 */

/**
 * Result of {@link GetExchangeRatesInfo}.
 *
 * @typedef {Object} ExchangeRatesInfoResult
 * @property {boolean} success Whether exchange rates were fetched
 * @property {RatesResult} [exchangeRates] Bid/ask/last payload from trader or perpetual API
 * @property {string} ratesString Full user-facing rates block
 * @property {string} spreadString Bid/ask spread line only
 */

/**
 * MongoDB aggregation row for trader order statistics in `composeTraderOrdersFull`.
 *
 * @typedef {Object} TraderOrderStatsAgg
 * @property {number} [totalPlaced]
 * @property {number} [buyPlaced]
 * @property {number} [sellPlaced]
 * @property {number} [buyFilledCount]
 * @property {number} [sellFilledCount]
 * @property {number} [totalFilledCount]
 * @property {number} [inSpreadBuy]
 * @property {number} [inSpreadSell]
 * @property {number} [inSpreadTotal]
 * @property {number} [inOrderBookBuy]
 * @property {number} [inOrderBookSell]
 * @property {number} [inOrderBookTotal]
 * @property {number} [niceChartBuy]
 * @property {number} [niceChartSell]
 * @property {number} [niceChartTotal]
 * @property {number} [buyFilledQuote]
 * @property {number} [sellFilledQuote]
 */

/**
 * Output of order/position listing helpers.
 *
 * @typedef {Object} CommandListResult
 * @property {number} count Number of items listed
 * @property {string} output Markdown text (may be empty)
 * @property {string} [diffOrderCountString] Delta vs. the previous `/orders` snapshot, when applicable
 */

/**
 * Scope for `/balances` output filtering.
 *
 * @typedef {'allcoins'|'full'} BalancesScope
 */

/**
 * Fund history mode for `/show withdrawals` and `/show deposits`.
 *
 * @typedef {'withdrawals'|'withdrawal'|'deposits'} FundHistoryMode
 */

/**
 * Command handler invoked after the command name is parsed and aliases resolved.
 *
 * @typedef {(
 *   params: string[],
 *   tx?: CommandTx,
 *   commandFixOrUser?: string | Object,
 *   isWebApi?: boolean
 * ) => Promise<CommandReply> | CommandReply} CommandHandler
 */

/**
 * Alias resolver: expands shorthand (e.g. `b` → `/balances …`) into a full command string.
 *
 * @typedef {(params: string[]) => string} CommandAliasFn
 */

/**
 * Map of command names to their handlers (also exported as `module.exports.commands`).
 *
 * @typedef {Record<string, (...args: any[]) => any>} CommandsRegistry
 */

/**
 * Map of alias tokens to resolver functions.
 *
 * @typedef {Record<string, CommandAliasFn>} CommandAliasesRegistry
 */

/**
 * Main command processor exported by `modules/commandTxs.js`.
 *
 * @typedef {(
 *   commandMsg: string,
 *   tx: CommandTx,
 *   itx?: CommandItx
 * ) => Promise<CommandReply | undefined>} ProcessCommand
 */

module.exports = {};
