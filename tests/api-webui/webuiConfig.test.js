'use strict';

/* global describe, test, expect */

const { isPrivateWebUiApiEnabled, isPublicWebUiRelayEnabled, getWebUiTransport } = require('../../api/lib/webuiConfig');

describe('isPrivateWebUiApiEnabled', () => {
  test('returns true for positive integer ports', () => {
    expect(isPrivateWebUiApiEnabled(3001)).toBe(true);
    expect(isPrivateWebUiApiEnabled(1)).toBe(true);
  });

  test('returns false when private WebUI API is disabled or invalid', () => {
    expect(isPrivateWebUiApiEnabled(false)).toBe(false);
    expect(isPrivateWebUiApiEnabled(0)).toBe(false);
    expect(isPrivateWebUiApiEnabled(-1)).toBe(false);
    expect(isPrivateWebUiApiEnabled(1.5)).toBe(false);
    expect(isPrivateWebUiApiEnabled(undefined)).toBe(false);
    expect(isPrivateWebUiApiEnabled(null)).toBe(false);
    expect(isPrivateWebUiApiEnabled('3001')).toBe(false);
  });
});

describe('public WebUI relay config', () => {
  test('isPublicWebUiRelayEnabled requires relay URL and license token', () => {
    expect(isPublicWebUiRelayEnabled({
      public_webui: 'wss://relay.example/relay',
      public_webui_license_token: 'lic-1',
    })).toBe(true);

    expect(isPublicWebUiRelayEnabled({
      public_webui: '',
      public_webui_license_token: 'lic-1',
    })).toBe(false);

    expect(isPublicWebUiRelayEnabled({
      public_webui: 'wss://relay.example/relay',
      public_webui_license_token: '',
    })).toBe(false);
  });

  test('getWebUiTransport auto-detects relayWs vs directHttp', () => {
    expect(getWebUiTransport({
      public_webui: '',
      public_webui_license_token: '',
    })).toBe('directHttp');

    expect(getWebUiTransport({
      public_webui: 'wss://relay.example/relay',
      public_webui_license_token: 'lic-1',
    })).toBe('relayWs');
  });
});
