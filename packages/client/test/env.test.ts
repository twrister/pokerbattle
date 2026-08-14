import { describe, expect, it } from 'vitest';
import { formatLobbyVersion } from '../src/env.js';

describe('formatLobbyVersion', () => {
  it('补上 v 前缀', () => {
    expect(formatLobbyVersion('0.1.1')).toBe('v0.1.1');
  });

  it('已有 v 前缀时不重复', () => {
    expect(formatLobbyVersion('v0.1.1')).toBe('v0.1.1');
  });
});
