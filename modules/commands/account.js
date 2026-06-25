'use strict';

/**
 * @module modules/commands/account
 * @typedef {import('types/assets.d').ResultWithTimestamp} AssetsResultWithTimestamp
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/bot/balancesHistory.d.js').BalanceTotalsScope} BalanceTotalsScope
 * @typedef {import('types/bot/general.d').CommandReply} CommandReply
 * @typedef {import('types/bot/commandTxs.d.js').CommandTx} CommandTx
 */

const {
  constants, config, log, traderapi, traderapi2, perpetualApi, orderUtils,
  balancesHistory, moduleName, utils, previousBalances, TraderApi,
} = require('./context');
const { formSendBackMessage } = require('./helpers');

/**
 * Fetches deposit addresses for one trade account and formats a user-facing string.
 *
 * @param {string} coin1 Coin symbol to query, e.g. `USDT`
 * @param {number} [accountNo=0] `0` = first trade account, `1` = second
 * @param {CommandTx} [tx] Initiator transaction (reserved for future per-user filtering)
 * @returns {Promise<string>} Deposit address block or an error message
 */
async function getDepositInfo(coin1, accountNo = 0, tx) {
  let output = '';

  try {
    const api = accountNo === 0 ? traderapi : traderapi2;
    const depositAddresses = await api.getDepositAddress(coin1);

    if (depositAddresses?.length) {
      output = `The deposit addresses for ${coin1} on ${config.exchangeName}:\n${depositAddresses.map(({ network, address, memo }) => `${network ? `_${network}_: ` : ''}${address}${memo ? `, ${memo}` : ''}`).join('\n')}`;
    } else {
      output = `Unable to get deposit addresses for ${coin1}.`;

      if (depositAddresses?.message) {
        output += ` Error: ${depositAddresses?.message}.`;
      } else if (api.features().createDepositAddressWithWebsiteOnly) {
        output += ` Note: ${config.exchangeName} does not create new deposit addresses via API. Create one manually on the exchange website.`;
      }
    }
  } catch (e) {
    log.error(`commandTxs: Error in getDepositInfo() of ${moduleName} module: ` + e);
  }

  return output;
}


/**
 * Shows deposit addresses for a coin on one or both trade accounts.
 *
 * Format: `/deposit {coin}`
 *
 * @param {string[]} params Command parameters (`[coin]`)
 * @param {CommandTx} [tx] Initiator transaction
 * @returns {Promise<CommandReply>}
 */
async function deposit(params, tx) {
  let output = '';

  try {
    if (!params[0] || params[0].indexOf('/') !== -1) {
      output = 'Please specify a coin to get a deposit address, e.g., */deposit ADM*.';
      return {
        msgNotify: '',
        msgSendBack: `${output}`,
        notifyType: 'log',
      };
    }

    if (!traderapi.features().getDepositAddress) {
      return {
        msgNotify: '',
        msgSendBack: 'The exchange doesn\'t support receiving a deposit address.',
        notifyType: 'log',
      };
    }

    const coin1 = params[0].toUpperCase();
    const account0DepositInfo = await getDepositInfo(coin1, 0, tx);
    const account1DepositInfo = traderapi2 ? await getDepositInfo(coin1, 1, tx) : undefined;
    output = account1DepositInfo ?
      account0DepositInfo.replace(`on ${config.exchangeName}`, `on ${config.exchangeName} (account 1)`) +
      '\n\n\n' + account1DepositInfo.replace(`on ${config.exchangeName}`, `on ${config.exchangeName} (account 2)`) :
      account0DepositInfo;
  } catch (e) {
    log.error(`commandTxs: Error in deposit() of ${moduleName} module: ` + e);
  }

  return {
    msgNotify: '',
    msgSendBack: output,
    notifyType: 'log',
  };
}


