/**
 * Discovery against a real repository built at test time: one test per row of the
 * ignore table in the README.
 */
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverFolder } from '../../src/adapters/discovery';
import { walkFolder } from '../../src/adapters/walker';
import {
  createIgnoreTableRepo,
  EMPTY_GIT_CONFIG,
  IGNORE_TABLE,
  type IgnoreTableRepo,
} from '../support/ignoreTableRepo';

/** Repo-relative paths → paths relative to the opened folder. */
const under = (root: string, paths: readonly string[]): string[] =>
  paths.map((p) => p.slice(root.length + 1)).sort();

describe('discoverFolder', () => {
  let repo: IgnoreTableRepo;
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    noSystem: process.env.GIT_CONFIG_NOSYSTEM,
  };

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    repo = createIgnoreTableRepo();
  });
  afterAll(() => {
    repo.cleanup();
    for (const [key, value] of [
      ['GIT_CONFIG_GLOBAL', saved.global],
      ['GIT_CONFIG_NOSYSTEM', saved.noSystem],
    ] as const) {
      if (value === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restoring the environment
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('row 1: a normal folder lists tracked and non-ignored untracked Markdown (git)', async () => {
    const { root, listed } = IGNORE_TABLE.normalFolder;
    const result = await discoverFolder(join(repo.root, root), { trusted: true });
    expect(result.discovery).toBe('git');
    // The escape symlink and the deleted file are gone; ignored files stay out.
    expect([...result.files].sort()).toEqual(under(root, listed));
  });

  it('row 3: an explicitly opened ignored folder is walked with its own rules', async () => {
    const { root, listed } = IGNORE_TABLE.ignoredFolder;
    const result = await discoverFolder(join(repo.root, root), { trusted: true });
    // It holds force-added files, so without --no-index git would call it "not ignored".
    expect(result.discovery).toBe('walk');
    expect([...result.files].sort()).toEqual(under(root, listed));
  });

  it('row 3: an ignored folder below an ignored parent', async () => {
    const { root, listed } = IGNORE_TABLE.ignoredUnderIgnoredAncestor;
    const result = await discoverFolder(join(repo.root, root), { trusted: true });
    expect(result.discovery).toBe('walk');
    expect([...result.files].sort()).toEqual(under(root, listed));
  });

  it('row 3: a folder hidden by a content-shaped rule (dir/**)', async () => {
    const { root, listed } = IGNORE_TABLE.contentRuleRoot;
    const result = await discoverFolder(join(repo.root, root), { trusted: true });
    expect(result.discovery).toBe('walk');
    expect([...result.files].sort()).toEqual(under(root, listed));
  });

  it('untrusted workspace: never runs git; walks with in-folder rules only', async () => {
    const { root } = IGNORE_TABLE.normalFolder;
    const result = await discoverFolder(join(repo.root, root), { trusted: false });
    expect(result.discovery).toBe('walk');
    // Rules outside the opened folder don't apply, so the root-ignored file appears.
    expect(result.files).toContain('ignored.md');
    expect(result.files).not.toContain('gone.md');
    expect(result.files).not.toContain('link-out.md');
  });

  it('a folder outside git is walked', async () => {
    const result = await discoverFolder(repo.outside, { trusted: true });
    expect(result).toEqual({ files: ['secret.md'], discovery: 'walk', truncated: false });
  });
});

describe('walkFolder', () => {
  let repo: IgnoreTableRepo;
  beforeAll(() => {
    repo = createIgnoreTableRepo();
  });
  afterAll(() => {
    repo.cleanup();
  });

  it('skips .git, applies in-folder rules and never follows folder symlinks', async () => {
    const { files } = await walkFolder(repo.root);
    expect(files.some((f) => f.startsWith('.git/'))).toBe(false);
    expect(files).not.toContain('.agent/drafts/x.md');
    expect(files.some((f) => f.startsWith('docs/linkdir/'))).toBe(false);
  });

  it('stops at the cap and says so', async () => {
    const result = await walkFolder(repo.root, 5);
    expect(result.truncated).toBe(true);
    expect(result.files.length).toBeLessThanOrEqual(5);
  });
});
