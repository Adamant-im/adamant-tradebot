ADAMANT Trading & Market making bot is a software that allows to run trades on crypto exchanges, make trade volume, maintain spread and liquidity, set price range, and build live-like dynamic order book.

This is a free version. For premium features, see [marketmaking.app/mm-services](https://marketmaking.app/mm-services/).

# Market making

In Market-making mode, the bot places orders and executes them by itself, making a trading volume, maintaining spread and liquidity; builds live-like dynamic order books, and watches a token price. Market making helps:

* Cryptocurrency projects (token issuers)
* Cryptocurrency exchanges

See [marketmaking.app](https://marketmaking.app) to look at the bot possibilities.

![Trading chart](./assets/Making-chart.png)

![Market Making & OrderBook Building](./assets/OrderBook-Builder.gif)

# Profit trading

Profit trading is a mode in which a bot runs orders according to some strategy. For Profit trading, see other software—[CoinOptimus](https://github.com/Adamant-im/adamant-coinoptimus).

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

For premium features, see [marketmaking.app/mm-services](https://marketmaking.app/mm-services/).

* High-frequency order books
* Watch order books and eliminate gaps
* Anti-cheat cleans price manipulation orders
* 2-keys trading
* Running commands for the second trade account
* Fund balancer for 2-keys trading
* Fund supplier for multi-pair trading on one exchange using one account
* Liquidity/depth set up to support spread and place main volume further from current price
* Support price to maintain by any means
* Setting manual price trends and target
* Automatic volatility life-like chart
* In-orderbook market-making without in-spread trading
* Maintaining a small spread and consistent chart with in-orderbook market-making
* Volume volatility: more volume on pumps and dumps
* Stores and displays statistics
* Account info: fees and daily volume
* Quote hunter to replenish quote coin balance
* Withdrawals
* Show deposits, withdrawals, coin network information
* Transfer funds between account types (main, trade, margin)
* Cross-bot communication to run commands remotely across all the bots at once
* Command aliases
* High-frequency order book updates
* Price maker & Price watcher, including depth policy
* Balance equalizer: Ensures coin1 (base) and coin2 (quote) balances are near equal in USD value
* TWAP orders
* Socket support for exchange connections
* Socket-pull support as a preferred to socket-subscribe model

# Supported exchanges

* [P2PB2B](https://p2pb2b.com)
* [Azbit](https://azbit.com?referralCode=9YVWYAF)
* [StakeCube](https://stakecube.net/?team=adm)
* [Coinstore](https://h5.coinstore.com/h5/signup?invitCode=o951vZ)
* [FameEX](https://www.fameex.com/en-US/commissiondispense?code=MKKAWV)
* [NonKYC](https://nonkyc.io?ref=655b4df9eb13acde84677358)
* [XeggeX](https://xeggex.com?ref=656846d209bbed85b91aba4d)

To add other exchange support, see [marketmaking.app/mm-services](https://marketmaking.app/mm-services/).

# Usage and Installation

After installation, you control the bot in secure ADAMANT Messenger chat directly. It's self-hosted.

[Installation and usage guide](https://marketmaking.app/cex-mm/installation/).

[Command reference](https://marketmaking.app/cex-mm/command-reference/).

## Requirements

* Ubuntu 20+, centOS 8+ (we didn't test others)
* NodeJS v18+
* MongoDB ([installation instructions](https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/))

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

You can start the Bot with the `node app` command, but it is recommended to use the process manager for this purpose.

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

Update `config.jsonc` if `config.default.jsonc` changed.

Then `pm2 restart tradebot`.
