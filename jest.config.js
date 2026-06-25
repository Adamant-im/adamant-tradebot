const allowDiscovery = Boolean(process.env.JEST_SCOPE);

module.exports = {
  forceExit: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // Ignore the entire tests tree unless a scoped run sets JEST_SCOPE=1.
    ...(allowDiscovery ? [] : ['<rootDir>/tests/']),
    // Manual integration runner, not a Jest suite (no test()/describe()).
    '<rootDir>/tests/general/manual.test.js',
    // Live exchange scripts — run with node, not Jest.
    '<rootDir>/tests/trader_live/',
  ],
};