/**
 * Creates formatted balance string, e.g, '16.94315519 USDT (1.94315519 available & 15 frozen)'
 * Ends with a single newline \n
 * Filters coins by scope
 * Returns excluded coins AND a mutated `balances` object without excluded ones.
 *
 * @param {AssetsResult} balances Original balances array from exchange API
 * @param {string} [accountType] Optional account/wallet type, e.g., `main`, `futures`, or `full`
 * @param {'pair'|'priority'|'allcoins'} [scope='allcoins']
 *   - 'pair'     → include only coin1 + coin2
 *   - 'priority' → include coin1 + coin2 + constants.COINS_BY_PRIORITY
 *   - 'allcoins'      → include all coins
 * @return {{
 *   output: string,
 *   excludedCount: number,
 *   excluded: AssetsResult,
 *   balancesMutated: AssetsResult
 * }}
 */
function composeBalancesString(balances, accountType, scope = 'allcoins') {
  try {
    const { coin1, coin2 } = config;

    // Priority list
    const priorityCoins = [
      coin1,
      coin2,
      ...constants.COINS_BY_PRIORITY,
    ]
        .filter(Boolean)
        .filter((c, i, arr) => arr.indexOf(c) === i);

    const indexMap = new Map(priorityCoins.map((c, i) => [c, i]));

    // Prepare result arrays
    const excluded = [];
    const balancesMutated = [];

    // Decide allowed coins for filtering
    let allowed;
    if (scope === 'pair') {
      allowed = new Set([coin1, coin2].filter(Boolean));
    } else if (scope === 'priority') {
      allowed = new Set(priorityCoins);
    } else {
      allowed = null; // all allowed
    }

    // Build mutated balances array (without excluded)
    balances.forEach((b) => {
      if (allowed && !allowed.has(b.code)) {
        excluded.push(b);
      } else {
        balancesMutated.push(b);
      }
    });

    // Sort mutated balances
    const sorted = [...balancesMutated].sort((a, b) => {
      const aIndex = indexMap.has(a.code) ? indexMap.get(a.code) : Infinity;
      const bIndex = indexMap.has(b.code) ? indexMap.get(b.code) : Infinity;
      return aIndex - bIndex;
    });

    // Compose output string
    let output = '';
    sorted.forEach((crypto) => {
      const accountTypeString = accountType ? `[${crypto.accountType}] ` : '';
      output += `${accountTypeString}${utils.formCoinBalancesString(crypto, true)}\n`;
    });

    return {
      output,
      excludedCount: excluded.length,
      excluded,
      balancesMutated,
    };
  } catch (e) {
    log.error(`commandTxs: Error in composeBalancesString() of ${moduleName} module: ${e}`);
  }
}


/**
 * Creates a balance information string for a specific account.
 * May provide cached information with no additional requests.
 * Includes the balance difference from the previous request (available only for the default trading account/wallet).
 *
 * @param {number} accountNo `0` for the first account, `1` for the second
 * @param {string} userId `senderId` (or WebUI user ID). The bot stores previous balances *per user* to show balance changes since the last request.
 * @param {'pair'|'priority'|'allcoins'} [scope='allcoins']
 *   - 'pair'     → include only coin1 + coin2
 *   - 'priority' → include coin1 + coin2 + constants.COINS_BY_PRIORITY
 *   - 'allcoins'      → include all coins
 * @param {string} [accountType] Account/wallet type, e.g., `main`, `futures`, or `full`. Not provided when requesting the default account/wallet.
 * @param {boolean} [isWebApi] When `true`, formats messages differently for the Web UI
 * @return {Promise<string>}
 */
