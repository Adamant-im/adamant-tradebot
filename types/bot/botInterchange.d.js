/**
 * types/bot/botInterchange.d.js
 *
 * Type definitions for the ComServer socket bridge (`modules/botInterchange.js`).
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/general.d.js').CommandReply} CommandReply
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 */

/**
 * Bot metadata sent to the ComServer during the socket handshake (before encryption).
 *
 * @typedef {Object} ComServerBotInfo
 * @property {string} pair Trading pair, e.g. `ADM/USDT`
 * @property {string} coin1 Base coin symbol
 * @property {string} coin2 Quote coin symbol
 * @property {string} exchange Exchange connector id
 * @property {string} exchangeName Human-readable exchange name
 * @property {string} name Bot display name
 * @property {string} version Bot version string
 * @property {string} projectName Project name with formatting
 * @property {string} projectNamePlain Plain project name
 * @property {string} projectBranch Git branch label
 * @property {string} botId Unique bot id from config
 * @property {string} botName Short bot name from config
 * @property {string} account Exchange account label
 */

/**
 * Partial transaction context attached to a remote command relayed through ComServer.
 * May originate from ADAMANT, Telegram, or WebUI; only a subset of fields is present.
 *
 * @typedef {Partial<AdamantIncomingTx> & {
 *   senderTgUsername?: string
 * }} RemoteCommandTx
 */

/**
 * Decrypted payload for the `remote-command` socket event.
 *
 * @typedef {Object} RemoteCommandParams
 * @property {string[]} command Command tokens: `[name, ...args]`
 * @property {RemoteCommandTx} [tx] Source message/transaction metadata
 * @property {string} id Request id echoed in the response
 * @property {string} connectionId ComServer connection id echoed in the response
 */

/**
 * Encrypted ComServer response for `remote-command-response`.
 *
 * @typedef {CommandReply & {
 *   command: string[],
 *   botId: string,
 *   id: string,
 *   connectionId: string,
 *   tx: RemoteCommandTx
 * }} RemoteCommandResponse
 */

/**
 * Decrypted payload for the `convert` socket event.
 *
 * @typedef {Object} ComServerConvertRequest
 * @property {string} from Source currency code
 * @property {string} to Target currency code
 * @property {number} amount Amount in the source currency
 */

/**
 * Socket.io client wrapper that talks to the ComServer.
 *
 * @typedef {Object} BotInterchangeConnection
 * @property {import('socket.io-client').Socket | null} connection Active socket, or `null` before `connect()`
 * @property {number} interchangeInterval Polling interval in ms (reserved for future use)
 * @property {NodeJS.Timeout | null} pollingIntervalId Active polling timer id
 * @property {() => void} connect Opens the encrypted socket connection
 * @property {() => void} initHandlers Registers ComServer event listeners
 * @property {() => void} startPolling Starts the periodic heartbeat loop
 */

module.exports = {};
