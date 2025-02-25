const networks = {
  TRC20: {
    code: 'TRC20',
    name: 'Tron network',
    sampleAddress: 'TA1M9YPEBNFv1Ww62kXgYgAaqMr7HCWsws',
  },
  OPTIMISM: {
    code: 'OPTIMISM',
    name: 'Optimism',
    sampleAddress: '0xe16d65d4b592c4fddaecb7363c276b68c5758e34',
  },
  ARBINOVA: {
    code: 'ARBINOVA',
    name: 'Arbitrum Nova',
    sampleAddress: '0x0123456789abcdef0123456789abcdef01234567',
  },
  ARBITRUM: {
    code: 'ARBITRUM',
    name: 'Arbitrum',
    sampleAddress: '0xe16d65d4b592c4fddaecb7363c276b68c5758e34',
  },
  BASE: {
    code: 'BASE',
    name: 'Base Mainnet',
    sampleAddress: '0x0123456789abcdef0123456789abcdef01234567',
  },
  BEP20: {
    code: 'BEP20',
    name: 'BNB Smart Chain',
    sampleAddress: '0xbe807dddb074639cd9fa61b47676c064fc50d62c',
  },
  BNB: {
    code: 'BNB',
    name: 'BNB Chain',
    sampleAddress: 'bnb1fnd0k5l4p3ck2j9x9dp36chk059w977pszdgdz',
  },
  ERC20: {
    code: 'ERC20',
    name: 'Ethereum',
    altcode: 'Ether',
    sampleAddress: '0xF110E32D351Cedba6400E85f3bfa308DC606e079',
  },
  LINEA: {
    code: 'LINEA',
    name: 'LINEA',
    sampleAddress: '0x0123456789abcdef0123456789abcdef01234567',
  },
  MANTLE: {
    code: 'MANTLE',
    name: 'Mantle Network',
    sampleAddress: '0x0123456789abcdef0123456789abcdef01234567',
  },
  'ZKSYNC-ERA': {
    code: 'ZKSYNC-ERA',
    name: 'zkSync Era',
    sampleAddress: '0xF110E32D351Cedba6400E85f3bfa308DC606e079',
  },
  ZKSYNC: {
    code: 'ZKSYNC',
    name: 'zkSync Lite',
    sampleAddress: '0x0123456789abcdef0123456789abcdef01234567',
  },
  'AVAX-C-CHAIN': {
    code: 'AVAX-C-CHAIN',
    altcode: 'AVAX-CCHAIN',
    name: 'Avalanche C-Chain',
    sampleAddress: '0xf41ca2e343a827403527c6b3c1fa91a9b134d45b',
  },
  'AVAX-X-CHAIN': {
    code: 'AVAX-X-CHAIN',
    altcode: 'AVAX-XCHAIN',
    name: 'Avalanche X-Chain',
    sampleAddress: 'X-avax1tzdcgj4ehsvhhgpl7zylwpw0gl2rxcg4r5afk5',
  },
  MATIC: {
    code: 'MATIC',
    name: 'Polygon',
    sampleAddress: '0x47cf5d48fb585991139316e0b37080111c760a7a',
  },
  ALGO: {
    code: 'ALGO',
    name: 'Algorand',
    sampleAddress: 'C7RYOGEWDT7HZM3HKPSMU7QGWTRWR3EPOQTJ2OHXGYLARD3X62DNWELS34',
  },
  OKT: {
    code: 'OKT',
    name: 'OKX Chain',
    sampleAddress: '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
  },
  KCC: {
    code: 'KCC',
    name: 'KuCoin Chain',
    sampleAddress: '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
  },
  BTC: {
    code: 'BTC',
    name: 'Bitcoin',
    sampleAddress: 'bc1qx97fj3ze7snapdpgz3r4sjy7vpstgchrwc954u',
  },
  KUSAMA: {
    code: 'KUSAMA',
    name: 'Kusama',
    sampleAddress: 'D4davkiP24KXiUm2VAHZs7kBsh8tEQuJX5cytL6cRvterAJ',
  },
  SOL: {
    code: 'SOL',
    altcode: 'SPL',
    name: 'Solana',
    sampleAddress: '31Sof5r1xi7dfcaz4x9Kuwm8J9ueAdDduMcme59sP8gc',
  },
  HT: {
    code: 'HT',
    name: 'Huobi ECO Chain',
    sampleAddress: '0x6e141a6c7c025f1a988e4dd3e991ae9ff8f01658',
  },
  EOS: {
    code: 'EOS',
    name: 'EOS',
    sampleAddress: 'doeelyivxerl',
  },
  XTZ: {
    code: 'XTZ',
    name: 'Tezos',
    sampleAddress: 'tz1MPt33iQWH2hD2tiNbRHrh6y2gGYvEuQdX',
  },
  DOT: {
    code: 'DOT',
    name: 'Polkadot',
    sampleAddress: '1WbK3qvsZLKshdXZP4bhXUf7JTaFDmVXx1nmLtkUU62XtBf',
  },
  ETC: {
    code: 'ETC',
    name: 'Ethereum Classic',
    sampleAddress: '0xedeb94ef299920ed9cbae0f9f6a52d7bc744047dcbcdec5d2de5c1af32b9f75b',
  },
  OMNI: {
    code: 'OMNI',
    name: 'Omni',
    sampleAddress: '1JKhrVV9EsgSS5crXLBo9BRVXyuHjf2Tcp',
  },
  CFX: {
    code: 'CFX',
    name: 'Conflux',
    sampleAddress: '0x40f8572D3Edd04C869ECBab246d6Aee37A5B9b29',
  },
  FLOW: {
    code: 'FLOW',
    name: 'Flow',
    sampleAddress: '0xbaf7ab7b36232a85',
  },
  MINA: {
    code: 'MINA',
    name: 'Mina',
    sampleAddress: '0x2f32359c958af5548e4c2c74587fef67477baff3',
  },
  HARMONY: {
    code: 'HARMONY',
    name: 'Harmony',
    sampleAddress: 'one1yxzn9gf28zdy4yhup30my2gp68qerx929rv2ns',
  },
  XLM: {
    code: 'XLM',
    name: 'Stellar',
    sampleAddress: 'GB5A3OA657UWF3BN7WU4XFFWT333HFP2KFK2OFAXPEL3BBGQ7QLRNASG',
  },
  CAP20: {
    code: 'CAP20',
    name: 'Chiliz Chain',
    sampleAddress: '0x579391C9865545000d8922ACF71a660521cc6404',
  },
  BRC20: {
    code: 'BRC20',
    name: 'Ordinals',
    sampleAddress: 'bc1pxaneaf3w4d27hl2y93fuft2xk6m4u3wc4rafevc6slgd7f5tq2dqyfgy06',
  },
};

module.exports = networks;
