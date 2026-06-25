/**
 * types/bot/configReader.d.js
 *
 * Type definitions for the bot configuration object (`modules/configReader.js`).
 * The module is loaded at startup and exports a single enriched config object.
 */

/**
 * MongoDB connection settings from the `db` config section.
 *
 * @typedef {Object} BotDbConfig
 * @property {string} name Database name
 * @property {string} url MongoDB connection URL
 * @property {import('mongodb').MongoClientOptions} [options] Driver options (timeouts, server API, etc.)
 */

/**
 * Balance watcher thresholds from config.
 *
 * @typedef {Object} BotBalanceWatcherConfig
 * @property {number} coin2BalanceThresholdPercent Alert when coin2 balance drops below this % of the target
 * @property {number} expectedValueThresholdPercent Allowed deviation from the expected portfolio value (%)
 * @property {number} expectedValueThresholdCOIN2 Allowed deviation from the expected value in coin2 units
 */

/**
 * Sniper Bot Watcher settings from config.
 *
 * @typedef {Object} BotSniperBotWatcherConfig
 * @property {boolean} sbwEnabled Whether Sniper Bot Watcher is enabled
 * @property {number} safeModeThreshold Consecutive in-spread checks before safe mode
 * @property {number} resetThreshold Consecutive checks before counters reset
 */

/**
 * Nice Chart service settings from config.
 *
 * @typedef {Object} BotNiceChartConfig
 * @property {boolean} enabled Whether Nice Chart integration is enabled
 * @property {number} failedRequestsBeforeFallback Failures before falling back to local candles
 */

/**
 * One fund-supplier coin entry from config.
 *
 * @typedef {Object} BotFundSupplierCoin
 * @property {string} coin Coin symbol (normalized to uppercase at load time)
 * @property {string[]} sources Source exchange ids (normalized to uppercase at load time)
 */

/**
 * Fund supplier settings from config.
 *
 * @typedef {Object} BotFundSupplierConfig
 * @property {boolean} enabled Whether the fund supplier module is enabled
 * @property {BotFundSupplierCoin[]} coins Coins and their funding sources
 */

/**
 * ADAMANT key pair derived from `passPhrase` when it is valid.
 *
 * @typedef {Object} BotAdmKeyPair
 * @property {Buffer} publicKey ADAMANT public key
 * @property {Buffer} privateKey ADAMANT private key
 */

