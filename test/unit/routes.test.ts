import { describe, expect, it } from 'vitest';

import { entryUrl, fileUrl, indexUrl, missingUrl, parseRoute } from '../../src/core';

const T = 'A'.repeat(43);

describe('parseRoute', () => {
  it.each([
    [`/s/${T}/`, { kind: 'entry', token: T }],
    [`/s/${T}/__index`, { kind: 'index', token: T }],
    [
      `/s/${T}/f/docs/My%20Notes/a.md`,
      { kind: 'file', token: T, encodedPath: 'docs/My%20Notes/a.md' },
    ],
    [`/s/${T}/f/a.md?x=1`, { kind: 'file', token: T, encodedPath: 'a.md' }],
    ['/__assets/page.css', { kind: 'asset', name: 'page.css' }],
    ['/favicon.ico', { kind: 'favicon' }],
  ])('%s', (target, route) => {
    expect(parseRoute(target)).toEqual(route);
  });

  it('keeps encoded traversal as sent, for the scope guard to reject', () => {
    expect(parseRoute(`/s/${T}/f/%2e%2e/%2e%2e/secret.md`)).toEqual({
      kind: 'file',
      token: T,
      encodedPath: '%2e%2e/%2e%2e/secret.md',
    });
  });

  it('reads the dead-link page parameters', () => {
    expect(parseRoute(missingUrl(T, '../x y.md', 'outside'))).toEqual({
      kind: 'missing',
      token: T,
      ref: '../x y.md',
      reason: 'outside',
    });
  });

  it.each([
    '',
    'http://evil/',
    '/',
    '/s/',
    '/s/short/',
    `/s/${T}`,
    `/s/${T}x/`,
    `/s/${T.slice(1)}!/`,
    `/s/${T}/f/`,
    `/s/${T}/other`,
    '/__assets/../package.json',
    '/__assets/extension.js',
  ])('treats %j as not found', (target) => {
    expect(parseRoute(target)).toEqual({ kind: 'not-found' });
  });
});

describe('URL builders', () => {
  it('encode every path segment and round-trip through parseRoute', () => {
    const url = fileUrl(T, 'docs/My Notes/café é#?.md');
    expect(url).toBe(`/s/${T}/f/docs/My%20Notes/caf%C3%A9%20%C3%A9%23%3F.md`);
    expect(parseRoute(url)).toMatchObject({ kind: 'file' });
    expect(entryUrl(T)).toBe(`/s/${T}/`);
    expect(indexUrl(T)).toBe(`/s/${T}/__index`);
  });
});
