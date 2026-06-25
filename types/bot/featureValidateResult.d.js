/**
 * types/bot/featureValidateResult.d.js
 */

/**
 * @typedef {Object} FeatureValidateResult
 * @property {boolean} featureExists Whether the feature exists
 * @property {boolean} [validated] Validation flag
 * @property {boolean} [perpetual] Whether the feature is available for perpetual trading
 * @property {string} [tradeParamActiveName] Active parameter name in `tradeParams`, e.g, `mm_isVolatilityActive`
 * @property {string} [description] Feature description
 * @property {boolean} [moduleAvailable] Whether the optional `module` file is present in this build
 * @property {string} msgSendBack Message text to send back in case of validation error
 */

module.exports = {};

