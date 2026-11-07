'use strict';

const { spawnSync } = require('child_process');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Refusing to run the full Jest suite.');
  console.error('');
  console.error('Use a scoped npm script:');
  console.error('  npm run test:general   # utils and helpers');
  console.error('  npm run test:features   # fillsEngine, Nice Chart, liquidity');
  console.error('  npm run test:api-webui  # WebUI API');
  console.error('  npm run test:trader    # mocked exchange trader unit tests');
  console.error('');
  console.error('Or pass an explicit path:');
  console.error('  npm test -- tests/trader/trader_binance.test.js');
  console.error('');
  console.error('See CONTRIBUTING.md#tests');
  process.exit(1);
}

const result = spawnSync('jest', args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, JEST_SCOPE: '1' },
});

process.exit(result.status ?? 1);
