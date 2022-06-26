module.exports = {
  HOUR: 60 * 60 * 1000,
  SAT: 100000000, // 1 ADM = 100000000
  ADM_EXPLORER_URL: 'https://explorer.adamant.im',
  EPOCH: Date.UTC(2017, 8, 2, 17, 0, 0, 0), // ADAMANT's epoch time
  TX_CHECKER_INTERVAL: 4 * 1000, // Check for new Txs every 4 seconds; additionally Exchanger receives new Txs instantly via socket
  UPDATE_CRYPTO_RATES_INTERVAL: 60 * 1000, // Update crypto rates every minute
  PRECISION_DECIMALS: 8, // Accuracy for converting cryptos, 9.12345678 ETH
  PRINT_DECIMALS: 8, // For pretty print, 9.12345678 ETH
};
