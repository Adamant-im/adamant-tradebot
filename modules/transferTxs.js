const notify = require('../helpers/notify');
const config = require('./configReader');
const api = require('./api');
const log = require('../helpers/log');

module.exports = async (itx, tx) => {

  const msgSendBack = 'I got a transfer from you. Thanks, bro.';
  const msgNotify = `${config.notifyName} got a transfer transaction. Income ADAMANT Tx: https://explorer.adamant.im/tx/${tx.id}.`;
  const notifyType = 'log';

  await itx.update({ isProcessed: true }, true);

  notify(msgNotify, notifyType);
  api.sendMessage(config.passPhrase, tx.senderId, msgSendBack).then((response) => {
    if (!response.success) {
      log.warn(`Failed to send ADM message '${msgSendBack}' to ${tx.senderId}. ${response.errorMessage}.`);
    }
  });

};
