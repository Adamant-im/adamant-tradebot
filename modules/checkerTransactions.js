const Store = require('./Store');
const api = require('./api');
const txParser = require('./incomingTxsParser');
const log = require('../helpers/log');

async function check() {
	try {
		if (!Store.lastHeight){
			return;
		}
		const txChat = (await api.get('uri', 'chats/get/?recipientId=' + Store.user.ADM.address + '&orderBy=timestamp:desc&fromHeight=' + (Store.lastHeight - 5))).transactions;
		const txTrx = (await api.get('transactions', 'fromHeight=' + (Store.lastHeight - 5) + '&and:recipientId=' + Store.user.ADM.address + '&and:type=0')).transactions;

		if (txChat && txTrx) {
			txChat
				.concat(txTrx)
				.forEach(t => {
					txParser(t);
				});
			Store.updateLastBlock();
		}
	} catch (e) {
		log.error('Error while checking new transactions: ' + e);
	}
}
module.exports = () => {
	setInterval(check, 2500);
};
