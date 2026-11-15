import { describe, expect, it } from 'vitest';

import { applyDiscovery, findRootReadme, SessionStore, type Session } from '../../src/core';

const session = (token: string): Session => ({
  token,
  mode: 'folder',
  scopeRoot: '/r',
  scopeName: 'r',
  entry: undefined,
  files: [],
  tree: [],
  treeHtml: undefined,
  discovery: undefined,
  truncated: false,
  fresh: false,
});

describe('SessionStore', () => {
  it('finds sessions through the injected comparison, and clears them', () => {
    const compared: string[] = [];
    const store = new SessionStore((a, b) => {
      compared.push(a);
      return a === b;
    });
    store.add(session('one'));
    store.add(session('two'));
    expect(store.find('one')?.token).toBe('one');
    expect(compared).toEqual(['one', 'two']); // Compares against every session.
    expect(store.find('three')).toBeUndefined();
    expect(store.size).toBe(2);
    store.clear();
    expect(store.find('one')).toBeUndefined();
  });
});

describe('findRootReadme', () => {
  it('finds a root README in any case, never a nested one', () => {
    expect(findRootReadme(['a.md', 'Readme.MD'])).toBe('Readme.MD');
    expect(findRootReadme(['docs/README.md'])).toBeUndefined();
    expect(findRootReadme(['readme.markdown'])).toBe('readme.markdown');
  });
});

describe('applyDiscovery', () => {
  it('stores the files and rebuilds the tree', () => {
    const s = session('x');
    applyDiscovery(s, { files: ['b/c.md', 'a.md'], discovery: 'git', truncated: true });
    expect(s.files).toEqual(['b/c.md', 'a.md']);
    expect(s.tree?.map((n) => n.name)).toEqual(['b', 'a.md']);
    expect(s.discovery).toBe('git');
    expect(s.truncated).toBe(true);
    expect(s.fresh).toBe(true);
    expect(s.treeHtml).toContain('href="/s/x/f/b/c.md"');
  });
});
