import { describe, expect, it } from 'vitest';

import { renderMermaidFrame } from '../../src/core';

describe('renderMermaidFrame', () => {
  it('inlines the library and then the renderer, both with the nonce', () => {
    const html = renderMermaidFrame('abc+/=', 'var mermaid = {};', 'start();');
    expect(html.match(/<script\b[^>]*>/g)).toEqual([
      '<script nonce="abc+/=">',
      '<script nonce="abc+/=">',
    ]);
    expect(html.indexOf('var mermaid = {};')).toBeLessThan(html.indexOf('start();'));
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  it.each(['', 'a b', 'a"b', "a'b", 'a<b'])('rejects the nonce %j', (nonce) => {
    expect(() => renderMermaidFrame(nonce, '', '')).toThrow(/invalid nonce/);
  });

  // Inlined scripts must not be able to end their own <script> element early.
  it.each([
    ['</script>', 'library'],
    ['</SCRIPT >', 'library'],
    ['<!--<script>', 'library'],
    ['x = "</script"', 'renderer'],
  ])('refuses a script containing %s (%s)', (text, which) => {
    const [library, renderer] = which === 'library' ? [text, ''] : ['', text];
    expect(() => renderMermaidFrame('n0nce', library, renderer)).toThrow(/end it early/);
  });

  it('allows a lone HTML comment opener, which Mermaid’s build contains', () => {
    expect(() => renderMermaidFrame('n0nce', 'a = "<!--";', '')).not.toThrow();
  });
});
