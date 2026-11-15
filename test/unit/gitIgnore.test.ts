import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalPath, GitIgnore } from '../../src/adapters/gitIgnore';
import {
  createIgnoreTableRepo,
  EMPTY_GIT_CONFIG,
  ESCAPE_LINKS,
  IGNORE_TABLE,
  type IgnoreTableRepo,
} from '../support/ignoreTableRepo';

describe('GitIgnore adapter on the ignore-table repo', () => {
  let repo: IgnoreTableRepo;
  /** Runs git inside the folder it lists, as discovery does. */
  const open = async (folder: string): Promise<GitIgnore> => {
    const detected = await GitIgnore.detect(join(repo.root, folder));
    if (detected === undefined) {
      throw new Error(`git not detected in ${folder}`);
    }
    return detected;
  };
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    noSystem: process.env.GIT_CONFIG_NOSYSTEM,
  };

  beforeAll(() => {
    // The adapter inherits the process environment; keep personal git config out.
    process.env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    repo = createIgnoreTableRepo();
  });

  afterAll(() => {
    repo.cleanup();
    restore('GIT_CONFIG_GLOBAL', saved.global);
    restore('GIT_CONFIG_NOSYSTEM', saved.noSystem);
  });

  it('lists the opened folder without ignored or deleted files, relative to it', async () => {
    const git = await open('docs');
    const markdown = (await git.listFiles()).filter((p) => p.endsWith('.md')).sort();
    const expected: string[] = IGNORE_TABLE.normalFolder.listed.map((p) => p.slice('docs/'.length));
    if (repo.symlinks) {
      expected.push(ESCAPE_LINKS.file.slice('docs/'.length));
    }
    expect(markdown).toEqual(expected.sort());
  });

  it('lists only tracked files, for the walker to add back', async () => {
    const git = await open('.agent');
    expect((await git.listTracked()).sort()).toEqual(['drafts/forced.md', 'tracked.md']);
  });

  it('sees an ignored folder as ignored even when it holds a force-added file', async () => {
    expect(await (await open('.agent')).isFolderIgnored()).toBe(true);
    expect(await (await open('docs')).isFolderIgnored()).toBe(false);
  });

  it('never calls the top folder of a repository ignored', async () => {
    expect(await (await open('.')).isFolderIgnored()).toBe(false);
  });

  it('is not detected outside a work tree', async () => {
    expect(await GitIgnore.detect(repo.outside)).toBeUndefined();
  });
});

describe('canonicalPath', () => {
  const nfd = 'café.md';
  it('normalizes to NFC on macOS only', () => {
    expect(canonicalPath(nfd, 'darwin')).toBe('café.md');
    expect(canonicalPath(nfd, 'linux')).toBe(nfd);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restoring the environment
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