async function getBalancesInfo(accountNo = 0, userId = '', scope = 'allcoins', accountType, isWebApi = false) {
  let output = '';

  try {
    const api = accountNo === 0 ? traderapi : traderapi2;
    const normalizedUserId = String(userId);

    const balances =
      /** @type {AssetsResultWithTimestamp} */
      (await orderUtils.getBalancesCached(true, moduleName, false, accountType, api)); // Cache allowed

    const balancesFetchTimestamp = balances?._timestamp || Date.now();

    // Format caption

    const accountTypeString = accountType ? ` _${accountType}_ account/wallet` : '';
    const suffix = traderapi2 ? ` (account ${accountNo + 1})` : '';
    const caption = `**${config.exchangeName}${accountTypeString} balances${suffix}**:\n\n`;

    // When the exchange fails to provide balances, stop and return

    if (balances && 'message' in balances) {
      return `${caption}${balances.message}`;
    }

    if (!balances) {
      return `${caption}Unable to retrieve account balances. Verify your API keys, or try again later if this is a temporary issue.`;
    }

    // When balances are empty

    if (balances.length === 0) {
      return `${caption}All empty.`;
    }

    // Otherwise, process balances

    output = caption;

    // Add balances list in format '16.94315519 USDT (1.94315519 available & 15 frozen)\n'

    const formattedBalances = composeBalancesString(balances, accountType, scope);
    output += formattedBalances.output;
    if (formattedBalances.excludedCount) {
      output += `…${formattedBalances.excludedCount} more coins are hidden\n`;
    }

    // Add 'Total holdings…\n' or ''

    const addedTotals = balancesHistory.addBalanceTotals(balances, scope);
    output += addedTotals.output;

    const balancesWithTotals = addedTotals.balancesWithTotals;

    // Calculate the balance difference from the previous request
    // Add '\n\nChanges in…\n' or ''
    // Only when `accountType` refers to the default trading account/wallet

    if (!isWebApi && !accountType) {
      // Try in-memory cache first. Fallback to DB if nothing in memory (after restart).
      const prevBalances =
        previousBalances[accountNo][normalizedUserId] ||
        await balancesHistory.getLastUserSnapshot(normalizedUserId, accountNo, accountType);

      output += utils.differenceInBalancesString(
          balancesWithTotals,
          prevBalances,
          scope,
      );

      const currentSnapshot = {
        timestamp: balancesFetchTimestamp,
        balances: balancesWithTotals,
      };

      // Update in-memory cache
      previousBalances[accountNo][normalizedUserId] = currentSnapshot;

      // Persist to DB
      await balancesHistory.saveUserSnapshot({
        userId: normalizedUserId,
        accountNo,
        accountType,
        balances: balancesWithTotals,
        callerName: 'getBalancesInfo-userSnapshot',
        timestamp: balancesFetchTimestamp,
      });
    }

    // Information on how balances have changed compared to the reference snapshot
    // Add '\nCompared against the reference snapshot from…\n' or ''

    const bw = utils.softRequire('../../trade/mm_balance_watcher');
    const changes = await bw?.guardBalances(accountNo, accountType, 'getBalancesInfo-stats');
    const { coin1, coin2 } = config;

    if (changes?.changesString) {
      output += `\n**Compared against the reference snapshot from ${utils.timeAgoString(changes.balanceChanges.from.timestamp)}**:\n\n`;

      if (changes.coin2ChangeSignificant || changes.valueChangeSignificant) {
        if (changes.coin2Compared) {
          if (changes.coin2ChangeSignificant) {
            output += `${coin2}: ${changes.coin2ChangeSymbol}${changes.coin2DeltaF} ${coin2}, ${changes.coin2DeltaPercentF}\n`;
          } else {
            output += `${coin2} ~ No changes\n`;
          }
        }

        if (changes.valueCompared) {
          if (changes.valueChangeSignificant) {
            output += `Normalized trading coins (${coin1}+${coin2}) value: ${changes.expectedDeltaF} ${coin2}, ${changes.expectedDeltaSymbol}${changes.expectedDeltaPercentF}\n`;
          } else {
            output += `Normalized trading coins (${coin1}+${coin2}) value ~ No changes\n`;
          }
        }
      } else {
        output += 'No significant changes in the main trading pair balances.\n';
      }
    }

    return output;
  } catch (e) {
    log.error(`commandTxs: Error in getBalancesInfo() of ${moduleName} module: ${e}`);
  }
}


/**
 * Shows account balance information.
 *
 * @param {string[]} params
 *   The first parameter defines the scope: `pair`, `priority`, or `allcoins`.
 *   - If omitted, only main trading pair balances will be shown (coin1 and coin2 in config): `pair`.
 *   - If set to `priority`, balances for `COINS_BY_PRIORITY` along with coin1 and coin2 will be shown.
 *   The second parameter defines the account type, e.g, `main`, `futures`, or `full` - depends on `features().accountTypes`.
 *   - If omitted, balances for the `trade` account will be shown.
 *   - If set to `full`, balances for all supported account types will be shown.
 * @param {Object} tx Incoming command transaction
 * @param {Object} user User information for the Web UI
 * @param {boolean} [isWebApi=false] When `true`, formats the result message for the Web UI
 * @returns {Promise<CommandReply>}
 */
