import { describe, expect, it } from 'vitest';

import { SESSION_TTL_MS, createSessionToken, passwordMatches, verifySessionToken } from './auth.js';

describe('session tokens', () => {
  it('accepts its own tokens until they expire', () => {
    const token = createSessionToken('s', 1000);
    expect(verifySessionToken('s', token, 2000)).toBe(true);
    expect(verifySessionToken('s', token, 1000 + SESSION_TTL_MS + 1)).toBe(false);
  });

  it('rejects tampered or foreign tokens', () => {
    const token = createSessionToken('s', 1000);
    const [, sig] = token.split('.');
    expect(verifySessionToken('other', token, 2000)).toBe(false);
    expect(verifySessionToken('s', `99999999999999.${sig}`, 2000)).toBe(false);
    expect(verifySessionToken('s', 'garbage', 2000)).toBe(false);
    expect(verifySessionToken('s', undefined, 2000)).toBe(false);
  });
});

describe('passwordMatches', () => {
  it('compares exactly', () => {
    expect(passwordMatches('pw', 'pw')).toBe(true);
    expect(passwordMatches('pw', 'pw ')).toBe(false);
    expect(passwordMatches('pw', undefined)).toBe(false);
  });
});
