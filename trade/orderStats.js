const db = require('../modules/DB');
const $u = require('../helpers/utils');

module.exports = async (isExecuted, isProcessed, isCancelled, purpose, pair) => {

    const {ordersDb} = db;

    const day = $u.unix() - 24 * 3600 * 1000;
    const month = $u.unix() - 30 * 24 * 3600 * 1000;

    stats = (await ordersDb.aggregate([
        {$group: { 
            _id: null,
            coin1AmountTotalAll: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    "$coin1Amount",
                    // False
                    0
                ]
            }},
            coin1AmountTotalDay: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$gt: ["$date", day]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    "$coin1Amount",
                    // False
                    0
                ]
            }},
            coin1AmountTotalMonth: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$gt: ["$date", month]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    "$coin1Amount",
                    // False
                    0
                ]
            }},
            coin2AmountTotalAll: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    "$coin2Amount",
                    // False
                    0
                ]
            }},
            coin2AmountTotalDay: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$gt: ["$date", day]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    "$coin2Amount",
                    // False
                    0
                ]
            }},
            coin2AmountTotalMonth: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$gt: ["$date", month]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    "$coin2Amount",
                    // False
                    0
                ]
            }},            
            coin1AmountTotalAllCount: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    1,
                    // False
                    0
                ]
            }},
            coin1AmountTotalDayCount: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$gt: ["$date", day]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
                    // True
                    1,
                    // False
                    0
                ]
            }},
            coin1AmountTotalMonthCount: {$sum: {
                $cond: [
                    // Condition to test 
                    {$and: [ {$gt: ["$date", month]}, {$eq: ["$isExecuted", isExecuted]}, {$eq: ["$isProcessed", isProcessed]}, {$eq: ["$isCancelled", isCancelled]}, {$eq: ["$purpose", purpose]}, {$eq: ["$pair", pair]} ]},
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

};