async function balances(params, tx, user, isWebApi = false) {
  const commandExample = `Try: */balances allcoins full*`;
  let output = '';

  try {
    // Parse command params

    const parsedParams = utils.parseCommandParams(params, 0);

    const scopes = ['pair', 'priority', 'allcoins'];
    const scopeParam = parsedParams.getWhereIncluded(scopes);
    const scope = scopeParam?.param;

    const accountTypes = traderapi.features().accountTypes;
    const accountTypeFull = [...traderapi.features().accountTypes || [], 'full'];
    const accountTypeParam = parsedParams.getWhereIncluded(accountTypeFull);
    const accountType = accountTypes ? accountTypeParam?.param : undefined;

    if (parsedParams?.paramCount && !scope && !accountType) {
      return formSendBackMessage(`Unknown scope or account type: _${parsedParams.getFirst().param}_. ${commandExample}.`);
    }

    const userId = isWebApi ? user?.login : tx.senderId;
    const normalizedUserId = String(userId);

    // Fetch and format balances information for each account separately

    const balancesScope = /** @type {'pair' | 'priority' | 'allcoins'} */ (scope || 'pair');
    const info = (i) => getBalancesInfo(i, userId, balancesScope, accountType, isWebApi);
    const account0Balances = await info(0);
    const account1Balances = traderapi2 ? await info(1) : undefined;

    output = account1Balances ? account0Balances + '\n\n' + account1Balances : account0Balances;

    // Format combined balance information for both accounts (summary)
    // Combined account balances are shown only for the default trading account

    if (account0Balances && account1Balances && !isWebApi && !accountType) {
      // Last snapshots for each account
      const prevAcc0 = previousBalances[0][normalizedUserId] ||
        await balancesHistory.getLastUserSnapshot(normalizedUserId, 0, accountType);
      const prevAcc1 = previousBalances[1][normalizedUserId] ||
        await balancesHistory.getLastUserSnapshot(normalizedUserId, 1, accountType);

      const commonBalances = utils.sumBalances(prevAcc0?.balances, prevAcc1?.balances);

      output += '\n\n**Both accounts**:\n';
      output += composeBalancesString(commonBalances, accountType, balancesScope).output;

      // Previous combined snapshot
      const prevCombined = previousBalances[2][normalizedUserId] ||
        await balancesHistory.getLastUserSnapshot(normalizedUserId, 2, accountType);

      const diffString = utils.differenceInBalancesString(
          commonBalances,
          prevCombined,
      );

      if (diffString) {
        output += diffString;
      }

      const combinedSnapshot = { timestamp: Date.now(), balances: commonBalances };

      previousBalances[2][normalizedUserId] = combinedSnapshot;

      await balancesHistory.saveUserSnapshot({
        userId: normalizedUserId,
        accountNo: 2,
        accountType,
        balances: commonBalances,
        callerName: 'getBalancesInfo-combinedSnapshot',
        timestamp: combinedSnapshot.timestamp,
      });
    }

    return formSendBackMessage(output);
  } catch (e) {
    const errorDetails = `Error in balances() of ${moduleName} module: ${e}`;
    log.error(errorDetails);
    return formSendBackMessage(`Unable to process the command, try again later. ${errorDetails}`);
  }
}


/**
 * Composes account information for an account (supports two accounts when cross-trading)
 * @param {number} accountNo Account index: `0` for the first trading account, `1` for the second
 * @param {Object} tx Incoming command transaction
 * @param {boolean} [isWebApi=false] When `true`, composes the result message for the Web UI
 * @returns {Promise<string>}
 */
