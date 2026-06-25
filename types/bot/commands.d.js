/**
 * types/bot/commands.d.js
 *
 * Type definitions for the split command handler modules under `modules/commands/`.
 */

/**
 * @typedef {import('types/bot/commandTxs.d.js').CommandTx} CommandTx
 * @typedef {import('types/bot/commandTxs.d.js').CommandHandler} CommandHandler
 * @typedef {import('types/bot/commandTxs.d.js').CommandsRegistry} CommandsRegistry
 * @typedef {import('types/bot/commandTxs.d.js').PendingConfirmationState} PendingConfirmationState
 * @typedef {import('types/bot/commandTxs.d.js').PreviousBalancesCache} PreviousBalancesCache
 * @typedef {import('types/bot/commandTxs.d.js').PreviousOrdersCache} PreviousOrdersCache
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 */

/**
 * Shared runtime singletons exported by `modules/commands/context.js`.
 *
 * @typedef {Object} CommandContext
 * @property {Object} constants Shared app constants (`helpers/const`)
 * @property {Object} utils Shared utility helpers
 * @property {Object} exchangerUtils Currencyinfo / exchanger helpers
 * @property {Object} config Bot configuration reader output
 * @property {Object} log Logger instance
 * @property {Function} notify Operator notification callback
 * @property {Function} adamantApi ADAMANT API factory
 * @property {import('axios').AxiosInstance} axios HTTP client
 * @property {Object} tradeParams Mutable exchange-specific trade parameters
 * @property {Object} orderCollector Order lifecycle collector
 * @property {Object} orderStats Order statistics helpers
 * @property {Object} orderUtils Order parsing and caching helpers
 * @property {Object} balancesHistory Balance snapshot persistence
 * @property {Function} TraderApi Exchange trader adapter constructor
 * @property {Object} traderapi Primary exchange API instance
 * @property {Object} [traderapi2] Optional second-account API instance
 * @property {Object} [perpetualApi] Perpetual contracts API instance
 * @property {boolean} perpetualEnabled Whether perpetual mode is configured
 * @property {Object} botInterchange ComServer client
 * @property {Function} encrypt Config encryption helper
 * @property {Function} decrypt Config decryption helper
 * @property {Function} escapeMarkdownTelegram Telegram markdown escaper
 * @property {Object} telegramBot Telegram management bot API wrapper
 * @property {number} timeToConfirm `/y` confirmation window in milliseconds
 * @property {PendingConfirmationState} pendingConfirmation In-memory confirmation queue
 * @property {PreviousBalancesCache} previousBalances Per-sender balance snapshots
 * @property {PreviousOrdersCache} previousOrders Per-sender order listing snapshots
 * @property {string} moduleName Logger label for the loading module
 */

/**
 * Optional command pack loaded via `utils.softRequire('./commands/…')` in `modules/commandTxs.js`.
 *
 * @typedef {Object} OptionalCommandModule
 * @property {CommandHandler} [remote]
 * @property {CommandHandler} [twap]
 * @property {CommandHandler} [transfer]
 * @property {CommandHandler} [withdraw]
 * @property {CommandHandler} [show]
 * @property {CommandHandler} [make]
 * @property {CommandHandler} [perpetual]
 * @property {CommandHandler} [positions]
 */

module.exports = {};
