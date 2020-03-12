const {SAT} = require('../helpers/const');
const $u = require('../helpers/utils');
const notify = require('../helpers/notify');
const config = require('./configReader');

module.exports = async (itx, tx) => {

	const msg = itx.encrypted_content;
	let inCurrency,
		outCurrency,
		inTxid,
		inAmountMessage;

	if (tx.amount > 0) { // ADM income payment
		inAmountMessage = tx.amount / SAT;
		inCurrency = 'ADM';
		outCurrency = msg;
		inTxid = tx.id;
	} else if (msg.includes('_transaction')) { // not ADM income payment
		inCurrency = msg.match(/"type":"(.*)_transaction/)[1];
		try {
			const json = JSON.parse(msg);
			inAmountMessage = Number(json.amount);
			inTxid = json.hash;
			outCurrency = json.comments;
			if (outCurrency === ''){
				outCurrency = 'NONE';
			}		
		} catch (e){
			inCurrency = 'none';
		}
	}

	outCurrency = String(outCurrency).toUpperCase().trim();
	inCurrency = String(inCurrency).toUpperCase().trim();

	// Validate
	let msgSendBack = `I got a transfer from you. Thanks, bro.`;
	let msgNotify = `${config.notifyName} got a transfer transaction. Income ADAMANT Tx: https://explorer.adamant.im/tx/${tx.id}.`;
	let notifyType = 'log';

	await itx.update({isProcessed: true}, true);

	notify(msgNotify, notifyType);
	$u.sendAdmMsg(tx.senderId, msgSendBack);

};
