module.exports = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  SAT: 100000000, // 1 ADM = 100000000
  ADM_EXPLORER_URL: 'https://explorer.adamant.im',
  EPOCH: Date.UTC(2017, 8, 2, 17, 0, 0, 0), // ADAMANT's epoch time
  TX_CHECKER_INTERVAL: 4 * 1000, // Check for new Txs every 4 seconds; additionally Exchanger receives new Txs instantly via socket
  UPDATE_CRYPTO_RATES_INTERVAL: 60 * 1000, // Update crypto rates every minute
  PRECISION_DECIMALS: 8, // Accuracy for converting cryptos, 9.12345678 ETH
  PRINT_DECIMALS: 8, // For pretty print, 9.12345678 ETH
  DEFAULT_WITHDRAWAL_PRECISION: 8, // If exchange's currency info doesn't provide coin decimals
  MAX_ADM_MESSAGE_LENGTH: 10000,
  MAX_TELEGRAM_MESSAGE_LENGTH: 4095,
  EXECUTE_IN_ORDER_BOOK_MAX_PRICE_CHANGE_PERCENT: 0.15, // In-orderbook trading: don't change price by mm-order more, than 0.15%
  EXECUTE_IN_ORDER_BOOK_MAX_SPREAD_PERCENT: 0.15 / 1.25, // In-orderbook trading: Maintain spread percent
  LIQUIDITY_SS_MAX_SPREAD_PERCENT: 0.2, // Liquidity spread support orders: Maintain spread percent
  DEFAULT_ORDERBOOK_ORDERS_COUNT: 15,
  DEFAULT_PW_DEVIATION_PERCENT_FOR_DEPTH_PM: 1,
  SOCKET_DATA_VALIDITY_MS: 2000,
  SOCKET_DATA_MAX_HEARTBEAT_INTERVAL_MS: 25000,
  MM_POLICIES: ['optimal', 'spread', 'orderbook', 'depth', 'wash'],
  MM_POLICIES_VOLUME: ['optimal', 'spread', 'orderbook', 'wash'],
  MM_POLICIES_REGULAR: ['optimal', 'spread', 'orderbook', 'depth'],
  MM_POLICIES_REGULAR_VOLUME: ['optimal', 'spread', 'orderbook'],
  MM_POLICIES_IN_SPREAD_TRADING: ['optimal', 'spread', 'wash'],
  MM_POLICIES_IN_ORDERBOOK_TRADING: ['optimal', 'orderbook', 'depth'],
  LADDER_STATES: ['Not placed', 'Open', 'Filled', 'Partly filled', 'Cancelled', 'Missed', 'To be removed', 'Removed'],
  LADDER_OPENED_STATES: ['Open', 'Partly filled'],
  LADDER_PREVIOUS_FILLED_ORDER_STATES: [undefined, 'Not placed', 'Filled', 'Cancelled', 'To be removed', 'Removed'],
  REGEXP_WHOLE_NUMBER: /^[0-9]+$/,
  REGEXP_UUID: /^[a-f\d]{4}(?:[a-f\d]{4}-){4}[a-f\d]{12}$/,
};
