const db = require('./DB');
const log = require('../helpers/log');
const keys = require('adamant-api/helpers/keys');
const api = require('./api');
const {version} = require('../package.json');
const config = require('./configReader');

// ADM data
const AdmKeysPair = keys.createKeypairFromPassPhrase(config.passPhrase);
const AdmAddress = keys.createAddressFromPublicKey(AdmKeysPair.publicKey);
// ETH data
const ethData = api.eth.keys(config.passPhrase);

module.exports = {
	version,
	botName: AdmAddress,
	user: {
		ADM: {
			passPhrase: config.passPhrase,
			keysPair: AdmKeysPair,
			address: AdmAddress
		},
		ETH: {
			address: ethData.address,
			privateKey: ethData.privateKey,
		}
	},
	comissions: {
		ADM: 0.5 // This is a stub. Ether fee returned with FEE() method in separate module
	},
	lastBlock: null,
	get lastHeight() {
		return this.lastBlock && this.lastBlock.height || false;
	},
	updateSystem(field, data) {
		const $set = {};
		$set[field] = data;
		db.systemDb.db.updateOne({}, {$set}, {upsert: true});
		this[field] = data;
	},
	async updateLastBlock() {
		try {
			const lastBlock = (await api.get('uri', 'blocks')).blocks[0];
			this.updateSystem('lastBlock', lastBlock);
		} catch (e) {
			log.error('Error while updating lastBlock: ' + e);
		}
	},
	async updateCurrencies(){
		try {
			const data = await api.syncGet(config.infoservice + '/get', true);
			if (data.success){
				this.currencies = data.result;
			}
		} catch (e){
			log.error('Error while updating currencies: ' + e);
		};
	},
	getPrice(from, to){
		try {
			from = from.toUpperCase();
			to = to.toUpperCase();
			let price = + (this.currencies[from + '/' + to] || 1 / this.currencies[to + '/' + from] || 0).toFixed(8);
			if (price){
				return price;
			}
			const priceFrom = +(this.currencies[from + '/USD']);
			const priceTo = +(this.currencies[to + '/USD']);
			return +(priceFrom / priceTo || 1).toFixed(8);
		} catch (e){
			log.error('Error while calculating getPrice(): ', e);
			return 0;
		}
	},
	mathEqual(from, to, amount, doNotAccountFees){
		let price = this.getPrice(from, to);
		if (!doNotAccountFees){
			price *= (100 - config['exchange_fee_' + from]) / 100;
		};
		if (!price){
			return {
				outAmount: 0,
				exchangePrice: 0
			};
		}
		price = +price.toFixed(8);
		return {
			outAmount: +(price * amount).toFixed(8),
			exchangePrice: price
		};
	}
};

config.notifyName = `${config.bot_name} (${module.exports.botName})`;
module.exports.updateCurrencies();

setInterval(() => {
	module.exports.updateCurrencies();
}, 60 * 1000);

