const FameEXApi = require('./api/fameex_api');
const utils = require('../helpers/utils');
const networks = require('../helpers/networks');

/**
 * API endpoints:
 * https://api.fameex.com
 */
const apiServer = 'https://api.fameex.com';
const exchangeName = 'FameEX';

const fameEXOrderStates = {
  // For spot/orderdetail (getOrderDetails)
  new: [1, 2], // 1- Created 2- Waiting for Transaction
  partiallyFilled: 3,
  filled: 4,
  cancelled: [5, 6], // 5- Partially Cancelled 6- Cancelled
  // For /spot/orderlist (getOrders)
  uncompleted: 7,
  completed: 8,
  completedOrCancelled: 9,
};

const orderStatuses = {
  new: 'new',
  partFilled: 'part_filled',
  filled: 'filled',
  cancelled: 'cancelled',
  unknown: 'unknown',
};

const fameEXOrderTypes = [1, 2, 3, 4, 5];

const fameEXOrderTypesMap = {
  1: 'limit',
  2: 'market',
  3: 'take_profit_and_stop_loss',
  4: 'tracking_order',
  5: 'maker_only',
};

const fameEXOrderSides = {
  buy: 1,
  sell: 2,
};

const systemToFameEXOrderTypesMap = {
  0: 2, // Sell order
  1: 1, // Buy order
};

const ordersMaxPageSize = 500;

