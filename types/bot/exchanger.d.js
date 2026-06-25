'use strict';

/**
 * Type definitions for `helpers/cryptos/exchanger.js`.
 *
 * @module types/bot/exchanger.d
 */

/**
 * Map of currency pair tickers to prices from the Infoservice API.
 * Keys use the `BASE/QUOTE` form, e.g. `ADM/USDT`, `BTC/USD`.
 *
 * @typedef {Record<string, number>} CryptoRatesMap
 */

/**
 * Result of `convertCryptos()`.
 *
 * @typedef {Object} ConvertCryptosResult
 * @property {number} outAmount Converted amount in the target currency, or `NaN` on failure
 * @property {number} exchangePrice Exchange rate used for the conversion, or `NaN` on failure
 */

/**
 * Parsed trading-pair descriptor returned by `parsePair()`.
 *
 * @typedef {Object} ParsedPairInfo
 * @property {string} pair Normalized pair fragment, e.g. `ADM/USDT`
 * @property {string} [baseCoin] Base currency symbol
 * @property {string} [quoteCoin] Quote currency symbol
 * @property {string} [exchange] Exchange name when present in the input, e.g. `Bittrex`
 * @property {string} [account] Account suffix when present, e.g. `acc1`
 * @property {string} [project] Project label when present, e.g. `TradeBot`
 */

/**
 * Estimated amount of `coin1` expressed in several reference currencies.
 *
 * @typedef {Object} Coin1VolumeEstimate
 * @property {number} coin1 Amount in the configured base coin
 * @property {number} coin2 Equivalent in the configured quote coin
 * @property {number} USD Equivalent in USD
 * @property {number} USDT Equivalent in USDT
 * @property {number} BTC Equivalent in BTC
 */

/**
 * Public export of `helpers/cryptos/exchanger.js`.
 *
 * @typedef {Object} ExchangerModule
 * @property {CryptoRatesMap | undefined} currencies Latest Infoservice rates cache
 * @property {Record<string, unknown>} markets Exchange-specific market metadata attached at runtime
 * @property {() => Promise<void>} updateCryptoRates Refreshes `currencies` from Infoservice
 * @property {(from: string, to: string) => number | undefined} getRate Returns the price of `from` in `to`
 * @property {(from: string, to: string, amount?: number, considerExchangerFee?: boolean, specificRate?: number, validateSpecificRate?: boolean) => ConvertCryptosResult} convertCryptos Converts between cryptocurrencies
 * @property {(coin: string) => boolean} isFiat Whether the symbol is treated as fiat
 * @property {(coin: string) => boolean} hasTicker Whether Infoservice exposes a direct ticker for the coin
 * @property {(coin: string) => boolean} [isERC20] Attached at runtime by crypto modules for ERC-20 fee conversion
 * @property {(pair: string) => ParsedPairInfo} parsePair Parses pair/exchange/account/project from a string
 * @property {(maxAmount?: number) => Coin1VolumeEstimate | undefined} estimateCurrentDailyTradeVolume Estimates daily MM volume from trade params
 * @property {(coin1Amount: number) => Coin1VolumeEstimate | undefined} calcCoin1AmountInOtherCoins Converts a coin1 amount into several currencies
 * @property {(dailyVolumeCoin1: number) => number | undefined} calcMaxAmountFromDailyTradeVolume Derives `mm_maxAmount` from a target daily volume
 * @property {(oldVolume: Coin1VolumeEstimate, newVolume: Coin1VolumeEstimate) => string | undefined} getVolumeChangeInfoString Human-readable volume change string
 * @property {(volume: Coin1VolumeEstimate) => string | undefined} getVolumeInfoString Human-readable volume string for one estimate
 */

module.exports = {};
