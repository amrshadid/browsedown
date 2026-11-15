import { describe, expect, it } from 'vitest';

import { ancestorFolders, buildTree, type TreeNode } from '../../src/core';

/** Compact view: folders as `name/`, with children indented. */
function outline(nodes: readonly TreeNode[], indent = ''): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'folder'
      ? [`${indent}${node.name}/`, ...outline(node.children, `${indent}  `)]
      : [`${indent}${node.name}`],
  );
}

describe('buildTree', () => {
  it('nests paths, folders first, README first, case-insensitive and natural', () => {
    const tree = buildTree([
      'zeta.md',
      'Alpha.md',
      'README.md',
      'guides/10-deploy.md',
      'guides/2-setup.md',
      'guides/readme.md',
      'api/b.md',
      'Api2/a.md',
      'beta.md',
    ]);
    expect(outline(tree)).toEqual([
      'api/',
      '  b.md',
      'Api2/',
      '  a.md',
      'guides/',
      '  readme.md',
      '  2-setup.md',
      '  10-deploy.md',
      'README.md',
      'Alpha.md',
      'beta.md',
      'zeta.md',
    ]);
  });

  it('keeps full paths on every node', () => {
    const [folder] = buildTree(['docs/deep/a.md']);
    expect(folder).toEqual({
      kind: 'folder',
      name: 'docs',
      path: 'docs',
      children: [
        {
          kind: 'folder',
          name: 'deep',
          path: 'docs/deep',
          children: [{ kind: 'file', name: 'a.md', path: 'docs/deep/a.md' }],
        },
      ],
    });
  });

  it('ignores duplicates and empty segments, and is deterministic for case twins', () => {
    expect(outline(buildTree(['a.md', 'a.md', 'x//b.md', '', 'B.md', 'b.md']))).toEqual([
      'x/',
      '  b.md',
      'a.md',
      'B.md',
      'b.md',
    ]);
  });

  it('handles names with spaces and Unicode', () => {
    expect(outline(buildTree(['My Notes/café é.md']))).toEqual(['My Notes/', '  café é.md']);
  });
});

describe('ancestorFolders', () => {
  it('lists every folder above a file, outermost first', () => {
    expect(ancestorFolders('a/b/c.md')).toEqual(['a', 'a/b']);
    expect(ancestorFolders('c.md')).toEqual([]);
  });
});
