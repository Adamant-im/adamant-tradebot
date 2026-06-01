ADAMANT’s market-making bot is software that enables trading on cryptocurrency exchanges. It helps generate trading volume, maintain spread and liquidity, set price ranges, and build a live-like dynamic order book.

This is the free version — suitable for small crypto projects with low liquidity, traded on centralized exchanges from the open list.

For premium features, see [https://marketmaking.app/cex-mm/mm-features](https://marketmaking.app/cex-mm/mm-features/).

# Market-making bot

In Market-making mode, the bot automatically places and executes orders to generate trading volume, maintain spread and liquidity, build live-like dynamic order books, and track token prices. Market making is useful for:

* Cryptocurrency projects (token issuers)
* Cryptocurrency exchanges

See [marketmaking.app](https://marketmaking.app) to explore the bot’s full list of features.

![Trading chart](./assets/Making-chart.png)

![Market Making & OrderBook Building](./assets/OrderBook-Builder.gif)

# Profit trading

Profit Trading is a mode where the bot executes orders based on a chosen strategy. For profit-trading functionality, see our other software—[CoinOptimus](https://github.com/Adamant-im/adamant-coinoptimus).

# Features

* Easy to install and configure
* Initial fill order books
* Dynamic order book building
* Place buy and sell limit or market orders
* Market making with 4 policies: spread, orderbook, optimal, and depth
* Spread & liquidity/depth maintenance
* Price range setting
* Arbitrage token price on other trade pairs or exchanges
* Managed with your commands using ADAMANT Messenger

## Premium features

For premium features, see [https://marketmaking.app/cex-mm/mm-features](https://marketmaking.app/cex-mm/mm-features/).

# Supported exchanges

In the free version, the bot supports the following exchanges out of the box:

* [P2PB2B](https://p2pb2b.com)
* [Azbit](https://azbit.com?referralCode=9YVWYAF)
* [StakeCube](https://stakecube.net/?team=adm)
* [Coinstore](https://h5.coinstore.com/h5/signup?invitCode=o951vZ)
* [FameEX](https://www.fameex.com/en-US/commissiondispense?code=MKKAWV)
* [NonKYC](https://nonkyc.io?ref=655b4df9eb13acde84677358)
* More exchanges available in the premium version

To add support for other exchanges, see [https://marketmaking.app/cex-mm/mm-features/#add-more-exchanges](https://marketmaking.app/cex-mm/mm-features/#add-more-exchanges).

# Usage and Installation

After installation, you control the bot directly via a secure ADAMANT Messenger chat. The bot is fully self-hosted.

[Installation and usage guide](https://marketmaking.app/cex-mm/installation/).

[Command reference](https://marketmaking.app/cex-mm/command-reference/).

## Requirements

* Ubuntu 20+, centOS 8+ (we didn't test others)
* NodeJS v18+
* MongoDB ([installation instructions](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/))

## Setup

```
su - adamant
git clone https://github.com/Adamant-im/adamant-tradebot
cd ./adamant-tradebot
npm i
```

## Pre-launch tuning

The bot will use `config.jsonc` if available, or `config.default.jsonc` otherwise.

```
cp config.default.jsonc config.jsonc
nano config.jsonc
```

Parameters: see comments in `config.jsonc`.

## Launching

You can start the bot with the `node app` command, but it is recommended to run it under a process manager:

```
pm2 start app.js --name tradebot
```

Remember to add tradebot to `pm2 startup` or cron.

## Updating

```
su - adamant
cd ./adamant-tradebot
pm2 stop tradebot
git pull
npm i
```

Revise `config.jsonc` if `config.default.jsonc` changed.

Then `pm2 restart tradebot`.
