/**
 * Finds the Markdown files of a folder preview:
 *
 * - Trusted workspace, folder in git and not ignored by it: `git ls-files` decides.
 * - Folder ignored by git, outside git, or an untrusted workspace: walk it with
 *   only its own `.gitignore` files, and in git add tracked files back
 *   (force-added files stay visible, as in git).
 *
 * Every result passes both halves of the scope guard, so a symlink that leads out
 * of the folder never appears in the tree.
 */
import { readdir, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import {
  checkDecodedPath,
  isDependencyFolder,
  withoutDependencyFolders,
  type DiscoveryResult,
} from '../core';
import { GitIgnore } from './gitIgnore';
import { pathFlavor, resolveInRealRoot } from './scopedFile';
import { walkFolder } from './walker';

const MARKDOWN = /\.(md|markdown)$/i;

export interface DiscoveryOptions {
  /** `vscode.workspace.isTrusted`: git never runs in an untrusted workspace. */
  readonly trusted: boolean;
}

export async function discoverFolder(
  root: string,
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const git = options.trusted ? await GitIgnore.detect(root) : undefined;
  let candidates: string[];
  let discovery: DiscoveryResult['discovery'];
  let truncated = false;

  // Opening a dependency or environment folder on purpose shows all of it.
  const skipDependencies = !(await isInDependencyFolder(root));
  const ignored = git === undefined ? true : await git.isFolderIgnored().catch(() => false);
  if (git !== undefined && !ignored) {
    candidates = await git.listFiles();
    discovery = 'git';
  } else {
    const walk = await walkFolder(root, undefined, skipDependencies);
    candidates = [...walk.files];
    truncated = walk.truncated;
    discovery = 'walk';
    if (git !== undefined) {
      candidates.push(...(await git.listTracked()));
    }
  }

  // Git lists what a repository commits, such as a vendored `vendor/`; the walker
  // already stayed out of these folders, but tracked files were added back.
  if (skipDependencies) {
    candidates = withoutDependencyFolders(candidates);
  }
  const markdown = [...new Set(candidates.filter((file) => MARKDOWN.test(file)))];
  const kept = await filterInScope(root, markdown);
  return { files: kept, discovery, truncated };
}

async function judgeOnDisk(absolute: string): Promise<boolean> {
  const list = async (dir: string): Promise<Set<string>> =>
    new Set(await readdir(dir).catch(() => [] as string[]));
  const [children, siblings] = await Promise.all([list(absolute), list(path.dirname(absolute))]);
  return isDependencyFolder({ name: path.basename(absolute), children, siblings });
}

/** Whether `root` or a folder above it is a dependency or environment folder. */
async function isInDependencyFolder(root: string): Promise<boolean> {
  for (let folder = root; path.dirname(folder) !== folder; folder = path.dirname(folder)) {
    if (await judgeOnDisk(folder)) {
      return true;
    }
  }
  return false;
}

/** Keeps the paths that pass both halves of the scope guard, a batch at a time. */
async function filterInScope(root: string, paths: readonly string[]): Promise<string[]> {
  const flavor = pathFlavor();
  const realRoot = await realpath(root); // Once per scan, not once per file.
  const kept: string[] = [];
  const batch = 64;
  for (let i = 0; i < paths.length; i += batch) {
    const results = await Promise.all(
      paths.slice(i, i + batch).map(async (file) => {
        const check = checkDecodedPath(file, flavor);
        return check.ok && (await resolveInRealRoot(realRoot, check.value)) !== undefined;
      }),
    );
    paths.slice(i, i + batch).forEach((file, index) => {
      if (results[index] === true) {
        kept.push(file);
      }
    });
  }
  return kept;
}
