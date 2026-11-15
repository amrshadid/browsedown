/**
 * YAML files are shown as highlighted source, never interpreted. Highlighting uses
 * classes only (no inline styles), so the strict CSP holds.
 */
import type { Root } from 'hast';
import { common, createLowlight } from 'lowlight';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

const yaml = common.yaml;
if (yaml === undefined) {
  throw new Error('lowlight: the YAML grammar is missing from the common set');
}
const lowlight = createLowlight({ yaml });
const stringify = unified().use(rehypeStringify).freeze();

/** Returns `<pre><code class="hljs language-yaml">…</code></pre>`. Pure; text is escaped. */
export function renderYaml(source: string): string {
  const highlighted = lowlight.highlight('yaml', source);
  const tree: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['hljs', 'language-yaml'] },
            children: highlighted.children.filter((child) => child.type !== 'doctype'),
          },
        ],
      },
    ],
  };
  return stringify.stringify(tree);
}
