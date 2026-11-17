/**
 * Walks a folder when git can't list it (ignored by git, outside git, or an
 * untrusted workspace). Applies only the `.gitignore` files inside the folder,
 * never enters ignored folders, `.git`, or dependency, environment and build
 * folders (`core/dependencyFolders.ts`; the walked folder itself is never judged),
 * and never follows a symlink to a folder (no escapes, no cycles). A symlink to a
 * file is listed; discovery drops it if the scope guard refuses it. Stops after
 * `cap` entries and says so.
 */
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { hasDependencyMarker, IgnoreRules, isDependencyFolderByName } from '../core';
import { canonicalPath } from './gitIgnore';

/** Enough for any docs folder; a cap keeps a huge tree from stalling the preview. */
const WALK_CAP = 20_000;

export interface WalkResult {
  /** Scope-relative, `/`-separated file paths (all types; discovery filters). */
  readonly files: readonly string[];
  readonly truncated: boolean;
}

/**
 * `skipDependencies: false` walks everything (still not `.git`): for a folder that
 * is itself inside a dependency or environment folder, opened on purpose.
 */
export async function walkFolder(
  root: string,
  cap = WALK_CAP,
  skipDependencies = true,
): Promise<WalkResult> {
  const rules = new IgnoreRules();
  const files: string[] = [];
  const queue: string[] = [''];
  let seen = 0;

  // Breadth-first. Array iteration sees folders pushed during the loop, without
  // the copying `queue.shift()` would do on every step.
  for (const folder of queue) {
    const absolute = path.join(root, ...folder.split('/').filter((s) => s !== ''));
    let entries: Dirent[];
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      continue; // Unreadable folder: skip it, like git would.
    }
    const names = new Set(entries.map((entry) => entry.name));
    if (skipDependencies && folder !== '' && hasDependencyMarker(names)) {
      continue; // A virtual environment or a cache, whatever it is called.
    }
    if (entries.some((entry) => entry.name === '.gitignore' && entry.isFile())) {
      try {
        rules.add(folder, await readFile(path.join(absolute, '.gitignore'), 'utf8'));
      } catch {
        // Unreadable rules: nothing to apply.
      }
    }
    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }
      seen += 1;
      if (seen > cap) {
        return { files, truncated: true };
      }
      const relative = canonicalPath(folder === '' ? entry.name : `${folder}/${entry.name}`);
      if (entry.isDirectory()) {
        const dependency = skipDependencies && isDependencyFolderByName(entry.name, names);
        if (!rules.isIgnored(relative, true) && !dependency) {
          queue.push(relative);
        }
      } else if (entry.isFile()) {
        if (!rules.isIgnored(relative, false)) {
          files.push(relative);
        }
      } else if (entry.isSymbolicLink() && !rules.isIgnored(relative, false)) {
        const target = await stat(path.join(absolute, entry.name)).catch(() => undefined);
        if (target?.isFile() === true) {
          files.push(relative);
        }
      }
    }
  }
  return { files, truncated: false };
}
