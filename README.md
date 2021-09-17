ADAMANT Trading & Market making bot is a software that allows to run trades on crypto exchanges, make trade volume, maintain spread and liquidity, set price range, and build live-like dynamic order book.

# Market making

In Market making mode, the bot places orders and execute them by himself, making a trade volume, maintaining spread and liquidity; and builds live-like dynamic order book. Market making helps:

* Cryptocurrency projects (token issuers)
* Cryptocurrency exchanges

See [marketmaking.app](https://marketmaking.app) to have a look at the bot possibilities.

![Trading chart](./assets/Making-chart.png)

![Market Making & OrderBook Building](./assets/OrderBook-Builder.gif)

# Profit trading

Trading is a mode when bot run orders according to some strategy. It can be profitable or not. This feature is unavailable now—we recommend to use [Zenbot](https://github.com/DeviaVir/zenbot) instead.

# Features

* Easy to install and configure
* Free and open source
* Fill order books
* Place buy and sell limit or market orders
* Market making
* Dynamic order book building
* Spread & liquidity maintenance
* Price range setting
* Arbitrage token price on other trade pairs or exchanges
* Stores and displays statistics
* Managed with your commands using ADAMANT Messenger

# Supported exchanges

If the bot don't support the exchange you need, code it by yourself, or [hire developers](https://marketmaking.app/services/).

* [Bit-Z](https://u.bit-z.com/register?invite_code=2423317)
* [CoinDeal](https://coindeal.com/ref/9WZN)
* [Resfinex](https://trade.resfinex.com?ref=7ccb34d867&pair=ADM_USDT)

# Usage and Installation

After installation, you control the bot in secure ADAMANT Messenger chat directly.

Available commands: ask a bot with `/help` command. Read more how to install and use the bot: [marketmaking.app/guides](https://marketmaking.app/guides/).

We can run market-making for you, see [marketmaking.app/services](https://marketmaking.app/services/).

## Requirements

* Ubuntu 16, 18 or 20 (we didn't test others)
* NodeJS v 10+
* MongoDB ([installation instructions](https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/))

## Setup

```
su - adamant
git clone https://github.com/Adamant-im/adamant-tradebot
cd ./adamant-tradebot
npm i
```

## Pre-launch tuning

```
nano config.json
```

Parameters: see comments in `config.json`.

## Launching

You can start the Bot with the `node app` command, but it is recommended to use the process manager for this purpose.

```
pm2 start --name tradebot app.js
```

## Add Bot to cron

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
mv config.json config_bup.json && git pull && mv config_bup.json config.json
npm i
pm2 start --name tradebot app.js
```
