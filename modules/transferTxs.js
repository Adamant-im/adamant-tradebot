const $u = require('../helpers/utils');
const notify = require('../helpers/notify');
const config = require('./configReader');

module.exports = async (itx, tx) => {

  const msgSendBack = `I got a transfer from you. Thanks, bro.`;
  const msgNotify = `${config.notifyName} got a transfer transaction. Income ADAMANT Tx: https://explorer.adamant.im/tx/${tx.id}.`;
  const notifyType = 'log';

  await itx.update({ isProcessed: true }, true);

  notify(msgNotify, notifyType);
  $u.sendAdmMsg(tx.senderId, msgSendBack);

};
