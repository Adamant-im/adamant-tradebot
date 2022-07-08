ADAMANT Trading & Market making bot is a software that allows to run trades on crypto exchanges, make trade volume, maintain spread and liquidity, set price range, and build live-like dynamic order book.

This is a free version. For premium features, see [marketmaking.app/services](https://marketmaking.app/services/).

# Market making

In Market making mode, the bot places orders and executes them by itself, making a trade volume, maintaining spread and liquidity; builds live-like dynamic order books and watches a token price. Market making helps:

* Cryptocurrency projects (token issuers)
* Cryptocurrency exchanges

See [marketmaking.app](https://marketmaking.app) to have a look at the bot possibilities.

![Trading chart](./assets/Making-chart.png)

![Market Making & OrderBook Building](./assets/OrderBook-Builder.gif)

# Profit trading

Trading is a mode when a bot runs orders according to some strategy. It can be profitable or not. This feature is unavailable now—we recommend to use [Zenbot](https://github.com/DeviaVir/zenbot) instead.

# Features

* Easy to install and configure
* Initial fill order books
* Dynamic order book building
* Place buy and sell limit or market orders
* Market making with 3 policies: spread, orderbook, optimal
* Spread & liquidity maintenance
* Price range setting
* Arbitrage token price on other trade pairs or exchanges
* Managed with your commands using ADAMANT Messenger

# Supported exchanges

* [CoinDeal](https://coindeal.com)
* [Resfinex](https://resfinex.com)
* [P2PB2B](https://p2pb2b.com)

To add other exchange support, see [marketmaking.app/services](https://marketmaking.app/services/).

# Usage and Installation

After installation, you control the bot in secure ADAMANT Messenger chat directly.

Available commands: ask a bot with `/help` command. Read more how to install and use the bot: [marketmaking.app/guides](https://marketmaking.app/guides/).

We can run market-making for you, see [marketmaking.app/services](https://marketmaking.app/services/).

## Requirements

* Ubuntu 18–22, centOS 7 or 8 (we didn't test others)
* NodeJS v16+
* MongoDB ([installation instructions](https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/))

## Setup

```
su - adamant
git clone https://github.com/Adamant-im/adamant-tradebot
cd ./adamant-tradebot
npm i
```

## Pre-launch tuning

The bot will use `config.json`, if available, or `config.default.json` otherwise.

```
cp config.default.json config.json
nano config.json
```

Parameters: see comments in `config.json`.

## Launching

You can start the Bot with the `node app` command, but it is recommended to use the process manager for this purpose.

```
pm2 start --name tradebot app.js
```

## Add a Bot to cron

```
crontab -e
```

Add string:

```
@reboot cd /home/adamant/adamant-tradebot && pm2 start --name tradebot app.js
```

## Updating

```
su - adamant
cd ./adamant-tradebot
pm2 stop tradebot
git pull
npm i
```

Update `config.json` if `config.default.json` changed.

Then `pm2 restart tradebot`.
