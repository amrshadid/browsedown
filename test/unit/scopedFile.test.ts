import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  isStrictlyInside,
  pathFlavor,
  resolveRequestPath,
  type ScopedFileDeps,
} from '../../src/adapters/scopedFile';
import {
  createIgnoreTableRepo,
  ESCAPE_LINKS,
  type IgnoreTableRepo,
} from '../support/ignoreTableRepo';

/** Where an encoded request path really leads (both halves of the guard), or undefined. */
async function realOf(
  root: string,
  encoded: string,
  deps?: ScopedFileDeps,
): Promise<string | undefined> {
  return (await resolveRequestPath(root, encoded, deps))?.real;
}

describe('isStrictlyInside', () => {
  it.each([
    // POSIX: exact, segment-wise.
    ['/repo', '/repo/a.md', 'linux', true],
    ['/repo', '/repo/docs/deep/a.md', 'linux', true],
    ['/repo', '/repo/..notes/a.md', 'linux', true],
    ['/repo', '/repo', 'linux', false],
    ['/repo', '/repo2/a.md', 'linux', false],
    ['/repo', '/a.md', 'linux', false],
    ['/repo', '/Repo/a.md', 'linux', false],
    // macOS: exact. Native real paths carry the on-disk case, so this is also right
    // on a case-sensitive volume, where /v/docs is a different folder from /v/Docs.
    ['/repo', '/repo/a.md', 'darwin', true],
    ['/v/Docs', '/v/docs/secret.md', 'darwin', false],
    // Windows: case-insensitive, drive-aware, UNC-aware.
    ['C:\\Repo', 'c:\\repo\\docs\\a.md', 'win32', true],
    ['C:\\Repo', 'C:\\Repo', 'win32', false],
    ['C:\\Repo', 'C:\\Repo2\\a.md', 'win32', false],
    ['C:\\Repo', 'C:\\a.md', 'win32', false],
    ['C:\\Repo', 'D:\\Repo\\a.md', 'win32', false],
    ['\\\\server\\share\\repo', '\\\\server\\share\\repo\\a.md', 'win32', true],
    ['\\\\server\\share\\repo', '\\\\other\\share\\repo\\a.md', 'win32', false],
  ] as const)('%s ⊃ %s on %s → %s', (root, target, platform, inside) => {
    expect(isStrictlyInside(root, target, platform)).toBe(inside);
  });
});

describe('pathFlavor', () => {
  it('uses Windows rules only on win32', () => {
    expect(pathFlavor('win32')).toBe('windows');
    expect(pathFlavor('darwin')).toBe('posix');
    expect(pathFlavor('linux')).toBe('posix');
  });
});

describe('resolveRequestPath with Windows semantics (injected)', () => {
  // A fake file system: one real file, one symlink that escapes.
  const links: Record<string, string> = {
    'C:\\Repo': 'C:\\Repo',
    'C:\\Repo\\a.md': 'C:\\Repo\\a.md',
    'C:\\Repo\\link.md': 'C:\\Outside\\secret.md',
  };
  const deps: ScopedFileDeps = {
    platform: 'win32',
    realpath: (p) => {
      const real = links[p];
      return real === undefined ? Promise.reject(new Error(`ENOENT ${p}`)) : Promise.resolve(real);
    },
    isFile: () => Promise.resolve(true),
  };

  it('resolves a file inside the root', async () => {
    expect(await realOf('C:\\Repo', 'a.md', deps)).toBe('C:\\Repo\\a.md');
  });

  it('rejects a symlink that leads outside', async () => {
    expect(await realOf('C:\\Repo', 'link.md', deps)).toBeUndefined();
  });

  it('rejects device names before touching the file system', async () => {
    const touched: string[] = [];
    const spy: ScopedFileDeps = {
      ...deps,
      realpath: (p) => {
        touched.push(p);
        return deps.realpath(p);
      },
    };
    expect(await realOf('C:\\Repo', 'CON', spy)).toBeUndefined();
    expect(touched).toEqual([]);
  });
});

describe('resolveRequestPath on a real repository', () => {
  let repo: IgnoreTableRepo;
  let docs: string;
  beforeAll(() => {
    repo = createIgnoreTableRepo();
    docs = join(repo.root, 'docs');
  });
  afterAll(() => {
    repo.cleanup();
  });

  it('resolves files inside the scope, ignored or not', async () => {
    expect(await realOf(docs, 'a.md')).toBe(join(docs, 'a.md'));
    expect(await realOf(docs, 'ignored.md')).toBe(join(docs, 'ignored.md'));
    expect(await realOf(docs, 'My%20Notes/caf%C3%A9%20%C3%A9.md')).toBeDefined();
  });

  it('tells a refused spelling apart from a missing file', async () => {
    expect(await resolveRequestPath(docs, '%2e%2e/x.md')).toBeUndefined();
    expect(await resolveRequestPath(docs, 'missing.md')).toEqual({
      scoped: { segments: ['missing.md'], path: 'missing.md' },
      real: undefined,
    });
  });

  it('returns undefined for missing files and directories', async () => {
    expect(await realOf(docs, 'missing.md')).toBeUndefined();
    expect(await realOf(docs, 'deep')).toBeUndefined();
    expect(await realOf(docs, 'gone.md')).toBeUndefined();
  });

  it('follows a root given through a symlink', async (ctx) => {
    const alias = join(repo.outside, 'docs-alias');
    try {
      symlinkSync(docs, alias, 'dir');
    } catch {
      ctx.skip();
    }
    expect(await realOf(alias, 'a.md')).toBe(join(docs, 'a.md'));
  });

  it('rejects symlinks that escape the root', async (ctx) => {
    if (!repo.symlinks) {
      ctx.skip();
    }
    expect(await realOf(repo.root, ESCAPE_LINKS.file)).toBeUndefined();
    expect(await realOf(repo.root, `${ESCAPE_LINKS.dir}/secret.md`)).toBeUndefined();
  });
});
