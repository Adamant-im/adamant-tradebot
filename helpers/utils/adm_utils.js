const Store = require('../../modules/Store');
const api = require('../../modules/api');
const log = require('../../helpers/log');
const {SAT} = require('../const');
const User = Store.user.ADM;

module.exports = {
	get FEE() {
		return Store.comissions.ADM;
	},
	syncGetTransaction(hash, tx){
		return {
			blockNumber: tx.blockId,
			hash: tx.id,
			sender: tx.senderId,
			recipient: tx.recipientId,
			amount: +(tx.amount / SAT).toFixed(8)
		};
	},
	async getLastBlockNumber(){
		try {
			return (await api.get('uri', 'blocks?limit=1')).blocks[0].height;
		} catch (e){
			return null;
		}
	},
	async getTransactionStatus(txid){
		try {
			const tx = (await api.get('uri', 'transactions/get?id=' + txid)).transaction;
			return {
				blockNumber: tx.height,
				status: true
			};
		} catch (e){
			return null;
		}
	},
	async send(params) {
		try {
			const {address, value, comment} = params;
			console.log(`Send ${value} ADM: `, comment);
			let res;
			if (comment){
				res = api.send(User.passPhrase, address, comment, 'message', null, value);
			} else {
				res = api.send(User.passPhrase, address, value, null, comment);
			}

			if (!res) {
				return {
					success: false
				};
			}
			return {
				success: res.success,
				hash: res.transactionId
			};
		} catch (e) {
			log.error('Error while sending ADM in Utils module: ' + e);
		}
	},
	async updateBalance() {
		try {
			User.balance = (await api.get('uri', 'accounts?address=' + User.address)).account.balance / SAT;
		} catch (e) {
			log.error('Error while getting ADM balance in Utils module: ' + e);
		}
	}
};