async function getAccountInfo(accountNo = 0, tx, isWebApi = false) {
  const paramString = `accountNo: ${accountNo}, tx: ${tx}, isWebApi: ${isWebApi}`;

  let output = '';

  try {
    let api;
    let type;
    let accountNoString = '';

    const pair = config.defaultPair;

    if (utils.isPerpetual(pair)) {
      type = 'perpetual contract';
      api = perpetualApi;
    } else {
      type = 'spot market';

      api = accountNo === 0 ? traderapi : traderapi2;
      accountNoString = traderapi2 ? ` (account ${accountNo+1})` : '';
    }

    if (api.features().getTradingFees) {
      const feesBTC = config.coin1 === 'BTC' ? [] : await api.getFees(utils.isPerpetual(pair) ? 'BTCUSDT' : 'BTC/USDT'); // Show BTC/USDT fees by default
      const feesCoin2 = await api.getFees(config.coin1); // Show fees for all coin1/* pairs

      const fees = [...(feesBTC || []), ...(feesCoin2 || [])];

      if (fees.length === 0) {
        output += `${config.exchangeName} API did not return fee information.\n\n`;
      } else {
        output = `${config.exchangeName} ${type} trading fees${accountNoString}:\n`;

        fees.forEach((pair) => {
          output += `_${pair.pair}_: maker ${utils.formatNumber(pair.makerRate, true)}, taker ${utils.formatNumber(pair.takerRate, true)}`;

          if (pair.takerRateStable && pair.takerRateCrypto) {
            output += `, taker-stable ${utils.formatNumber(pair.takerRateStable, true)}`;
            output += `, taker-crypto ${utils.formatNumber(pair.takerRateCrypto, true)}`;
          }

          output += '\n';
        });

        output += '\n';
      }
    } else {
      output += `${config.exchangeName} API does not provide trading fee information.\n\n`;
    }

    if (traderapi.features().getAccountTradeVolume) {
      const tradingVolume = await api.getVolume();

      output += `${config.exchangeName} 30-days trading volume${accountNoString}: `;

      output += `${utils.formatNumber(tradingVolume?.volume30days, true)}`;
      output += tradingVolume?.volumeUnit ? ` ${tradingVolume?.volumeUnit}` : '';
      output += tradingVolume?.updated ? ` as on ${tradingVolume?.updated}.` : '.';
    } else {
      output += `${config.exchangeName}'s API doesn't provide trading volume information.`;
    }

    if (TraderApi.exchangeAccounts) {
      const { accountType, accountTypeAll, isMasterAccount, uid } = TraderApi.exchangeAccounts;

      output += '\n\n';
      if (isMasterAccount) {
        output += `Account is main (not a subaccount).\nType (default trading wallet): ${accountType}.\nAccounts (wallets): ${accountTypeAll.join(', ')}.\nUID: ${uid}.`;
      } else {
        output += `It's a sub-account (not a main account).\nType (default trading wallet): ${accountType}.\nAccounts (wallets): ${accountTypeAll.join(', ')}.\nUID: ${uid}.`;
      }
    }
  } catch (e) {
    log.error(`commandTxs: Error in getAccountInfo(${paramString}) of ${moduleName} module: ${e}`);
    output = 'Error while receiving account information. Try again later.';
  }

  return output;
}


/**
 * Show account information: trading fees, volume, and subaccounts
 * Works both for Spot and Contracts
 * Format: /account
 * @see https://marketmaking.app/cex-mm/command-reference#account
 * @param {any} _ Nothing
 * @param {Object} tx Incoming command transaction
 * @param {boolean} [isWebApi=false] When `true`, composes the result message for the Web UI
 * @returns {Promise<CommandReply>}
 */
async function account(_, tx, isWebApi = false) {
  let output = '';

  try {
    if (traderapi.features().getTradingFees || traderapi.features().getAccountTradeVolume) {
      const account0Info = await getAccountInfo(0, tx, isWebApi);
      const account1Info = traderapi2 ? await getAccountInfo(1, tx, isWebApi) : undefined;

      output = account1Info ? account0Info + '\n\n' + account1Info : account0Info;
    } else {
      output = `${config.exchangeName}'s API doesn't provide account information.`;
    }
  } catch (e) {
    log.error(`commandTxs: Error in account() of ${moduleName} module: ${e}`);
  }

  return formSendBackMessage(output);
}


/**
 * Stub handler for the `/volume` command (reserved; not exposed in the public command list).
 *
 * @returns {CommandReply}
 */
function volume() {
  return {
    msgNotify: '',
    msgSendBack: 'This is a stub.',
    notifyType: 'log',
  };
}

module.exports = {
  deposit,
  balances,
  account,
  volume,
  getBalancesInfo,
  composeBalancesString,
};
