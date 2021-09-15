module.exports = {
  SAT: 100000000, // 1 ADM = 100000000
  ADM_EXPLORER_URL: 'https://explorer.adamant.im',
  TX_CHECKER_INTERVAL: 4 * 1000, // Check for new Txs every 4 seconds; additionally Exchanger receives new Txs instantly via socket
  PRECISION_DECIMALS: 8, // Accuracy for converting cryptos, 9.12345678 ETH
  PRINT_DECIMALS: 8, // For pretty print, 9.12345678 ETH
};
