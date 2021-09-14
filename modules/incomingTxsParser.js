const db = require('./DB');
const log = require('../helpers/log');
const $u = require('../helpers/utils');
const api = require('./api');
const config = require('./configReader');
const commandTxs = require('./commandTxs');
const unknownTxs = require('./unknownTxs');
const transferTxs = require('./transferTxs');
const notify = require('../helpers/notify');

const historyTxs = {};

module.exports = async (tx) => {

  if (!tx) {
    return;
  }

  if (historyTxs[tx.id]) { // do not process one tx twice
    return;
  }

  const { incomingTxsDb } = db;
  const checkedTx = await incomingTxsDb.findOne({ txid: tx.id });
  if (checkedTx !== null) {
    return;
  };

  log.info(`New incoming transaction: ${tx.id}`);

  let msg = '';
  const chat = tx.asset.chat;
  if (chat) {
    msg = api.decodeMsg(chat.message, tx.senderPublicKey, config.passPhrase, chat.own_message).trim();
  }

  if (msg === '') {
    msg = 'NONE';
  }

  let type = 'unknown';
  if (msg.includes('_transaction') || tx.amount > 0) {
    type = 'transfer'; // just for special message
  } else if (msg.startsWith('/')) {
    type = 'command';
  }

  const spamerIsNotyfy = await incomingTxsDb.findOne({
    sender: tx.senderId,
    isSpam: true,
    date: { $gt: ($u.unix() - 24 * 3600 * 1000) }, // last 24h
  });

  const itx = new incomingTxsDb({
    _id: tx.id,
    txid: tx.id,
    date: $u.unix(),
    block_id: tx.blockId,
    encrypted_content: msg,
    spam: false,
    sender: tx.senderId,
    type, // command, transfer or unknown
    isProcessed: false,
    isNonAdmin: false,
  });

  const countRequestsUser = (await incomingTxsDb.find({
    sender: tx.senderId,
    date: { $gt: ($u.unix() - 24 * 3600 * 1000) }, // last 24h
  })).length;

  if (countRequestsUser > 100000 || spamerIsNotyfy) { // 100 000 per 24h is a limit for accepting commands. Just don't want to remove this check.
    itx.update({
      isProcessed: true,
      isSpam: true,
    });
  }

  // do not process messages from non-admin accounts
  if (!config.admin_accounts.includes(tx.senderId) && (type === 'command' || type === 'unknown')) {
    log.warn(`${config.notifyName} received a message from non-admin user _${tx.senderId}_. Ignoring. Income ADAMANT Tx: https://explorer.adamant.im/tx/${tx.id}.`);
    itx.update({
      isProcessed: true,
      isNonAdmin: true,
    });
    if (config.notify_non_admins) {
      $u.sendAdmMsg(tx.senderId, `I won't execute your commands as you are not an admin. Connect with my master.`);
    }
  }

  await itx.save();
  if (historyTxs[tx.id]) {
    return;
  }
  historyTxs[tx.id] = $u.unix();

  if (itx.isSpam && !spamerIsNotyfy) {
    notify(`${config.notifyName} notifies _${tx.senderId}_ is a spammer or talks too much. Income ADAMANT Tx: https://explorer.adamant.im/tx/${tx.id}.`, 'warn');
    $u.sendAdmMsg(tx.senderId, `I’ve _banned_ you. You’ve sent too much transactions to me.`);
    return;
  }

  switch (type) {
    case ('transfer'):
      transferTxs(itx, tx);
      break;
    case ('command'):
      commandTxs(msg, tx, itx);
      break;
    default:
      unknownTxs(tx, itx);
      break;
  }
};
