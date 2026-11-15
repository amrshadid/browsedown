/**
 * Proves the fixture repository really has the shape IGNORE_TABLE claims, using
 * git itself. Discovery (M1) is then tested against these expectations.
 */
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createIgnoreTableRepo,
  ESCAPE_LINKS,
  git,
  IGNORE_TABLE,
  type IgnoreTableRepo,
} from '../support/ignoreTableRepo';

const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path);
const splitNul = (out: string): string[] =>
  out
    .split('\0')
    .filter((p) => p.length > 0)
    .map((p) => p.normalize('NFC'));

function checkIgnoreExitCode(cwd: string, rel: string, ...flags: string[]): number {
  try {
    git(cwd, 'check-ignore', '-q', ...flags, `${rel}/`);
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe('ignore-table fixture repository', () => {
  let repo: IgnoreTableRepo;
  beforeAll(() => {
    repo = createIgnoreTableRepo();
  });
  afterAll(() => {
    repo.cleanup();
  });

  it('lists the normal folder the way git discovery will', () => {
    const { root, listed } = IGNORE_TABLE.normalFolder;
    const all = splitNul(
      git(
        repo.root,
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        `${root}/`,
      ),
    );
    const deleted = new Set(
      splitNul(git(repo.root, 'ls-files', '-z', '--deleted', '--', `${root}/`)),
    );
    const markdown = [...new Set(all)].filter((p) => isMarkdown(p) && !deleted.has(p)).sort();

    // git lists a file symlink like any untracked file, even one pointing outside
    // the repo. Discovery must drop it with the disk half of the scope guard.
    const expected = repo.symlinks ? [...listed, ESCAPE_LINKS.file] : [...listed];
    expect(markdown).toEqual(expected.sort());
  });

  it('keeps the hidden normal-folder entries out of git discovery', () => {
    const all = splitNul(git(repo.root, 'ls-files', '-z', '--others', '--exclude-standard'));
    for (const hidden of IGNORE_TABLE.normalFolder.hidden) {
      expect(all).not.toContain(hidden);
    }
    expect(existsSync(join(repo.root, 'docs/ignored.md'))).toBe(true);
    expect(existsSync(join(repo.root, 'docs/gone.md'))).toBe(false);
  });

  it.each(IGNORE_TABLE.ignoredRoots)('reports %s as an ignored root with --no-index', (root) => {
    expect(checkIgnoreExitCode(repo.root, root, '--no-index')).toBe(0);
  });

  it.each(IGNORE_TABLE.notIgnoredRoots)('reports %s as not ignored with --no-index', (root) => {
    expect(checkIgnoreExitCode(repo.root, root, '--no-index')).toBe(1);
  });

  // Trap found while building this fixture: check-ignore consults the index, so
  // a single force-added file under an ignored folder makes `<root>/` look not
  // ignored. Discovery therefore asks with `--no-index`.
  it('reports .agent as NOT ignored without --no-index, because it holds tracked files', () => {
    expect(checkIgnoreExitCode(repo.root, '.agent')).toBe(1);
    expect(checkIgnoreExitCode(repo.root, 'notes/private')).toBe(0);
  });

  it('tracks the force-added files inside the ignored root (the walker union)', () => {
    const tracked = splitNul(git(repo.root, 'ls-files', '-z', '--cached', '--', '.agent/'));
    expect(tracked.sort()).toEqual(['.agent/drafts/forced.md', '.agent/tracked.md']);
  });

  it('has every walker-row file on disk, listed and hidden', () => {
    const rows = [
      IGNORE_TABLE.ignoredFolder,
      IGNORE_TABLE.ignoredUnderIgnoredAncestor,
      IGNORE_TABLE.contentRuleRoot,
    ];
    for (const row of rows) {
      for (const rel of [...row.listed, ...row.hidden]) {
        expect(existsSync(join(repo.root, rel)), rel).toBe(true);
      }
    }
    expect(existsSync(join(repo.root, IGNORE_TABLE.ignoredFile.file))).toBe(true);
  });

  it('has the linked ignored targets inside the docs scope', () => {
    for (const target of IGNORE_TABLE.linkedIgnored.targets) {
      expect(existsSync(join(repo.root, target)), target).toBe(true);
    }
  });

  it('creates escape symlinks that point outside the repo when the OS allows it', () => {
    if (!repo.symlinks) {
      return;
    }
    expect(lstatSync(join(repo.root, ESCAPE_LINKS.file)).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(repo.root, ESCAPE_LINKS.dir)).isSymbolicLink()).toBe(true);
    expect(repo.outside.startsWith(repo.root)).toBe(false);
  });
});
