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
  MAX_ADM_MESSAGE_LENGTH: 10000,
  EXECUTE_IN_ORDER_BOOK_MAX_PRICE_CHANGE_PERCENT: 0.15, // In-orderbook trading: don't change price by mm-order more, than 0.15%
  LIQUIDITY_SS_MAX_SPREAD_PERCENT: 0.2, // Liquidity spread support orders: Maintain spread percent
  DEFAULT_ORDERBOOK_ORDERS_COUNT: 15,
  LADDER_STATES: ['Not placed', 'Open', 'Filled', 'Partly filled', 'Cancelled', 'Missed', 'To be removed', 'Removed'],
  LADDER_OPENED_STATES: ['Open', 'Partly filled'],
  REGEXP_WHOLE_NUMBER: /^[0-9]+$/,
  REGEXP_UUID: /^[a-f\d]{4}(?:[a-f\d]{4}-){4}[a-f\d]{12}$/,
};
