import { describe, expect, it } from 'vitest';

import { isSupportedEnvironment } from '../../src/core';

describe('isSupportedEnvironment', () => {
  it.each([
    { remoteName: undefined, isWeb: false, supported: true },
    { remoteName: 'wsl', isWeb: false, supported: false },
    { remoteName: 'ssh-remote', isWeb: false, supported: false },
    { remoteName: 'codespaces', isWeb: true, supported: false },
    { remoteName: undefined, isWeb: true, supported: false },
  ])('remote=$remoteName web=$isWeb → $supported', ({ remoteName, isWeb, supported }) => {
    expect(isSupportedEnvironment({ remoteName, isWeb })).toBe(supported);
  });
});