const successCode = 200;

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const fameEXApiClient = FameEXApi();
  fameEXApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets and currencies on initialization
  if (loadMarket) {
    getCurrencies();
    getMarkets();
  }

  /**
   * Get info on all currencies
   * @param {String} coin
   * @param {Boolean} forceUpdate Update currencies to refresh parameters
   * @returns {Promise<unknown>|*}
   */
  function getCurrencies(coin, forceUpdate = false) {
    if (module.exports.gettingCurrencies) return;
    if (module.exports.exchangeCurrencies && !forceUpdate) return module.exports.exchangeCurrencies[coin];

    module.exports.gettingCurrencies = true;

    return new Promise((resolve) => {
      Promise.all([
        fameEXApiClient.currencies(),
        fameEXApiClient.currenciesWithNetwork(),
      ])
          .then(([currenciesData, currenciesWithNetworks]) => {
            try {
              const result = {};

              const currencies = currenciesData.data;

              const networksByCurrency = new Map();

              for (const currencyWithNetwork of currenciesWithNetworks.data.list) {
                const currencyNetworks = {};

                for (const netData of Object.values(currencyWithNetwork.currencyDetail)) {
                  currencyNetworks[formatNetworkName(netData.chainType)] = {
                    id: netData.id.toString(),
                    chainName: netData.chainType,
                    status: netData.currencyRecharge.state === 1 && netData.currencyWithdraw.state === 1,
                    withdrawalFee: +netData.currencyWithdraw.feewithdraw,
                    minWithdraw: +netData.currencyWithdraw.onceminwithdraw,
                    confirmations: +netData.currencyRecharge.blockConfirmNumber,
                  };
                }

                networksByCurrency.set(
                    currencyWithNetwork.currency.toUpperCase(),
                    { currencyNetworks, name: currencyWithNetwork.nameEn },
                );
              }

              for (const coin in currencies) {
                // Returned data is not full and doesn't include decimals, precision, min amounts, etc
                const currency = currencies[coin];
                const networkByCurrency = networksByCurrency.get(currency.name.toUpperCase());

                result[currency.name.toUpperCase()] = {
                  symbol: currency.name.toUpperCase(),
                  name: networkByCurrency?.name || currency.name.toUpperCase(),
                  status: undefined,
                  comment: undefined,
                  confirmations: undefined,
                  withdrawalFee: undefined,
                  minWithdraw: +currency.min_withdraw,
                  maxWithdraw: +currency.max_withdraw,
                  logoUrl: undefined,
                  exchangeAddress: undefined,
                  decimals: undefined,
                  precision: undefined,
                  networks: networkByCurrency?.currencyNetworks,
                  defaultNetwork: undefined,
                  withdrawEnabled: currency.can_withdraw,
                  depositEnabled: currency.can_deposit,
                  id: currency.unified_cryptoasset_id,
                };
              }

              if (Object.keys(result).length > 0) {
                module.exports.exchangeCurrencies = result;
                log.log(`${forceUpdate ? 'Updated' : 'Received'} info about ${Object.keys(result).length} currencies on ${exchangeName} exchange.`);
              }

              module.exports.gettingCurrencies = false;
              resolve(result);
            } catch (error) {
              log.warn(`Error while processing getCurrencies() request: ${error}`);
              resolve(undefined);
            }
          }).catch((error) => {
            log.warn(`API request getCurrencies() of ${utils.getModuleName(module.id)} module failed. ${error}`);
            resolve(undefined);
          }).finally(() => {
            module.exports.gettingCurrencies = false;
          });
    });
  }

  /**
   * Get info on all markets
   * @param {String} pair In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairPlain : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      fameEXApiClient.markets().then((markets) => {
        try {
          const result = {};

          markets.data.forEach((market) => {
            const pairNames = formatPairName(market.pair);

            result[pairNames.pairPlain] = {
              pairReadable: pairNames.pairReadable,
              pairPlain: pairNames.pairPlain,
              coin1: pairNames.coin1,
              coin2: pairNames.coin2,
              coin1Decimals: +market.amountPrecision,
              coin2Decimals: +market.pricePrecision,
              coin1Precision: utils.getPrecision(+market.amountPrecision),
              coin2Precision: utils.getPrecision(+market.pricePrecision),
              coin1MinAmount: +market.permitAmount,
              coin1MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: null,
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          module.exports.gettingMarkets = false;
          resolve(result);
        } catch (error) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${error}`);
          resolve(undefined);
        }
      }).catch((error) => {
        log.warn(`API request getMarkets() of ${utils.getModuleName(module.id)} module failed. ${error}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingMarkets = false;
      });
    });
  }

  return {
    getMarkets,
    getCurrencies,

    /**
     * Getter for stored markets info
     * @return {Object}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },

    /**
     * Getter for stored currencies info
     * @return {Object}
     */
    get currencies() {
      return module.exports.exchangeCurrencies;
    },

    /**
     * Get info for a specific market
     * @param pair In readable format as BTC/USDT or BTC-USDT or BTC_USDT
     * @returns {Promise<*>|*}
     */
    marketInfo(pair) {
      return getMarkets(pair);
    },

    /**
     * Get info for a specific currency
     * @param coin As BTC
     * @returns {Promise<*>|*}
     */
    currencyInfo(coin) {
      return getCurrencies(coin);
    },

    /**
     * Features available on FameEX exchange
     * @returns {Object}
     */
    features() {
      return {
        getDepositAddress: true,
        getMarkets: true,
        getCurrencies: true,
        placeMarketOrder: true,
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: false,
        getTradingFees: false,
        getAccountTradeVolume: false,
        selfTradeProhibited: false,
        getFundHistory: true,
        getFundHistoryImplemented: false,
        supportCoinNetworks: true,
      };
    },

    /**
     * Get user balances
     * @param {Boolean} nonzero Return only non-zero balances
     * @returns {Promise<Array|undefined>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      let balances;

      try {
        balances = await fameEXApiClient.getBalances();
      } catch (error) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const spotWallet = balances.data.filter((wallet) => wallet.walletType === 'spot')[0].list;

        const result = [];

        spotWallet.forEach((crypto) => {
          result.push({
            code: crypto.currency.toUpperCase(),
            free: +crypto.available,
            freezed: +crypto.hold,
            total: +crypto.total,
          });
        });

        if (nonzero) {
          return result.filter((crypto) => crypto.free || crypto.freezed);
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getBalances(${paramString}) request results: ${JSON.stringify(balances)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get one page of account open orders
     * @param {Object} pair Formatted coin pair
     * @param {Number} pageNum Pagination, the first few pages (1 <= pageNum)
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrdersPage(pair, pageNum = 1) {
      const paramString = `pair: ${pair.pairReadable}`;

      let ordersData;

      try {
        ordersData = await fameEXApiClient.getOrders(
            pair.coin1,
            pair.coin2,
            fameEXOrderTypes,
            fameEXOrderStates.uncompleted,
            pageNum,
            ordersMaxPageSize,
        );
      } catch (error) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const orders = ordersData.data.orders.filter((order) => order.accountType === 'spot');

        const result = [];

        orders.forEach((order) => {
          result.push({
            orderId: order.orderId,
            symbol: pair.pairReadable,
            symbolPlain: pair.pairPlain,
            price: +order.price,
            side: order.side === fameEXOrderSides.buy ? 'buy' : 'sell',
            type: fameEXOrderTypesMap[order.orderType] || 'unknown',
            timestamp: order.createTime * 1000,
            amount: +order.amount,
            amountExecuted: +order.filledAmount,
            amountLeft: +order.amount - +order.filledAmount,
            status: formatOrderStatus(order.state),
          });
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request results: ${JSON.stringify(ordersData)}. ${error}`);
        return undefined;
      }
    },

    /**
     * List of all account open orders
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrders(pair) {
      const allOrders = [];
      const pairNames = formatPairName(pair);

      let ordersInfo;
      let pageNum = 1;

      do {
        ordersInfo = await this.getOpenOrdersPage(pairNames, pageNum);

        if (!ordersInfo) return undefined;

        allOrders.push(...ordersInfo);

        pageNum += 1;
      } while (ordersInfo.length === ordersMaxPageSize);

      return allOrders;
    },

    /**
     * Get specific order details
     * What's important is to understand the order was filled or closed by other reason
     * status: unknown, new, filled, part_filled, cancelled
     * @param {String} orderId Example: '10918742125338689536'
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const pairNames = formatPairName(pair);

      let order;

      try {
        order = await fameEXApiClient.getOrder(pairNames.pairPlain, orderId);
      } catch (error) {
        log.warn(`API request getOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.code === successCode) {
          return {
            orderId: order.data.orderId.toString(),
            tradesCount: undefined, // FameEX doesn't provide trades
            price: +order.data.price,
            side: order.data.side === fameEXOrderSides.buy ? 'buy' : 'sell',
            type: fameEXOrderTypesMap[order.data.orderType] || 'unknown',
            amount: +order.data.amount,
            volume: +order.data.money || +order.data.amount * +order.data.triggerPrice || +order.data.amount * +order.data.price,
            pairPlain: pairNames.pairPlain,
            pairReadable: pairNames.pairReadable,
            totalFeeInCoin2: +order.data.filledFee * +order.data.price,
            amountExecuted: +order.data.filledAmount,
            volumeExecuted: +order.data.filledMoney,
            timestamp: order.data.createTime * 1000,
            updateTimestamp: order.data.updateTime * 1000,
            status: formatOrderStatus(order.data.state),
          };
        } else {
          const errorMessage = order.fameexErrorInfo ?? 'No details';
          log.log(`Unable to get order ${orderId} details: ${JSON.stringify(errorMessage)}. Returning unknown order status.`);
          return {
            orderId,
            status: 'unknown', // Order doesn't exist or Wrong orderId
            // WARN: In case if request details of just cancelled order, API returns { code: 280035, msg: 'fail' };
            // It's the same error as when Order doesn't exist or Wrong orderId
          };
        }
      } catch (error) {
        log.warn(`Error while processing getOrder(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Places an order
     * FameEX supports both limit and market orders
     * Market Buy is only possible with quote coin amount specified
     * Market Sell is only possible with base coin amount specified
     * Limit Buy/Sell is only possible with base coin amount specified
     * In FameEX API amount param can be a Base or Quote based on the order type
     * @param {String} side 'buy' or 'sell'
     * @param {String} pair In classic format like BTC/USD
     * @param {Number} price Order price
     * @param {Number} coin1Amount Base coin amount !Provide coin1Amount only for Market Sell or Limit Buy/Sell
     * @param {Number} limit 1 if order is limit (default), 0 in case of market order
     * @param {Number} coin2Amount Quote coin amount !Provide coin2Amount only for Market Buy
     * @returns {Promise<Object>|undefined}
     */
    async placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `side: ${side}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

      const pairNames = formatPairName(pair);

      const marketInfo = this.marketInfo(pair);

      let message;

      if (!marketInfo) {
        message = `Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`;
        log.warn(message);
        return {
          message,
        };
      }

      // for Limit orders, calculate coin1Amount if only coin2Amount is provided
      if (!coin1Amount && coin2Amount && price) {
        coin1Amount = coin2Amount / price;
      }

      // for Limit orders, calculate coin2Amount if only coin1Amount is provided
      let coin2AmountCalculated;
      if (!coin2Amount && coin1Amount && price) {
        coin2AmountCalculated = coin1Amount * price;
      }

      if (coin1Amount) {
        coin1Amount = (+coin1Amount).toFixed(this.marketInfo(pair).coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(this.marketInfo(pair).coin2Decimals);
      }
      if (price) {
        price = (+price).toFixed(this.marketInfo(pair).coin2Decimals);
      }

      if (coin1Amount < marketInfo.coin1MinAmount) {
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${pair} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (coin2Amount && coin2Amount < marketInfo.coin2MinAmount) { // coin2Amount may be null
        message = `Unable to place an order on ${exchangeName} exchange. Order volume ${coin2Amount} ${marketInfo.coin2} is less minimum ${marketInfo.coin2MinAmount} ${marketInfo.coin2} on ${pair} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      let output = '';

      if (limit) {
        if (coin2Amount) {
          output = `${side} ${coin1Amount} ${pairNames.coin1} for ${coin2Amount} ${pairNames.coin2} at ${price} ${pairNames.coin2}.`;
        } else {
          output = `${side} ${coin1Amount} ${pairNames.coin1} for ${coin2AmountCalculated} ${pairNames.coin2} at ${price} ${pairNames.coin2}.`;
        }
      } else {
        if (coin2Amount) {
          output = `${side} ${pairNames.coin1} for ${coin2Amount} ${pairNames.coin2} at Market Price on ${pair} pair.`;
        } else {
          output = `${side} ${coin1Amount} ${pairNames.coin1} at Market Price on ${pair} pair.`;
        }
      }

      const order = {};
      let orderId;
      let errorMessage;

      try {
        const response = await fameEXApiClient.addOrder(
            pairNames.pairPlain,
            coin1Amount,
            coin2Amount,
            price,
            fameEXOrderSides[side],
            systemToFameEXOrderTypesMap[limit],
        );

        errorMessage = response?.msg;
        orderId = response?.data?.orderId;
      } catch (error) {
        message = `API request addOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}.`;
        log.warn(message);
        order.orderId = false;
        order.message = message;

        return order;
      }

      if (orderId) {
        message = `Order placed to ${output} Order Id: ${orderId}.`;
        log.info(message);
        order.orderId = orderId;
        order.message = message;
      } else {
        const details = errorMessage ? ` Details: ${utils.trimAny(errorMessage, ' .')}.` : ' { No details }.';
        message = `Unable to place order to ${output}${details} Check parameters and balances.`;
        log.warn(message);
        order.orderId = false;
        order.message = message;
      }

      return order;
    },

    /**
     * Cancel an order
     * @param {String} orderId Example: '10918742125338689536'
     * @param {String} side Not used for FameEX
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      const pairNames = formatPairName(pair);

      let order;

      try {
        order = await fameEXApiClient.cancelOrder(pairNames.pairPlain, orderId);
      } catch (error) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.code === successCode) {
          log.log(`Cancelling order ${orderId} on ${pair} pair…`);
          return true;
        } else { // Order already cancelled or doesn't exist or wrong orderId (same error code 280035)
          const errorMessage = order.fameexErrorInfo ?? 'No details';
          log.log(`Unable to cancel order ${orderId} on ${pair} pair: ${errorMessage}.`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelOrder(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Cancel all order on specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelAllOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      let orders;

      try {
        orders = await fameEXApiClient.cancelAllOrders(pairNames.pairPlain);
      } catch (error) {
        log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (orders.code === 280033) {
          log.log(`No active orders on ${pairNames.pairReadable} pair.`);
          return true;
        } else if (orders.code === successCode) {
          log.log(`Cancelling orders on ${pairNames.pairReadable} pair…`);
          return true;
        } else {
          const errorMessage = orders.fameexErrorInfo ?? 'No details';
          log.log(`Unable to cancel orders on ${pairNames.pairReadable} pair: ${errorMessage}.`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelAllOrders(${paramString}) request result: ${JSON.stringify(orders)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get info on trade pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      let ticker;

      try {
        ticker = await fameEXApiClient.ticker();
      } catch (error) {
        log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        ticker = ticker.find((t) => t.trading_pairs === pairNames.pairPlain);

        return {
          ask: +ticker.lowest_ask,
          bid: +ticker.highest_bid,
          last: +ticker.last_price,
          volume: +ticker.base_volume,
          volumeInCoin2: +ticker.quote_volume,
          high: +ticker.highest_price_24h,
          low: +ticker.lowest_price_24h,
        };
      } catch (error) {
        log.warn(`Error while processing getRates(${paramString}) request result: ${JSON.stringify(ticker)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get orderbook on a specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      let book;

      try {
        book = await fameEXApiClient.orderBook(pairNames.pairPlain);
      } catch (error) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = {};

        result.asks = book.data.asks.map((ask) => ({
          amount: +ask[1],
          price: +ask[0],
          count: 1,
          type: 'ask-sell-right',
        }));
        result.asks.sort((a, b) => {
          return parseFloat(a.price) - parseFloat(b.price);
        });

        result.bids = book.data.bids.map((bid) => ({
          amount: +bid[1],
          price: +bid[0],
          count: 1,
          type: 'bid-buy-left',
        }));
        result.bids.sort((a, b) => {
          return parseFloat(b.price) - parseFloat(a.price);
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getOrderBook(${paramString}) request result: ${JSON.stringify(book)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get history of trades
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async getTradesHistory(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      let trades;

      try {
        trades = await fameEXApiClient.getTradesHistory(pairNames.pairPlain);
        if (trades?.length === 0) {
          throw String('Trade history is empty, probably API error.');
        }
      } catch (error) {
        log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = [];

        trades.forEach((trade) => {
          result.push({
            coin1Amount: +trade.base_volume, // amount in coin1
            price: +trade.price, // trade price
            coin2Amount: +trade.quote_volume, // quote in coin2
            date: +trade.timestamp,
            type: trade.type, // 'buy' or 'sell'
            tradeId: trade.trade_id.toString(),
          });
        });

        // We need ascending sort order
        result.sort((a, b) => {
          return parseFloat(a.date) - parseFloat(b.date);
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getTradesHistory(${paramString}) request result: ${JSON.stringify(trades)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get deposit address for specific coin
     * @param coin e.g. BTC
     * @returns {Promise<[]|undefined>}
     */
    async getDepositAddress(coin) {
      const paramString = `coin: ${coin}`;

      const coinInfo = this.currencyInfo(coin);

      if (!coinInfo) {
        log.warn(`Unable to get deposit address for ${coin} on FameEX. I don't have info about coin ${coin}.`);
        return undefined;
      }

      try {
        const networks = coinInfo.networks ?
            Object.values(coinInfo.networks).filter((network) => network.status).map((network) => network.chainName) :
            [coinInfo.symbol];

        let addresses;
        try {
          addresses = await Promise.all(networks.map(async (network) => {
            return fameEXApiClient.getDepositAddress(coin, network);
          }));
        } catch (error) {
          log.warn(`API request getDepositAddress(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
          return undefined;
        }

        const result = [];

        addresses.forEach((address, idx) => {
          if (address.code === successCode) {
            result.push({
              network: networks[idx],
              address: address.data.address,
            });
          } else {
            log.warn(`Unable to get deposit address for ${coinInfo.symbol} on ${networks[idx]} chain.`);
          }
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getDepositAddress(${paramString}) request: ${error}`);
        return undefined;
      }
    },
  };
};

