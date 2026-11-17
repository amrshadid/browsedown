import { describe, expect, it } from 'vitest';

import {
  entryUrl,
  fileUrl,
  indexUrl,
  MERMAID_FRAME_PATH,
  missingUrl,
  parseRoute,
} from '../../src/core';

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
    ['/__mermaid', { kind: 'mermaid-frame' }],
    ['/__mermaid?x=1', { kind: 'mermaid-frame' }],
  ])('%s', (target, route) => {
    expect(parseRoute(target)).toEqual(route);
  });

  // The renderer frame is token-free and lives at exactly one path (ADR 0007).
  it.each(['/__mermaid/', '/__mermaidx', `/s/${T}/__mermaid`, '/__assets/mermaid.js'])(
    'does not serve the renderer at %s',
    (target) => {
      expect(parseRoute(target)).toEqual({ kind: 'not-found' });
    },
  );

  it('names the renderer path once', () => {
    expect(parseRoute(MERMAID_FRAME_PATH)).toEqual({ kind: 'mermaid-frame' });
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

describe('the dead-link reason', () => {
  it.each([
    ['outside', 'outside'],
    ['missing', 'missing'],
    ['hidden', 'hidden'],
    ['anything-else', 'outside'],
  ])('why=%s reads as %s', (why, reason) => {
    expect(parseRoute(`/s/${T}/__missing?ref=x&why=${why}`)).toEqual({
      kind: 'missing',
      token: T,
      ref: 'x',
      reason,
    });
  });

  it('round-trips through missingUrl', () => {
    expect(parseRoute(missingUrl(T, 'docs/bugs/a.md', 'hidden'))).toMatchObject({
      reason: 'hidden',
      ref: 'docs/bugs/a.md',
    });
  });
});
