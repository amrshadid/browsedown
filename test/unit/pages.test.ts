import { describe, expect, it } from 'vitest';

import {
  buildTree,
  markTree,
  renderIndexBody,
  renderMissingBody,
  renderPage,
  renderTreeList,
  type PageOptions,
} from '../../src/core';
import { escapeHtml } from '../../src/core/html';

const hrefFor = (path: string): string =>
  `/s/T/f/${path.split('/').map(encodeURIComponent).join('/')}`;

const base: PageOptions = {
  scopeName: 'docs',
  currentPath: 'guides/setup.md',
  bodyHtml: '<h1 id="setup">Setup</h1><p>Hello</p>',
  headings: [
    { depth: 1, id: 'setup', text: 'Setup' },
    { depth: 2, id: 'install', text: 'Install' },
    { depth: 2, id: 'footnote-label', text: 'Footnotes' },
  ],
  treeHtml: renderTreeList(
    buildTree(['README.md', 'guides/setup.md', 'guides/deploy.md']),
    hrefFor,
  ),
  currentHref: hrefFor('guides/setup.md'),
  homeHref: '/s/T/',
  assetBase: '/__assets',
  nonce: 'abc123_-',
  stateKey: 'mt:T',
};

/**
 * Event-handler attributes in real tags. Attribute values are blanked first:
 * the template double-quotes every value and escaping turns `"` into `&quot;`,
 * so text like `onerror=` inside a value can't close the quote and is harmless.
 */
