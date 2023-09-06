const FameEXApi = require('./api/fameex_api');
const utils = require('../helpers/utils');
const networks = require('../helpers/cryptos/networks');

/**
 * API endpoints:
 * https://api.fameex.com
 */
const apiServer = 'https://api.fameex.com';
const exchangeName = 'FameEX';

const orderStates = {
  new: [1, 2],
  partiallyFilled: 3,
  filled: 4,
  cancelled: [5, 6],
  uncompleted: 7,
  completedOrCancelled: 9,
};

const orderStatuses = {
  new: 'new',
  partFilled: 'part_filled',
  filled: 'filled',
  cancelled: 'cancelled',
  unknown: 'unknown',
};

const orderTypes = [1, 2, 3, 4, 5];

const orderTypesMap = {
  1: 'limit',
  2: 'market',
  3: 'take_profit_and_stop_loss',
  4: 'tracking_order',
  5: 'maker_only',
};

const orderSides = {
  buy: 1,
  sell: 2,
};

const systemToFameExOrderTypesMap = {
  0: 2,
  1: 1,
};

const orderMaxPageSize = 500;

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

              const networksByCurrency = currenciesWithNetworks.data.list.reduce((acc, data) => {
                const currencyNetworks = Object.keys(data.currencyDetail).map(formatNetworkName);

                return acc.set(data.currency.toUpperCase(), currencyNetworks);
              }, new Map());

              for (const coin in currencies) {
                // Returned data is not full and doesn't include decimals, precision, min amounts, etc
                const currency = currencies[coin];

                result[currency.name.toUpperCase()] = {
                  symbol: currency.name.toUpperCase(),
                  name: currency.name.toUpperCase(),
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
                  networks: networksByCurrency.get(currency.name.toUpperCase()),
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
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairReadable : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      fameEXApiClient.markets().then((markets) => {
        try {
          const result = markets.data.reduce((acc, market) => {
            const pair = formatPairName(market.pair);

            acc[pair.pairReadable] = {
              pairReadable: pair.pairReadable,
              pairPlain: pair.pairPlain,
              coin1: pair.coin1,
              coin2: pair.coin2,
              coin1Decimals: market.amountPrecision,
              coin2Decimals: market.pricePrecision,
              coin1Precision: utils.getPrecision(market.amountPrecision),
              coin2Precision: utils.getPrecision(market.pricePrecision),
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: null,
            };

            return acc;
          }, {});

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

    // TODO: test allowAmountForMarketBuy & amountForMarketOrderNecessary
    /**
     * Features available on FameEx exchange
     * @returns {Object}
     */
    features() {
      return {
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

      const spotWallet = balances.data.filter((wallet) => wallet.walletType === 'spot')[0].list;

      try {
        const result = spotWallet.map((crypto) => ({
          code: crypto.currency.toUpperCase(),
          free: +crypto.available,
          freezed: +crypto.hold,
          total: +crypto.total,
        }));

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
     * !POSSIBLE IMPLEMENTATION ERRORS!
     * !At the moment it is impossible to implement this functional correctly, due to problems on the FameEX side
     * @param {Object} pair Formatted coin pair
     * @param {Number} pageNum Pagination, the first few pages (1 <= pageNum)
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrdersPage(pair, pageNum = 1) {
      const paramString = `pair: ${pair.pairReadable}`;

      let ordersData;

      try {
        ordersData = await Promise.all([
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.buy,
              orderTypes,
              orderStates.uncompleted,
              pageNum,
              orderMaxPageSize,
          ),
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.sell,
              orderTypes,
              orderStates.uncompleted,
              pageNum,
              orderMaxPageSize,
          ),
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.buy,
              orderTypes,
              orderStates.completedOrCancelled,
              pageNum,
              orderMaxPageSize,
          ),
          fameEXApiClient.getOrders(
              pair.coin1,
              pair.coin2,
              orderSides.sell,
              orderTypes,
              orderStates.completedOrCancelled,
              pageNum,
              orderMaxPageSize,
          ),
        ]);
      } catch (error) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      const [
        uncompletedOrdersBuy,
        uncompletedOrdersSell,
        completedOrCancelledOrdersBuy,
        completedOrCancelledOrdersSell,
      ] = ordersData;

      const orders = [
        ...uncompletedOrdersBuy.data.orders,
        ...uncompletedOrdersSell.data.orders,
        ...completedOrCancelledOrdersBuy.data.orders,
        ...completedOrCancelledOrdersSell.data.orders,
      ];

      try {
        const result = await Promise.all(orders.map(async (order) => {
          const transactionDetails = (await fameEXApiClient.getTransactionDetails(
              pair.coin1,
              pair.coin2,
              1,
              1,
              order.orderId,
          )).data.trades?.[0];

          return {
            orderId: order.orderId,
            symbol: pair.pairReadable,
            symbolPlain: pair.pairPlain,
            price: +transactionDetails.price,
            side: order.side === orderSides.buy ? 'buy' : 'sell',
            type: formatOrderType(order.orderType),
            timestamp: order.createTime,
            amount: +order.money,
            amountExecuted: +order.filledAmount,
            amountLeft: +order.filledAmount - +order.money,
            status: formatOrderStatus(order.state),
          };
        }));

        return result;
      } catch (error) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request results: ${JSON.stringify(ordersData)}. ${error}`);
        return undefined;
      }
    },

    /**
     * List of all account open orders
     * !POSSIBLE IMPLEMENTATION ERRORS!
     * !At the moment it is impossible to implement this functional correctly, due to problems on the FameEX side
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrders(pair) {
      const allOrders = [];
      const coinPair = formatPairName(pair);

      let pageNum = 1;

      const limit = (await fameEXApiClient.getTransactionDetails(
          coinPair.coin1,
          coinPair.coin2,
          pageNum,
          1,
      )).data.total;

      do {
        const ordersInfo = await this.getOpenOrdersPage(coinPair, pageNum);

        if (!ordersInfo) return undefined;

        allOrders.push(...ordersInfo);

        pageNum += 1;
      } while (allOrders.length < limit);

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
      const coinPair = formatPairName(pair);

      let order;

      try {
        order = await fameEXApiClient.getOrderDetails(coinPair.pairDash, orderId);
      } catch (error) {
        log.warn(`API request getOrderDetails(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const transactionDetails = (await fameEXApiClient.getTransactionDetails(
            coinPair.coin1,
            coinPair.coin2,
            1,
            1,
            orderId,
        )).data.trades?.[0];

        return {
          orderId: order.data.orderId,
          tradesCount: undefined, // FameEX doesn't provide trades
          price: +transactionDetails.price,
          side: order.data.side === orderSides.buy ? 'buy' : 'sell',
          type: formatOrderType(order.data.orderType),
          amount: +order.data.money,
          volume: +order.data.money * +order.data.triggerPrice,
          pairPlain: coinPair.pairPlain,
          pairReadable: coinPair.pairReadable,
          totalFeeInCoin2: +order.data.filledFee,
          amountExecuted: +order.data.filledAmount,
          volumeExecuted: +order.data.filledMoney,
          timestamp: order.data.createTime,
          updateTimestamp: order.data.updateTime,
          status: formatOrderStatus(order.data.state),
        };
      } catch (error) {
        log.warn(`Error while processing getOrderDetails(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Places an order
     * FameEX supports both limit and market orders
     * Market Buy is only possible with quote coin amount specified
     * Market Sell is only possible with base coin amount specified
     * Limit Buy/Sell is only possible with base coin amount specified
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

      const coinPair = formatPairName(pair);

      const marketInfo = this.marketInfo(pair);

      let message;

      if (!marketInfo) {
        message = `Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (!limit && side === 'buy' && !coin2Amount) {
        message = `Unable to place an order on ${exchangeName} exchange at Market buy. Quote amount ${marketInfo.coin2} is not provided.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (!limit && side === 'sell' && !coin1Amount) {
        message = `Unable to place an order on ${exchangeName} exchange at Market sell. Base amount ${marketInfo.coin1} is not provided.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (limit && !coin1Amount) {
        message = `Unable to place an order on ${exchangeName} exchange at Limit ${side}. Base amount ${marketInfo.coin1} is not provided.`;
        log.warn(message);
        return {
          message,
        };
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

      if ((limit || !limit && side === 'sell') && coin1Amount < marketInfo.coin1MinAmount) {
        coin1Amount = coin1Amount ? coin1Amount : 0;
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${pair} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      let output = '';

      if (limit) {
        if (coin2Amount) {
          output = `${side} ${coin1Amount} ${coinPair.coin1} for ${coin2Amount} ${coinPair.coin2} at ${price} ${coinPair.coin2}.`;
        } else {
          output = `${side} ${coin1Amount} ${coinPair.coin1} at ${price} ${coinPair.coin2}.`;
        }
      } else {
        output = `${side} ${coinPair.coin1} for ${coin1Amount} ${coinPair.coin2} at Market Price on ${pair} pair.`;
      }

      const order = {};
      let orderId;
      let errorMessage;

      try {
        const orderData = await fameEXApiClient.addOrder(
            coinPair.pairDash,
            orderSides[side],
            systemToFameExOrderTypesMap[limit],
            coin1Amount || coin2Amount,
            String(price),
        );

        errorMessage = orderData?.msg;
        orderId = orderData?.data?.orderId;
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
  };
};
/**
 * Returns network name in classic format
 * @param {String} network
 * @return {String}
 */
function formatNetworkName(network) {
  return networks[network?.toUpperCase()]?.code ?? network;
}

/**
 * Returns pair in classic format BTC/USDT
 * @param {String} pair Pair in FameEX format BTC_USDT or BTC-USDT or BTC/USDT
 * @return {Object}
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();
  const [coin1, coin2] = pair.split(/[\-\_\/]/);

  return {
    pair: `${coin1}/${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}_${coin2}`,
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
  if (orderStates.new.includes(orderState)) {
    return orderStatuses.new;
  }
  if (orderState === orderStates.partiallyFilled) {
    return orderStatuses.partFilled;
  }
  if (orderState === orderStates.filled) {
    return orderStatuses.filled;
  }
  if (orderStates.cancelled.includes(orderState)) {
    return orderStatuses.cancelled;
  }

  return orderStatuses.unknown;
}

/**
 * Returns system order type
 * @param {Number} orderType Order type in FameEX format
 * @return {string}
 */
function formatOrderType(orderType) {
  return orderTypesMap[orderType] || 'unknown';
}
