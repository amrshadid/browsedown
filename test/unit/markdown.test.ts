import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { render, type RenderContext } from '../../src/render/markdown';

const fixtures = join(__dirname, '..', 'fixtures', 'render');
const read = (name: string): string => readFileSync(join(fixtures, name), 'utf8');

/** A fixed rewrite, so the golden output doesn't depend on a session token. */
const fixedContext: RenderContext = { rewriteUrl: (url) => `/TOKEN/root/${url}` };

describe('render', () => {
  // The golden file pins the whole pipeline: plugin order, sanitizing, slugs,
  // alerts, footnotes and highlighting. A change here must be a reviewed change.
  it('matches the golden HTML for the adversarial sample', () => {
    const { html } = render(read('adversarial-sample.md'), fixedContext);
    expect(html).toBe(read('adversarial-sample.html'));
  });

  describe('sanitizes documents', () => {
    const { html } = render(read('adversarial-sample.md'), fixedContext);

    it.each([
      ['<script', 'script elements'],
      ['onerror', 'event handler attributes'],
      ['javascript:', 'javascript: URLs'],
      ['alert(1)', 'script payloads'],
    ])('drops %s (%s)', (needle) => {
      expect(html).not.toContain(needle);
    });

    it('keeps harmless raw HTML', () => {
      expect(html).toContain('<details><summary>S</summary>hidden</details>');
    });
  });

  it('gives duplicate headings GitHub-style ids', () => {
    const { headings } = render('# Hello World\n## Hello World\n## Hello World\n', fixedContext);
    expect(headings).toEqual([
      { depth: 1, id: 'hello-world', text: 'Hello World' },
      { depth: 2, id: 'hello-world-1', text: 'Hello World' },
      { depth: 2, id: 'hello-world-2', text: 'Hello World' },
    ]);
  });

  it('reports every heading level with its text', () => {
    const source = '# A\n## B\n### C `d`\n#### E\n##### F\n###### G\n';
    const { headings } = render(source, fixedContext);
    expect(headings.map((h) => [h.depth, h.text])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'C d'],
      [4, 'E'],
      [5, 'F'],
      [6, 'G'],
    ]);
  });

  it('renders alerts with their octicon', () => {
    const { html } = render('> [!TIP]\n> Body.\n', fixedContext);
    expect(html).toContain('<div class="markdown-alert markdown-alert-tip" dir="auto">');
    expect(html).toContain('<svg class="octicon"');
  });

  it('keeps footnote links consistent', () => {
    const { html } = render('Ref[^a].\n\n[^a]: Note.\n', fixedContext);
    expect(html).toContain('href="#user-content-fn-a"');
    expect(html).toContain('id="user-content-fn-a"');
  });

  describe('URLs', () => {
    it('rewrites only local URLs, in document order', () => {
      const seen: string[] = [];
      const ctx: RenderContext = {
        rewriteUrl: (url) => {
          seen.push(url);
          return `/x/${url}`;
        },
      };
      const { html } = render(
        '[a](a.md#s) [b](#top) [c](https://example.com) [d](mailto:a@b.c) ![e](img/e%20f.png)',
        ctx,
      );
      expect(seen).toEqual(['a.md#s', 'img/e%20f.png']);
      expect(html).toContain('href="/x/a.md#s"');
      expect(html).toContain('href="#top"');
      expect(html).toContain('src="/x/img/e%20f.png"');
    });

    it('opens absolute links in a new tab without a referrer', () => {
      const { html } = render('[c](https://example.com)', fixedContext);
      expect(html).toContain(
        '<a href="https://example.com" rel="noopener noreferrer" target="_blank">',
      );
    });
  });

  describe('remote images (no network requests)', () => {
    it.each(['https://img.shields.io/badge.svg', 'http://x/y.png', '//cdn.example/z.png'])(
      'replaces %s with a labelled placeholder',
      (src) => {
        const seen: string[] = [];
        const { html } = render(`![build status](${src})`, {
          rewriteUrl: (url) => {
            seen.push(url);
            return url;
          },
        });
        expect(html).not.toContain('<img');
        expect(html).toContain('<span class="bd-remote-image"');
        expect(html).toContain('>build status</span>');
        expect(seen).toEqual([]);
      },
    );

    it('keeps local images', () => {
      expect(render('![logo](img/logo.png)', fixedContext).html).toContain(
        '<img src="/TOKEN/root/img/logo.png" alt="logo">',
      );
    });

    it('labels a remote image without alt text', () => {
      expect(render('![](https://x/y.png)', fixedContext).html).toContain('>Remote image</span>');
    });
  });

  it('treats protocol-relative links as external', () => {
    expect(render('[x](//example.com/a)', fixedContext).html).toContain(
      'href="//example.com/a" rel="noopener noreferrer" target="_blank"',
    );
  });

  it('prefixes name attributes, so a document cannot shadow document methods', () => {
    const { html } = render(
      '<img name="querySelectorAll" src="a.png"> <a name="addEventListener">x</a>',
      fixedContext,
    );
    expect(html).not.toMatch(/name="(querySelectorAll|addEventListener)"/);
    expect(html).toContain('name="user-content-querySelectorAll"');
  });

  it('keeps heading ids unprefixed, so #anchors match', () => {
    expect(render('## Install', fixedContext).html).toContain('<h2 id="install">');
  });

  it('is independent across calls', () => {
    const first = render('# One\n## Two', fixedContext);
    const second = render('# Only a heading', fixedContext);
    expect(first.headings).toHaveLength(2);
    expect(second.headings).toHaveLength(1);
  });
});

describe('Mermaid diagrams', () => {
  // Pins the diagram markup the page script and the server's CSP depend on (ADR 0007).
  it('matches the golden HTML for the Mermaid sample', () => {
    const { html, hasMermaid } = render(read('mermaid-sample.md'), fixedContext);
    expect(html).toBe(read('mermaid-sample.html'));
    expect(hasMermaid).toBe(true);
  });

  it('wraps a fence in the diagram figure, unhighlighted', () => {
    const { html } = render('```mermaid\ngraph TD; A-->B\n```\n', fixedContext);
    expect(html).toBe(
      '<figure class="bd-mermaid"><pre><code class="language-mermaid">graph TD; A-->B\n</code></pre></figure>',
    );
  });

  it('reports no diagram for documents without one', () => {
    expect(render('# Hi\n\n```js\nx\n```\n', fixedContext).hasMermaid).toBe(false);
    expect(render('Text about `mermaid`.\n', fixedContext).hasMermaid).toBe(false);
  });

  it('keeps diagram text as escaped code', () => {
    const { html } = render('```mermaid\nA["<script>alert(1)</script>"]\n```\n', fixedContext);
    expect(html).not.toContain('<script');
    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>');
  });

  it('never lets a document fake the diagram wrapper', () => {
    const { html, hasMermaid } = render(
      '<figure class="bd-mermaid"><p>x</p></figure>\n',
      fixedContext,
    );
    expect(html).not.toContain('bd-mermaid');
    expect(hasMermaid).toBe(false);
  });
});
