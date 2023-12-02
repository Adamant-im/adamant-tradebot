const NonkycAPI = require('./api/nonkyc_api');
const utils = require('../helpers/utils');
const _networks = require('./../helpers/networks');

/**
 * API endpoints:
 * https://nonkyc.io/api/v2
 */
const apiServer = 'https://nonkyc.io/api/v2';
const exchangeName = 'NonKYC';

// Map NonKYC's order status -> Bot's status
const orderStatusMap = {
  Active: 'new',
  New: 'new', // not described in docs, but was found during testing
  Cancelled: 'cancelled',
  Filled: 'filled',
  'Partly Filled': 'part_filled',
};

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const nonkycApiClient = NonkycAPI();

  nonkycApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  if (loadMarket) {
    getMarkets();
    getCurrencies();
  }

  /**
   * Get info on all markets and store in module.exports.exchangeMarkets
   * It's an internal function, not called outside of this module
   * @param {String} [pair] In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairPlain : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      nonkycApiClient.markets().then((markets) => {
        try {
          const result = {};

          for (const market of markets) {
            const pairNames = formatPairName(market.symbol);

            result[pairNames.pairPlain] = {
              pairReadable: pairNames.pairReadable,
              pairPlain: pairNames.pairPlain,
              coin1: pairNames.coin1,
              coin2: pairNames.coin2,
              coin1Decimals: +market.quantityDecimals,
              coin2Decimals: +market.priceDecimals,
              coin1Precision: utils.getPrecision(+market.quantityDecimals),
              coin2Precision: utils.getPrecision(+market.priceDecimals),
              coin1MinAmount: +market.minimumQuantity,
              coin1MaxAmount: null,
              coin2MinPrice: +market.minAllowedPrice || null,
              coin2MaxPrice: +market.maxAllowedPrice || null,
              minTrade: +market.minimumQuantity, // in coin1
              status: market.isActive && !market.isPaused ? 'ONLINE' : 'OFFLINE', // 'ONLINE', 'OFFLINE'
              pairId: market.id,
            };
          }

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

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

  /**
   * Get info on all currencies
   * @param {String} [coin]
   * @param {Boolean} [forceUpdate=false] Update currencies to refresh parameters
   * @returns {Promise<unknown>|*}
   */
  function getCurrencies(coin, forceUpdate = false) {
    if (module.exports.gettingCurrencies) return;
    if (module.exports.exchangeCurrencies && !forceUpdate) return module.exports.exchangeCurrencies[coin];

    module.exports.gettingCurrencies = true;

    return new Promise((resolve) => {
      nonkycApiClient.currencies().then((currencies) => {
        try {
          const result = {};

          const childless = currencies.filter((el) => el.childOf === null);

          for (const currency of childless) {
            result[currency.ticker] = {
              symbol: currency.ticker,
              name: currency.name,
              status: currency.isActive && !currency.isMaintenance ? 'ONLINE' : 'OFFLINE',
              comment: currency.maintenanceNotes,
              confirmations: undefined,
              withdrawalFee: undefined,
              logoUrl: currency.logo,
              exchangeAddress: undefined,
              decimals: undefined,
              precision: undefined,
              networks: {},
              defaultNetwork: undefined,
            };

            if (currency.hasChildren) {
              const children = currencies.filter((el) => el.childOf === currency.id);

              for (const child of children) {
                const [, rawNetwork] = child.ticker.split('-');

                const network = formatNetworkName(child.network, currency.ticker);

                result[currency.ticker].networks[network] = {
                  chainName: rawNetwork,
                  chainNameFull: child.network,
                  status: child.isActive && !child.isMaintenance ? 'ONLINE' : 'OFFLINE',
                  depositStatus: child.depositActive && !child.isMaintenance ? 'ONLINE' : 'OFFLINE',
                  withdrawalStatus: child.withdrawalActive && !child.isMaintenance ? 'ONLINE' : 'OFFLINE',
                  comment: child.maintenanceNotes || child.withdrawalNotes,
                  confirmations: +child.confirmsRequired,
                  withdrawalFee: +child.withdrawFee,
                  withdrawalFeeCurrency: child.tokenOf?.ticker?.split('-')[0],
                  precision: +child.withdrawDecimals,
                };
              }
            } else {
              // Coin has no networks (children)
              result[currency.ticker].networks[currency.ticker] = {
                chainName: currency.ticker,
                chainNameFull: currency.network,
                status: currency.isActive && !currency.isMaintenance ? 'ONLINE' : 'OFFLINE',
                depositStatus: currency.depositActive && !currency.isMaintenance ? 'ONLINE' : 'OFFLINE',
                withdrawalStatus: currency.withdrawalActive && !currency.isMaintenance ? 'ONLINE' : 'OFFLINE',
                comment: currency.maintenanceNotes || currency.withdrawalNotes,
                confirmations: +currency.confirmsRequired,
                withdrawalFee: +currency.withdrawFee,
                precision: +currency.withdrawDecimals,
              };
            }
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

    marketInfo(pair) {
      return getMarkets(pair);
    },

    currencyInfo(coin) {
      return getCurrencies(coin);
    },

    /**
     * Features available on NonKYC exchange
     * @returns {Object}
     */
    features() {
      return {
        getMarkets: true,
        getCurrencies: true,
        placeMarketOrder: true,
        getDepositAddress: true,
        getTradingFees: false,
        getAccountTradeVolume: false,
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: true,
        getFundHistoryImplemented: true,
        allowAmountForMarketBuy: true,
        amountForMarketOrderNecessary: true,
        accountTypes: false, // NonKYC doesn't supports main, trade, margin accounts
        withdrawAccountType: '', // Withdraw funds from single account
        withdrawalSuccessNote: false, // No additional action needed after a withdrawal by API
        supportTransferBetweenAccounts: false,
        supportCoinNetworks: true,
      };
    },

    /**
     * Get user balances
     * @param {Boolean} [nonzero=true] Return only non-zero balances
     * @returns {Promise<Array|undefined>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      let balances;

      try {
        balances = await nonkycApiClient.getBalances();
      } catch (error) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        let result = [];

        for (const crypto of balances) {
          result.push({
            code: crypto.asset.toUpperCase(),
            free: +crypto.available,
            freezed: +crypto.held + +crypto.pending,
            total: +crypto.available + +crypto.held + +crypto.pending,
          });
        }

        if (nonzero) {
          result = result.filter((crypto) => crypto.free || crypto.freezed);
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getBalances(${paramString}) request results: ${JSON.stringify(balances)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get one page of account open orders
     * @param {String} pair In classic format as BTC/USDT
     * @param {String} [limit=500]
     * @param {Number} [offset=0]
     * @returns {Promise<[]|undefined>}
     */
    async getOpenOrdersPage(pair, limit = 500, offset = 0) {
      const paramString = `pair: ${pair}, offset: ${offset}, limit: ${limit}`;
      const coinPair = formatPairName(pair);

      let orders;

      try {
        orders = await nonkycApiClient.getOrders(coinPair.pairPlain, limit, offset);
      } catch (error) {
        log.warn(`API request getOpenOrdersPage(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = [];

        for (const order of orders) {
          result.push({
            orderId: order.id.toString(),
            symbol: order.market.symbol, // In readable format as BTC/USDT
            price: +order.price,
            side: order.side, // 'buy' or 'sell'
            type: order.type, // 'limit' or 'market'
            timestamp: +order.createdAt, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            amount: +order.quantity,
            amountExecuted: +order.executedQuantity,
            amountLeft: +order.remainQuantity,
            status: orderStatusMap[order.status],
          });
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getOpenOrdersPage(${paramString}) request results: ${JSON.stringify(orders)}. ${error}`);
        return undefined;
      }
    },

    /**
     * List of all account open orders
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<[]|undefined>}
     */
    async getOpenOrders(pair) {
      let allOrders = [];
      let ordersInfo;
      let offset = 0;
      const limit = 500;

      do {
        ordersInfo = await this.getOpenOrdersPage(pair, limit, offset);
        if (!ordersInfo) return undefined;
        allOrders = allOrders.concat(ordersInfo);
        offset += limit;
      } while (ordersInfo.length === limit);

      return allOrders;
    },

    /**
     * Get specific order details
     * What's important is to understand the order was filled or closed by other reason
     * status: unknown, new, filled, part_filled, cancelled
     * @param {String} orderId Example: '655f28a1f6849a420b2e913d'
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let order;

      try {
        order = await nonkycApiClient.getOrder(orderId);
      } catch (error) {
        log.warn(`API request getOrderDetails(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.id) {
          const result = {
            orderId: order.id.toString(),
            tradesCount: undefined, // NonKYC doesn't provide trades info
            price: +order.price, // filled price for market orders
            side: order.side.toLowerCase(), // 'buy' or 'sell'
            type: order.type.toLowerCase(), // 'limit' or 'market'
            amount: +order.quantity, // In coin1
            volume: +order.quantity * +order.price, // In coin2
            pairPlain: coinPair.pairPlain,
            pairReadable: coinPair.pairReadable,
            totalFeeInCoin2: undefined, // NonKYC doesn't provide fee info
            amountExecuted: +order.executedQuantity, // In coin1
            volumeExecuted: +order.executedQuantity * +order.price, // In coin2
            timestamp: +order.createdAt, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            updateTimestamp: +order.updatedAt, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            status: orderStatusMap[order.status] ?? 'unknown',
          };

          return result;
        } else {
          const errorMessage = order.nonkycErrorInfo ?? 'No details.';
          log.log(`Unable to get order ${orderId} details: ${JSON.stringify(errorMessage)}. Returning unknown order status.`);

          return {
            orderId,
            status: 'unknown', // Order doesn't exist or Wrong orderId
          };
        }
      } catch (error) {
        log.warn(`Error while processing getOrderDetails(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Cancel an order
     * @param {String} orderId Example: '655f28a1f6849a420b2e913d'
     * @param {String} side Not used for NonKYC
     * @param {String} pair Not used for NonKYC. In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;

      let order;

      try {
        order = await nonkycApiClient.cancelOrder(orderId);
      } catch (error) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.success) {
          // Note: You can cancel already cancelled order
          log.log(`Cancelling order ${orderId} on ${pair} pair…`);
          return true;
        } else {
          const errorMessage = order?.nonkycErrorInfo ?? 'No details';
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
     * @param side Cancel buy or sell orders. Cancel both if not set.
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelAllOrders(pair, side) {
      const paramString = `pair: ${pair}, side: ${side}`;
      const coinPair = formatPairName(pair);

      let orders;

      try {
        orders = await nonkycApiClient.cancelAllOrders(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (orders.success) {
          log.log(`Cancelling ${orders.ids.length} orders on ${pair} pair…`);
          return true;
        } else {
          const errorMessage = orders?.nonkycErrorInfo ?? 'No details';
          log.log(`Unable to cancel orders on ${pair} pair: ${errorMessage}.`);
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
      const coinPair = formatPairName(pair);

      let ticker;

      try {
        ticker = await nonkycApiClient.ticker(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (ticker.ask && ticker.bid) {
          return {
            ask: +ticker.ask,
            bid: +ticker.bid,
            last: +ticker.last_price,
            volume: +ticker.base_volume,
            volumeInCoin2: +ticker.target_volume,
            high: +ticker.high,
            low: +ticker.low,
          };
        }
      } catch (error) {
        log.warn(`Error while processing getRates(${paramString}) request result: ${JSON.stringify(ticker)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Places an order
     * NonKYC supports both limit and market orders
     * @param {String} side 'buy' or 'sell'
     * @param {String} pair In classic format like BTC/USDT
     * @param {Number} price Order price
     * @param {Number} coin1Amount Base coin amount. Provide either coin1Amount or coin2Amount.
     * @param {Number} limit 1 if order is limit (default), 0 in case of market order
     * @param {Number} coin2Amount Quote coin amount. Provide either coin1Amount or coin2Amount.
     * @returns {Promise<Object>|undefined}
     */
    async placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `side: ${side}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

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
        coin1Amount = (+coin1Amount).toFixed(marketInfo.coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(marketInfo.coin2Decimals);
      }
      if (price) {
        price = (+price).toFixed(marketInfo.coin2Decimals);
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

      let orderType;
      let output = '';

      if (limit) {
        orderType = 'limit';
        if (coin2Amount) {
          output = `${side} ${coin1Amount} ${marketInfo.coin1} for ${coin2Amount} ${marketInfo.coin2} at ${price} ${marketInfo.coin2}.`;
        } else {
          output = `${side} ${coin1Amount} ${marketInfo.coin1} for ~${coin2AmountCalculated.toFixed(marketInfo.coin2Decimals)} ${marketInfo.coin2} at ${price} ${marketInfo.coin2}.`;
        }
      } else {
        orderType = 'market';
        if (coin2Amount) {
          output = `${side} ${marketInfo.coin1} for ${coin2Amount} ${marketInfo.coin2} at Market Price on ${pair} pair.`;
        } else {
          output = `${side} ${coin1Amount} ${marketInfo.coin1} at Market Price on ${pair} pair.`;
        }
      }

      const order = {};
      let response;
      let orderId;
      let errorMessage;

      try {
        response = await nonkycApiClient.addOrder(marketInfo.pairPlain, coin1Amount, price, side, orderType);

        errorMessage = response?.nonkycErrorInfo;
        orderId = response?.id;
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
     * Get orderbook on a specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let book;

      try {
        book = await nonkycApiClient.orderBook(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = {
          bids: [],
          asks: [],
        };

        for (const crypto of book.asks) {
          result.asks.push({
            amount: +crypto[1],
            price: +crypto[0],
            count: 1,
            type: 'ask-sell-right',
          });
        }
        result.asks.sort((a, b) => {
          return parseFloat(a.price) - parseFloat(b.price);
        });

        for (const crypto of book.bids) {
          result.bids.push({
            amount: +crypto[1],
            price: +crypto[0],
            count: 1,
            type: 'bid-buy-left',
          });
        }
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
      const coinPair = formatPairName(pair);

      let trades;

      try {
        trades = await nonkycApiClient.getTradesHistory(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = [];

        for (const trade of trades) {
          result.push({
            coin1Amount: +trade.base_volume, // amount in coin1
            price: +trade.price, // trade price
            coin2Amount: +trade.target_volume, // quote in coin2
            date: +trade.trade_timestamp, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            type: trade.type.toLowerCase(), // 'buy' or 'sell'
            tradeId: trade.trade_id.toString(),
          });
        }

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
     * Get deposit address for a coin
     * @param {String} coin As BTC
     * @returns {Promise<Array|undefined>}
     */
    async getDepositAddress(coin) {
      const paramString = `coin: ${coin}`;

      const currencyInfo = this.currencyInfo(coin);

      try {
        const result = [];

        for (const networkName in currencyInfo.networks) {
          const network = currencyInfo.networks[networkName];

          let data;

          let ticker = coin;
          if (network.chainName !== coin) {
            ticker = `${coin}-${network.chainName}`;
          }

          try {
            if (network.chainName.includes('BRIDGED')) {
              continue;
            } else {
              data = await nonkycApiClient.getDepositAddress(ticker);
            }
          } catch (error) {
            log.warn(`API request getDepositAddress(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
            return undefined;
          }

          try {
            if (!data.nonkycErrorInfo) {
              result.push({ network: formatNetworkName(data.network, ticker), address: data.address, memo: data.paymentid ? `paymentid: ${data.paymentid}` : '' });
            } else {
              const errorMessage = data.nonkycErrorInfo ?? 'No details.';
              log.log(`Unable to get ${coin} deposit address.  Details: ${JSON.stringify(errorMessage)}.`);

              return undefined;
            }
          } catch (error) {
            log.warn(`Error while processing getDepositAddress(${paramString}) request results: ${JSON.stringify(data)}. ${error}`);
            return undefined;
          }
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getDepositAddress(${paramString}) request ${error}`);
        return undefined;
      }
    },

    /**
     * Withdraw coin from NonKYC
     * @param {String} address Crypto address to withdraw funds to
     * @param {Number} amount Quantity to withdraw. Fee to be added, if provided.
     * @param {String} coin Unique symbol of the currency to withdraw from
     * @param {Number} withdrawalFee If to add withdrawal fee
     * @param {String} network
     * @return {Promise<Object>}
     */
    async withdraw(address, amount, coin, withdrawalFee, network) {
      const paramString = `address: ${address}, amount: ${amount}, coin: ${coin}, withdrawalFee: ${withdrawalFee}, network: ${network}`;
      let ticker = coin;
      if (network !== coin) {
        ticker = `${coin}-${network}`; // USDT-ARB20
      }

      // There is an issue withdrawing asset USDT-ARB20
      // Nonkyc processed a request to https://nonkyc.io/api/v2/createwithdrawal with data ticker=USDT-ARB20&quantity=0.0015&address=0x22137BbFfF376dD910d4040ed28E887bD6245151, but with error: 500 Internal Server Error, [No error code] No error message. Resolving…
      // Withdrawals of DASH work good

      let data;

      try {
        data = await nonkycApiClient.addWithdrawal(ticker, amount, address);
      } catch (error) {
        log.warn(`API request withdraw(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return {
          success: undefined,
          error: data?.nonkycErrorInfo ?? error,
        };
      }

      try {
        return {
          success: true,
          result: {
            id: data.id,
            currency: data.ticker,
            amount: +data.quantity,
            address: data.address,
            withdrawalFee: +data.fee,
            withdrawalFeeCurrency: +data.feecurrency,
            status: data.status.toUpperCase(),
            date: +data.sentat || +data.requestedat,
            target: null,
            network,
            payment_id: data.paymentid,
            note: null,
          },
        };
      } catch (error) {
        log.warn(`Error while processing withdraw(${paramString}) request result: ${JSON.stringify(data)}. ${error}`);
        return {
          success: false,
          error: data?.nonkycErrorInfo ?? error,
        };
      }
    },

    /**
     * Get withdrawal history
     * @param {String} coin Filter by coin, optional
     * @param {Number} limit Limit records, optional
     * @returns {Promise<{success: boolean, error: string}|{result: *[], success: boolean}>}
     */
    async getWithdrawalHistory(coin, limit) {
      return this.processHistoryRecords('getWithdrawalHistory', coin, limit, true);
    },

    /**
     * Get deposit history
     * @param {String} coin Filter by coin, optional
     * @param {Number} limit Limit records, optional
     * @returns {Promise<{success: boolean, error: string}|{result: *[], success: boolean}>}
     */
    async getDepositHistory(coin, limit) {
      return this.processHistoryRecords('getDepositHistory', coin, limit, false);
    },

    // Shared function to process history records
    async processHistoryRecords(apiMethod, coin, limit, isWithdrawal) {
      const paramString = `coin: ${coin}, limit: ${limit}`;

      let records;

      try {
        records = await nonkycApiClient[apiMethod](coin, limit);
      } catch (error) {
        log.warn(`API request ${apiMethod}(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return {
          success: false,
          error,
        };
      }

      try {
        const result = [];

        for (const record of records) {
          let networkPlain = record.childticker?.split('-')[1];
          if (networkPlain === 'MAIN') {
            networkPlain = record.ticker;
          }

          const commonFields = {
            id: record.id,
            currencySymbol: record.ticker,
            quantity: +record.quantity,
            cryptoAddress: record.address,
            txId: record.transactionid,
            status: record.status,
            chain: networkPlain, // TODO: ARB20 -> ARBITRUM
            chainPlain: networkPlain,
          };

          if (isWithdrawal) {
            result.push({
              ...commonFields,
              confirmations: null,
              createdAt: +record.requestedat,
              updatedAt: +record.sentat,
              fee: +record.fee,
              target: null,
              source: null,
            });
          } else {
            result.push({
              ...commonFields,
              confirmations: +record.confirmations,
              createdAt: +record.firstseenat,
              updatedAt: (record.isposted || record.isreversed || +record.confirmations) ? +record.firstseenat : null,
              fee: null,
              target: null,
              source: null,
            });
          }
        }

        return {
          success: true,
          result,
        };
      } catch (error) {
        log.warn(`Error while processing ${apiMethod}(${paramString}) request result: ${JSON.stringify(records)}. ${error}`);
        return {
          success: false,
          error,
        };
      }
    },
  };
};

/**
 * Returns network name in classic format
 * Keys in networksNameMap should be in upper case even if exchanger format in lower case
 * @param {String} network
 * @returns {String}
 */
function formatNetworkName(network, ticker) {
  const networksNameMap = {
    'Ethereum Main Chain (ETH)': _networks['ERC20'].code,
    'Ethereum Main Chain': _networks['ERC20'].code,
    'Binance Smart Chain (BSC)': _networks['BEP20'].code,
    'Binance Smart Chain': _networks['BEP20'].code,
    'Tron Network (TRC20)': _networks['TRC20'].code,
    'Polygon Main Chain (MATIC)': _networks['MATIC'].code,
    'Polygon Main Chain': _networks['MATIC'].code,
    'Arbitrum One Mainnet': _networks['ARBITRUM'].code,
    'Bitcoin Main Chain': _networks['BTC'].code,
  };

  return networksNameMap[network] || ticker || network;
}

/**
 * Returns pair in NonKYC format like 'BTC_USDT'
 * @param pair Pair in any format
 * @returns {Object|Boolean} pairReadable, pairPlain, coin1, coin2
*/
function formatPairName(pair) {
  if (pair.indexOf('/') > -1) {
    pair = pair.replace('/', '_').toUpperCase();
  } else if (pair.indexOf('-') !== -1) {
    pair = pair.replace('-', '_').toUpperCase();
  }
  const [coin1, coin2] = pair.split('_');
  return {
    coin1: coin1.toUpperCase(),
    coin2: coin2.toUpperCase(),
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: pair,
  };
}