function eventAttributes(html: string): string[] {
  return html.replace(/"[^"]*"/g, '""').match(/<[^>]*\son[a-z]+=/gi) ?? [];
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('renderPage', () => {
  const html = renderPage(base);

  it('loads only the nonced sidebar script, and no inline script or style', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual(['<script nonce="abc123_-" src="/__assets/sidebar.js">']);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(eventAttributes(html)).toEqual([]);
  });

  it('links the stylesheets from the asset base', () => {
    for (const css of ['github-markdown.css', 'highlight.css', 'page.css']) {
      expect(html).toContain(`<link rel="stylesheet" href="/__assets/${css}">`);
    }
  });

  it('inserts the sanitized body as is, inside the markdown-body article', () => {
    expect(html).toContain(
      '<article class="markdown-body">\n<h1 id="setup">Setup</h1><p>Hello</p>\n</article>',
    );
  });

  it('marks the current file and opens its folders', () => {
    expect(html).toContain('href="/s/T/f/guides/setup.md" aria-current="page"');
    expect(html).toContain('<details data-bd-folder="guides" open>');
  });

  it('builds breadcrumbs from the scope name and path', () => {
    expect(html).toMatch(
      /href="\/s\/T\/">docs<\/a>.*<span>guides<\/span>.*aria-current="page">setup\.md</s,
    );
  });

  it('lists headings in the outline, without the footnotes label', () => {
    expect(html).toContain('href="#setup" data-bd-heading="setup">Setup</a>');
    expect(html).toContain('data-depth="1" href="#install"');
    expect(html).not.toContain('data-bd-heading="footnote-label"');
  });

  it('offers a toggle and a close button for each panel', () => {
    for (const panel of ['tree', 'outline']) {
      expect(html).toContain(`data-bd-toggle="${panel}"`);
      expect(html).toContain(`data-bd-close="${panel}"`);
      expect(html).toContain(`data-bd-panel="${panel}"`);
    }
  });

  it('has no tree in file mode and no outline without headings', () => {
    const page = renderPage({ ...base, treeHtml: undefined, headings: [] });
    expect(page).not.toContain('data-bd-panel');
    expect(page).not.toContain('data-bd-toggle');
    expect(page).not.toContain('data-bd-has-tree');
  });

  it('escapes hostile file names, folder names, headings and labels', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const page = renderPage({
      ...base,
      scopeName: evil,
      currentPath: `${evil}/${evil}.md`,
      treeHtml: renderTreeList(buildTree([`${evil}/${evil}.md`]), hrefFor),
      currentHref: hrefFor(`${evil}/${evil}.md`),
      headings: [{ depth: 1, id: evil, text: evil }],
      label: evil,
      stateKey: evil,
      bodyHtml: '',
    });
    // Present only as escaped text, never as a tag or an attribute inside a tag.
    expect(page).not.toContain('<img');
    expect(eventAttributes(page)).toEqual([]);
    expect(page).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('detects a real event attribute (the helper itself works)', () => {
    expect(eventAttributes('<img src="x" onerror="y">')).toHaveLength(1);
  });

  it.each(['', 'a b', 'x"y', 'n<'])('refuses an unsafe nonce %j', (nonce) => {
    expect(() => renderPage({ ...base, nonce })).toThrow('invalid nonce');
  });
});

describe('renderPage theme switch', () => {
  it('offers the theme switch with one icon per choice, in every mode', () => {
    for (const page of [
      renderPage(base),
      renderPage({ ...base, treeHtml: undefined, headings: [] }),
    ]) {
      expect(page).toContain('data-bd-theme-toggle');
      for (const theme of ['system', 'light', 'dark']) {
        expect(page).toContain(`bd-icon-theme-${theme}`);
      }
    }
  });
});

describe('generated pages', () => {
  it('lists files in the index, linked and escaped, with folders', () => {
    const body = renderIndexBody(
      buildTree(['a.md', 'g/<b>.md']),
      (p) => `/f/${encodeURIComponent(p)}`,
      false,
    );
    expect(body).toContain('<strong>g/</strong>');
    expect(body).toContain('<a href="/f/g%2F%3Cb%3E.md">&lt;b&gt;.md</a>');
    expect(body).not.toContain('markdown-alert-warning');
  });

  it('says when the index was cut short, and when a folder has no Markdown', () => {
    expect(renderIndexBody([], (p) => p, true)).toContain('markdown-alert-warning');
    expect(renderIndexBody([], (p) => p, false)).toContain('This folder has no Markdown files.');
  });

  it('explains a dead link honestly, escaping the reference', () => {
    const outside = renderMissingBody('../<x>.md', 'outside', 'docs');
    expect(outside).toContain('<code>../&lt;x&gt;.md</code>');
    expect(outside).toContain('points outside <strong>docs</strong>');
    expect(renderMissingBody('gone.md', 'missing', 'docs')).toContain("doesn't exist");
  });
});

describe('the tree markup', () => {
  const tree = buildTree(['a.md', 'g/b.md', 'g/h/c.md', 'g/b.md.bak/d.md']);
  const html = renderTreeList(tree, hrefFor);

  it('keeps rows small: icons are painted by CSS, not inlined per row', () => {
    expect(html).not.toContain('<svg');
    expect(html).toContain('<span class="bd-i-file"></span>');
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain(' open');
  });

  it('marks exactly the current file and opens exactly its folders', () => {
    const marked = markTree(html, hrefFor('g/h/c.md'), 'g/h/c.md');
    expect(marked.match(/aria-current="page"/g)).toHaveLength(1);
    expect(marked).toContain(`href="${hrefFor('g/h/c.md')}" aria-current="page"`);
    expect(marked).toContain('data-bd-folder="g" open');
    expect(marked).toContain('data-bd-folder="g/h" open');
    expect(marked).not.toContain('data-bd-folder="g/b.md.bak" open');
  });

  it('never matches a longer path that starts the same way', () => {
    const marked = markTree(html, hrefFor('g/b.md'), 'g/b.md');
    expect(marked.match(/aria-current="page"/g)).toHaveLength(1);
    expect(marked).toContain(`href="${hrefFor('g/b.md')}" aria-current="page"`);
  });

  it('is empty for an empty tree', () => {
    expect(renderTreeList([], hrefFor)).toBe('');
  });

  it('stays compact for a large folder', () => {
    const paths = Array.from({ length: 20_000 }, (_, i) => `s${i % 200}/page-${i}.md`);
    const big = renderTreeList(buildTree(paths), (p) => `/s/${'T'.repeat(43)}/f/${p}`);
    // Under 180 bytes a row: less than half of what inline SVG icons cost (~440).
    expect(big.length / paths.length).toBeLessThan(180);
  });
});
