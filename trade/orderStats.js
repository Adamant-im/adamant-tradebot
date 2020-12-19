const db = require('../modules/DB');
const $u = require('../helpers/utils');
const config = require('../modules/configReader');

module.exports = {

    async aggregate(isExecuted, isProcessed, isCancelled, purpose, pair) {

        const {ordersDb} = db;

        const day = $u.unix() - 24 * 3600 * 1000;
        const month = $u.unix() - 30 * 24 * 3600 * 1000;

        stats = (await ordersDb.aggregate([
            {$group: { 
                _id: null,
                coin1AmountTotalAll: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        "$coin1Amount",
                        // False
                        0
                    ]
                }},
                coin1AmountTotalDay: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$gt: ["$date", day]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        "$coin1Amount",
                        // False
                        0
                    ]
                }},
                coin1AmountTotalMonth: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$gt: ["$date", month]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        "$coin1Amount",
                        // False
                        0
                    ]
                }},
                coin2AmountTotalAll: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        "$coin2Amount",
                        // False
                        0
                    ]
                }},
                coin2AmountTotalDay: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$gt: ["$date", day]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        "$coin2Amount",
                        // False
                        0
                    ]
                }},
                coin2AmountTotalMonth: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$gt: ["$date", month]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        "$coin2Amount",
                        // False
                        0
                    ]
                }},            
                coin1AmountTotalAllCount: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        1,
                        // False
                        0
                    ]
                }},
                coin1AmountTotalDayCount: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$gt: ["$date", day]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        1,
                        // False
                        0
                    ]
                }},
                coin1AmountTotalMonthCount: {$sum: {
                    $cond: [
                        // Condition to test 
                        {$and: [ {$gt: ["$date", month]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]}, {$eq: ["$exchange", config.exchange]} ]},
                        // True
                        1,
                        // False
                        0
                    ]
                }}

            }}
        ]));

        if (!stats[0])
            stats[0] = 'Empty';

        return stats[0];

    },
    async ordersByType(pair) {

        const {ordersDb} = db;
        let orders = await ordersDb.find({
            isProcessed: false,
            pair: pair || config.pair,
            exchange: config.exchange
        });

        let ordersByType = {};
        try {

            ordersByType.all = orders;
            ordersByType.mm = orders.filter(order => order.purpose === 'mm');
            ordersByType.ob = orders.filter(order => order.purpose === 'ob');
            ordersByType.tb = orders.filter(order => order.purpose === 'tb');
            ordersByType.liq = orders.filter(order => order.purpose === 'liq');
            ordersByType.pw = orders.filter(order => order.purpose === 'pw');

        } catch (e) {
            log.error(`Error in ordersByType(${pair}) of ${$u.getModuleName(module.id)}: ${err}.`);
        }
        
        return ordersByType;

    }

}