/**
 * Fully parsed bot configuration exported by `modules/configReader.js`.
 *
 * Includes both raw config-file fields and values computed during startup
 * (pair normalization, bot id, notify name, trade params path, etc.).
 *
 * @typedef {Object} BotConfig
 * @property {boolean} dev `true` when started with `dev`/`test` argv or `DEV=true`
 * @property {boolean} cli Whether the interactive CLI is enabled in config
 * @property {boolean} doClearDB `true` when started with the `clear_db` argv flag
 * @property {string} [configFile] Relative path to the loaded config file
 * @property {string} [configCustom] Custom config suffix from argv, if any
 * @property {boolean} hasAdmPassphrase Whether `passPhrase` is a valid 12- or 24-word mnemonic
 * @property {string} name Package name from `package.json`
 * @property {string} version Package version from `package.json`
 * @property {string} [project_name] Optional display project name from the config file (mapped to `projectName`)
 * @property {string} projectNamePlain Directory-based project label derived from the repo folder name
 * @property {string} projectName Display project name (from config or derived from directory)
 * @property {string} [projectBranch] Current git branch (filled asynchronously)
 * @property {boolean} isDemoAccount Demo/sandbox account flag
 * @property {string} pair Spot trading pair in `BASE/QUOTE` form (uppercase)
 * @property {string} [perpetual] Perpetual instrument id (uppercase, no slash) when set
 * @property {string} defaultPair `perpetual` when set, otherwise `pair`
 * @property {string} coin1 Base asset symbol
 * @property {string} coin2 Quote asset symbol
 * @property {string} supported_exchanges Comma-separated list from `exchanges`
 * @property {string} exchangeName Exchange id as written in config
 * @property {string} exchange Lowercase exchange connector id
 * @property {string} file Trade params filename, e.g. `tradeParams_binance.js`
 * @property {string} fileWithPath Relative path to trade params under `./trade/settings/`
 * @property {boolean} email_notify_enabled Whether SMTP and recipient lists are configured
 * @property {string} bot_id Unique bot identifier used in logs and ComServer
 * @property {string} accountFull `{account}@{exchangeName}` label
 * @property {string} bot_name Human-readable bot name (defaults to `bot_id`)
 * @property {string} notifyName Bot name with active account channels for notifications
 * @property {BotAdmKeyPair} [keyPair] Present when `hasAdmPassphrase` is true
 * @property {string} [publicKey] Hex public key when ADM account is configured
 * @property {string} [address] ADAMANT address when ADM account is configured
 * @property {string} passPhrase ADAMANT mnemonic from config
 * @property {string[]} admin_accounts ADAMANT addresses allowed to run bot commands
 * @property {boolean} notify_non_admins Whether to send a one-time reply to non-admin senders
 * @property {string} manageTelegramBotToken Telegram management bot token
 * @property {string[]} [node_ADM] ADAMANT node URLs
 * @property {string[]} infoservice Infoservice base URL list used for crypto rates
 * @property {string[]} exchanges Supported exchange ids from config
 * @property {string} apikey Spot API key
 * @property {string} apisecret Spot API secret
 * @property {string} [apipassword] Spot API password (exchanges that require it)
 * @property {string} [apikey2] Second trade-account API key (two-key trading / fund balancer)
 * @property {string} [apisecret2] Second trade-account API secret
 * @property {string} [apipassword2] Second trade-account API password (exchanges that require it)
 * @property {string} [perpetual_apikey] Perpetual API key (falls back to spot credentials)
 * @property {string} [perpetual_apisecret] Perpetual API secret (falls back to spot credentials)
 * @property {string} [perpetual_apipassword] Perpetual API password (falls back to spot credentials)
 * @property {string} [account] Optional sub-account label appended to `bot_id`
 * @property {string} welcome_string Greeting message sent to users (supports `{bot_name}` placeholder)
 * @property {BotDbConfig} db MongoDB connection settings
 * @property {BotBalanceWatcherConfig} balance_watcher Balance watcher thresholds
 * @property {BotSniperBotWatcherConfig} sniper_bot_watcher Sniper Bot Watcher settings
 * @property {BotNiceChartConfig} nice_chart Nice Chart integration settings
 * @property {BotFundSupplierConfig} fund_supplier Fund supplier module settings
 * @property {Record<string, number>} volumes_thresholds_usd Emoji-to-USD volume tier map
 * @property {string} log_level Minimum log level (`log`, `info`, `warn`, `error`)
 * @property {boolean} silent_mode Suppress non-priority notifications when true
 * @property {Object} [api] Arbitrary API-related settings from config
 * @property {string} [pauseAfterInactivity] Inactivity pause duration string
 * @property {string} [ws_type] WebSocket transport type
 * @property {boolean} [socket] Whether ADAMANT socket delivery is enabled
 * @property {string[]} [adamant_notify] ADAMANT addresses for regular notifications
 * @property {string[]} [adamant_notify_priority] ADAMANT addresses for priority notifications
 * @property {string[]} [telegram] Telegram chat ids for regular notifications
 * @property {string[]} [telegram_priority] Telegram chat ids for priority notifications
 * @property {string[]} [slack] Slack webhook URLs for regular notifications
 * @property {string[]} [slack_priority] Slack webhook URLs for priority notifications
 * @property {string[]} [email_notify] Email addresses for regular notifications
 * @property {string[]} [email_priority] Email addresses for priority notifications
 * @property {number} [email_notify_aggregate_min] Aggregate regular emails every N minutes
 * @property {string} [telegramBotToken] Telegram Bot API token
 * @property {string[]} [discord_notify] Discord webhook URLs for regular notifications
 * @property {string[]} [discord_notify_priority] Discord webhook URLs for priority notifications
 * @property {Object} [email_smtp] Nodemailer-compatible SMTP settings
 * @property {number} [private_webui] Private WebUI listen port
 * @property {string} [private_webui_secret_key] Shared HMAC secret for private WebUI JWT verification
 * @property {string} [private_webui_bind_host] Bind address for the private WebUI API (`127.0.0.1` or `0.0.0.0`)
 * @property {string[]} [private_webui_allowed_ips] Optional client IP allowlist for the private WebUI API
 * @property {string} [public_webui] Public WebUI base URL
 * @property {string} [public_webui_license_token] License token for public WebUI relay (scenario B)
 * @property {string} [com_server] ComServer URL for bot interchange
 * @property {string} [com_server_secret_key] Shared secret for ComServer encryption
 * @property {number} [amount_to_confirm_usd] USD threshold that requires explicit confirmation
 * @property {boolean} [exchange_socket] Use exchange WebSocket feeds when supported
 * @property {boolean} [exchange_socket_pull] Pull-based socket mode for some connectors
 * @property {number} [clearAllOrdersInterval] Interval in minutes to clear unknown orders via order collector; `0` disables
 * @property {BotExchangeRestrictions} [exchange_restrictions] Optional per-exchange limits from config
 */

/**
 * Optional exchange-wide limits from the config file.
 *
 * @typedef {Object} BotExchangeRestrictions
 * @property {number} [minOrderAmountUSD] Default minimum order notional in USD
 * @property {number} [minOrderAmountUpperBoundUSD] Upper bound for randomized min order size in USD
 * @property {number} [orderNumberLimit] Max open orders reported/accepted by the connector
 */

module.exports = {};