/**
 * Returns network name in classic format
 * @param {String} network FameEX's network name (chainType)
 * @return {String}
 */
function formatNetworkName(network) {
  const networksToSystemNameMap = {
    POLYGON: networks['MATIC'].code,
    'AVAX-CCHAIN': networks['AVAX-C-CHAIN'].code,
    AVAXC: networks['AVAX-C-CHAIN'].code,
    BSC: networks['BEP20'].code,
    BCH: networks['BTC'].code,
    TRX: networks['TRC20'].code,
  };

  network = network?.toUpperCase();
  return networks[network]?.code ?? networksToSystemNameMap[network] ?? network;
}

/**
 * Returns pair in classic format BTC/USDT
 * @param {String} pair Pair in FameEX format like BTC-USDT
 * @return {Object} pairReadable, pairPlain, coin1, coin2
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();
  const [coin1, coin2] = pair.split(/[-_/]/);

  return {
    pair: `${coin1}/${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}-${coin2}`,
    coin1,
    coin2,
  };
}

/**
 * Returns system order status
 * @param {String} orderState State in FameEX format
 * @return {string}
 */
function formatOrderStatus(orderState) {
  if (fameEXOrderStates.new.includes(orderState)) {
    return orderStatuses.new;
  }
  if (orderState === fameEXOrderStates.partiallyFilled) {
    return orderStatuses.partFilled;
  }
  if (orderState === fameEXOrderStates.filled) {
    return orderStatuses.filled;
  }
  if (fameEXOrderStates.cancelled.includes(orderState)) {
    return orderStatuses.cancelled;
  }

  return orderStatuses.unknown;
}
