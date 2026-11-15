import { describe, expect, it } from 'vitest';

import { resolveLink } from '../../src/core';

const from = 'docs/guides/setup.md';

describe('resolveLink', () => {
  it.each([
    ['#install', { kind: 'anchor' }],
    ['https://example.com', { kind: 'external' }],
    ['mailto:a@b.c', { kind: 'external' }],
    ['//evil.example/x.png', { kind: 'external' }],
    ['deploy.md', { kind: 'local', path: 'docs/guides/deploy.md', fragment: '' }],
    ['./deploy.md#step-2', { kind: 'local', path: 'docs/guides/deploy.md', fragment: '#step-2' }],
    ['../README.md', { kind: 'local', path: 'docs/README.md', fragment: '' }],
    ['../../README.md', { kind: 'local', path: 'README.md', fragment: '' }],
    ['/top.md', { kind: 'local', path: 'top.md', fragment: '' }],
    ['../My%20Notes/caf%C3%A9.md', { kind: 'local', path: 'docs/My Notes/café.md', fragment: '' }],
    ['deploy.md?plain=1#x', { kind: 'local', path: 'docs/guides/deploy.md', fragment: '#x' }],
    ['?plain=1', { kind: 'local', path: from, fragment: '' }],
    ['sub/', { kind: 'local', path: 'docs/guides/sub/README.md', fragment: '' }],
    ['/', { kind: 'local', path: 'README.md', fragment: '' }],
    ['img/logo.png', { kind: 'local', path: 'docs/guides/img/logo.png', fragment: '' }],
  ])('%s', (href, target) => {
    expect(resolveLink(from, href, 'posix')).toEqual(target);
  });

  it.each([
    '../../../secret.md',
    '../../../../etc/passwd',
    '%2e%2e/%2e%2e/%2e%2e/secret.md',
    '/../secret.md',
    'a%00.md',
    'bad%E0%A4%A.md',
  ])('reports %s as outside', (href) => {
    expect(resolveLink(from, href, 'posix')).toEqual({ kind: 'outside' });
  });

  it.each(['CON.md', 'C%3A%5Cwin.ini', 'x%3Aads.md', 'a%5Cb.md'])(
    'reports %s as outside on Windows only (legal names on POSIX)',
    (href) => {
      expect(resolveLink(from, href, 'windows')).toEqual({ kind: 'outside' });
      expect(resolveLink(from, href, 'posix')).toMatchObject({ kind: 'local' });
    },
  );
});
