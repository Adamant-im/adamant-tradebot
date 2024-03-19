const formatPairName = (pair) => {
  if (pair.indexOf('-') > -1) {
    pair = pair.replace('-', '_').toUpperCase();
  } else {
    pair = pair.replace('/', '_').toUpperCase();
  }
  const [coin1, coin2] = pair.split('_');
  return {
    pair,
    coin1: coin1.toUpperCase(),
    coin2: coin2.toUpperCase(),
  };
};

module.exports = { formatPairName };
