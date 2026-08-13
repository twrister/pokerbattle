import { describe, expect, it } from 'vitest';
import { checkBasicAuth } from '../src/basicAuth.js';

function req(authorization?: string): { headers: { authorization?: string } } {
  return { headers: authorization ? { authorization } : {} };
}

describe('checkBasicAuth', () => {
  it('accepts matching user and password', () => {
    const token = Buffer.from('ops:s3cret').toString('base64');
    expect(checkBasicAuth(req(`Basic ${token}`) as never, 'ops', 's3cret')).toBe(true);
  });

  it('rejects missing header', () => {
    expect(checkBasicAuth(req() as never, 'ops', 's3cret')).toBe(false);
  });

  it('rejects wrong password', () => {
    const token = Buffer.from('ops:nope').toString('base64');
    expect(checkBasicAuth(req(`Basic ${token}`) as never, 'ops', 's3cret')).toBe(false);
  });

  it('allows colon inside password', () => {
    const token = Buffer.from('ops:a:b:c').toString('base64');
    expect(checkBasicAuth(req(`Basic ${token}`) as never, 'ops', 'a:b:c')).toBe(true);
  });
});
