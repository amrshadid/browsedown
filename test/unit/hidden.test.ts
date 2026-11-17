/**
 * Hide in Browsedown (ADR 0009): the stored paths, how they match, and discovery
 * leaving hidden files out by their real path, symlinks included.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverFolder } from '../../src/adapters/discovery';
import { HiddenPaths, type HiddenState } from '../../src/adapters/hidden';

/** An in-memory `workspaceState`. */
function memento(initial: Record<string, unknown> = {}): HiddenState & {
  readonly data: Record<string, unknown>;
} {
  const data = { ...initial };
  return {
    data,
    get: <T>(key: string, fallback: T): T => (key in data ? (data[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      data[key] = value;
      return Promise.resolve();
    },
  };
}

describe('HiddenPaths', () => {
  it('hides a folder and everything inside it, and nothing beside it', async () => {
    const hidden = new HiddenPaths(memento(), 'linux');
    await hidden.hide(['/repo/docs/bugs']);
    expect(hidden.isHidden('/repo/docs/bugs')).toBe(true);
    expect(hidden.isHidden('/repo/docs/bugs/crash.md')).toBe(true);
    expect(hidden.isHidden('/repo/docs/bugs/2026/a.md')).toBe(true);
    // Same prefix, different folder: not hidden.
    expect(hidden.isHidden('/repo/docs/bugs-old/a.md')).toBe(false);
    expect(hidden.isHidden('/repo/docs/a.md')).toBe(false);
    expect(hidden.isHidden('/repo/docs')).toBe(false);
  });

  it('hides a single file', async () => {
    const hidden = new HiddenPaths(memento(), 'linux');
    await hidden.hide(['/repo/docs/secret.md']);
    expect(hidden.isHidden('/repo/docs/secret.md')).toBe(true);
    expect(hidden.isHidden('/repo/docs/secret.md.bak')).toBe(false);
  });

  it('compares like the file system: case-insensitive on Windows, exact elsewhere', async () => {
    const windows = new HiddenPaths(memento(), 'win32');
    await windows.hide(['C:\\repo\\docs\\Bugs']);
    expect(windows.isHidden('c:\\REPO\\docs\\bugs\\a.md')).toBe(true);
    const posix = new HiddenPaths(memento(), 'linux');
    await posix.hide(['/repo/docs/Bugs']);
    expect(posix.isHidden('/repo/docs/bugs/a.md')).toBe(false);
  });

  it('keeps the list per workspace in its state, and reads it back', async () => {
    const state = memento();
    const hidden = new HiddenPaths(state, 'linux');
    await hidden.hide(['/repo/a', '/repo/b', '/repo/a']);
    expect(state.data['browsedown.hidden']).toEqual(['/repo/a', '/repo/b']);
    expect(new HiddenPaths(state, 'linux').list()).toEqual(['/repo/a', '/repo/b']);
  });

  it('ignores a corrupt stored value', () => {
    expect(new HiddenPaths(memento({ 'browsedown.hidden': 'oops' }), 'linux').list()).toEqual([]);
    expect(
      new HiddenPaths(memento({ 'browsedown.hidden': ['/ok', 3, null] }), 'linux').list(),
    ).toEqual(['/ok']);
  });

  it('unhides, names what hides a path, and tells listeners', async () => {
    const hidden = new HiddenPaths(memento(), 'linux');
    let changes = 0;
    const listener = hidden.onDidChange(() => {
      changes += 1;
    });
    await hidden.hide(['/repo/docs', '/repo/docs/bugs', '/repo/other']);
    expect(hidden.covering('/repo/docs/bugs/a.md')).toEqual(['/repo/docs', '/repo/docs/bugs']);
    await hidden.unhide(['/repo/docs', '/repo/docs/bugs']);
    expect(hidden.list()).toEqual(['/repo/other']);
    await hidden.unhide(['/not/hidden']); // No change: no event.
    listener.dispose();
    await hidden.hide(['/x']);
    expect(changes).toBe(2);
  });
});

describe('discovery leaves hidden files out', () => {
  let root: string;
  let symlinks = true;

  beforeAll(() => {
    // The native realpath, as the product uses: on Windows it expands 8.3 short names
    // (C:\\Users\\RUNNER~1), so hidden paths compare equal to what discovery resolves.
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'browsedown-hidden-')));
    for (const file of [
      'README.md',
      'guide.md',
      'bugs/crash.md',
      'bugs/2026/old.md',
      'secret.md',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), `# ${file}\n`);
    }
    try {
      // A link elsewhere in the folder that leads into the hidden folder.
      symlinkSync(join(root, 'bugs', 'crash.md'), join(root, 'alias.md'));
    } catch {
      symlinks = false; // Windows without symlink rights.
    }
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('drops a hidden folder, a hidden file, and a symlink into a hidden folder', async () => {
    const hidden = new HiddenPaths(memento());
    await hidden.hide([join(root, 'bugs'), join(root, 'secret.md')]);
    const result = await discoverFolder(root, {
      trusted: true,
      isHidden: (real) => hidden.isHidden(real),
    });
    expect([...result.files].sort()).toEqual(['README.md', 'guide.md']);
    if (symlinks) {
      const visible = await discoverFolder(root, { trusted: true });
      expect(visible.files).toContain('alias.md'); // Listed when nothing is hidden.
    }
  });
});
