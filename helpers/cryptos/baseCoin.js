module.exports = class baseCoin {

  cache = {
    getData(data, validOnly) {
      if (this[data] && this[data].timestamp) {
        if (!validOnly || (Date.now() - this[data].timestamp < this[data].lifetime)) {
          return this[data].value;
        }
      }
      return undefined;
    },
    cacheData(data, value) {
      this[data].value = value;
      this[data].timestamp = Date.now();
    },
  };

  account = {
    passPhrase: undefined,
    privateKey: undefined,
    keyPair: undefined,
    address: undefined,
  };

};
