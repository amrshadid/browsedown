/**
 * The docs sidebar's discovery (ADR 0008) against a real repository built at test
 * time: the same list as a folder preview by default, and with "Show ignored
 * folders" the Markdown git ignores, each ignored folder read with its own rules.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverDocs, discoverFolder } from '../../src/adapters/discovery';
import { GitIgnore } from '../../src/adapters/gitIgnore';
import {
  createIgnoreTableRepo,
  EMPTY_GIT_CONFIG,
  ESCAPE_LINKS,
  IGNORE_TABLE,
  type IgnoreTableRepo,
} from '../support/ignoreTableRepo';

describe('discoverDocs', () => {
  let repo: IgnoreTableRepo;
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    noSystem: process.env.GIT_CONFIG_NOSYSTEM,
  };

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    repo = createIgnoreTableRepo();
    // Installed packages are ignored, and full of READMEs nobody opened them for.
    mkdirSync(join(repo.root, 'node_modules', 'pkg', 'docs'), { recursive: true });
    writeFileSync(join(repo.root, 'node_modules', 'pkg', 'README.md'), '# pkg\n');
    writeFileSync(join(repo.root, 'node_modules', 'pkg', 'docs', 'api.md'), '# api\n');
    appendFileSync(join(repo.root, '.gitignore'), 'node_modules/\n');
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

  const sorted = (files: readonly string[]): string[] => [...files].sort();

  it('lists what a folder preview lists, by default', async () => {
    const docs = await discoverDocs(repo.root, { trusted: true, includeIgnored: false });
    const folder = await discoverFolder(repo.root, { trusted: true });
    expect(sorted(docs.files)).toEqual(sorted(folder.files));
    expect(docs.files).not.toContain(IGNORE_TABLE.ignoredFile.file);
    expect(docs.files.some((file) => file.startsWith('node_modules/'))).toBe(false);
  });

  it('adds ignored Markdown, reading each ignored folder with its own rules', async () => {
    const off = await discoverDocs(repo.root, { trusted: true, includeIgnored: false });
    const on = await discoverDocs(repo.root, { trusted: true, includeIgnored: true });
    expect(on.discovery).toBe('git');
    expect(sorted(on.files.filter((file) => !off.files.includes(file)))).toEqual([
      '.agent/notes.md',
      '.agent/plan.md',
      '.agent/sub/y.md',
      'docs/ignored.md',
      'notes/private/n.md',
      'scratch/s.md',
    ]);
    // The same folders opened explicitly list the same files (rows 3 of the table).
    for (const row of [
      IGNORE_TABLE.ignoredFolder,
      IGNORE_TABLE.ignoredUnderIgnoredAncestor,
      IGNORE_TABLE.contentRuleRoot,
    ]) {
      for (const file of row.listed) {
        expect(on.files, file).toContain(file);
      }
      for (const file of row.hidden) {
        expect(on.files, file).not.toContain(file);
      }
    }
  });

  it('never enters node_modules or .git, even when showing ignored folders', async () => {
    const on = await discoverDocs(repo.root, { trusted: true, includeIgnored: true });
    expect(on.files.filter((file) => /(^|\/)(node_modules|\.git)\//.test(file))).toEqual([]);
  });

  it('adds nothing in an untrusted workspace, where git never runs', async () => {
    const off = await discoverDocs(repo.root, { trusted: false, includeIgnored: false });
    const on = await discoverDocs(repo.root, { trusted: false, includeIgnored: true });
    expect(off.discovery).toBe('walk');
    expect(sorted(on.files)).toEqual(sorted(off.files));
  });

  it('adds nothing for an ignored root, which was walked whole already', async () => {
    const root = join(repo.root, IGNORE_TABLE.ignoredFolder.root);
    const off = await discoverDocs(root, { trusted: true, includeIgnored: false });
    const on = await discoverDocs(root, { trusted: true, includeIgnored: true });
    expect(sorted(on.files)).toEqual(sorted(off.files));
  });

  it('keeps symlinks that lead out of the folder out of the list', async () => {
    if (!repo.symlinks) {
      return; // No symlink rights (Windows): covered by scopedFile.test.ts.
    }
    const on = await discoverDocs(repo.root, { trusted: true, includeIgnored: true });
    expect(on.files).not.toContain(ESCAPE_LINKS.file);
    expect(on.files.some((file) => file.startsWith(`${ESCAPE_LINKS.dir}/`))).toBe(false);
  });
});

describe('GitIgnore ignored listings', () => {
  let repo: IgnoreTableRepo;

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    repo = createIgnoreTableRepo();
  });
  afterAll(() => {
    repo.cleanup();
  });

  it('lists ignored entries, collapsing fully ignored folders', async () => {
    const git = await GitIgnore.detect(repo.root);
    const entries = await git!.listIgnored();
    expect(entries).toContain('notes/'); // Nothing tracked inside: collapsed.
    expect(entries).toContain('docs/ignored.md');
    // `.agent/` holds force-added files, so its ignored contents are listed instead.
    expect(entries).not.toContain('.agent/');
    expect(entries).toContain('.agent/notes.md');
  });

  it('judges folders from the rules alone (--no-index)', async () => {
    const git = await GitIgnore.detect(repo.root);
    expect(sorted(await git!.ignoredFolders(['.agent/', 'notes/', 'docs/', 'docs/deep/']))).toEqual(
      ['.agent/', 'notes/'],
    );
    expect(await git!.ignoredFolders(['docs/'])).toEqual([]);
    expect(await git!.ignoredFolders([])).toEqual([]);
  });

  const sorted = (files: readonly string[]): string[] => [...files].sort();
});
