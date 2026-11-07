'use strict';

/* global describe, test, expect */

const { botFeatures } = require('../../modules/commands/botFeaturesRegistry');

describe('botFeatures', () => {
  // `utils.softRequire()` returns undefined for a wrong path, so a typo here silently disables the feature.
  test('feature modules point to trade/features/', () => {
    const modulePaths = Object.values(botFeatures)
        .map((feature) => feature.module)
        .filter(Boolean);

    expect(modulePaths.length).toBeGreaterThan(0);

    modulePaths.forEach((modulePath) => {
      expect(modulePath).toMatch(/^\.\.\/\.\.\/trade\/features\/mm_[a-z_]+$/);
    });
  });
});
