import { describe, expect, it } from 'vitest';

import { renderYaml } from '../../src/render/yaml';

describe('renderYaml', () => {
  it('highlights YAML inside pre/code with highlight.js classes', () => {
    const html = renderYaml('name: browsedown\ncount: 2\n');
    expect(html.startsWith('<pre><code class="hljs language-yaml">')).toBe(true);
    expect(html).toContain('<span class="hljs-attr">name:</span>');
    expect(html.endsWith('</code></pre>')).toBe(true);
  });

  it('escapes markup in the source', () => {
    const html = renderYaml('x: "<script>alert(1)</script>"\n');
    expect(html).not.toContain('<script');
    expect(html).toContain('&#x3C;script>');
  });
});
