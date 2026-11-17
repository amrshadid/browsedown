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
  isDependencyFolderByName,
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

export interface DocsOptions extends DiscoveryOptions {
  /** Also list the Markdown in folders and files git ignores (ADR 0008). */
  readonly includeIgnored: boolean;
}

/**
 * The Markdown of a whole folder for the docs sidebar and its previews: the same
 * as {@link discoverFolder}, plus, when `includeIgnored` is on, the Markdown git
 * ignores. Each topmost ignored folder is read as if it were opened explicitly
 * (its own `.gitignore` files only), except dependency, environment and build
 * folders (`core/dependencyFolders.ts`), which are never entered. Outside git, or
 * in an untrusted workspace, there is nothing to add.
 */
export async function discoverDocs(root: string, options: DocsOptions): Promise<DiscoveryResult> {
  const base = await discoverFolder(root, options);
  if (!options.includeIgnored || !options.trusted) {
    return base;
  }
  const git = await GitIgnore.detect(root);
  if (git === undefined || (await git.isFolderIgnored().catch(() => true))) {
    return base; // An ignored root was walked whole already.
  }
  // A quick first pass on names alone; each ignored folder is judged fully below.
  const noSiblings = new Set<string>();
  const entries = (await git.listIgnored()).filter(
    (entry) =>
      !entry
        .split('/')
        .slice(0, -1)
        .some((segment) => isDependencyFolderByName(segment, noSiblings)),
  );
  const ignoredFolders = new Set(await git.ignoredFolders(folderPrefixes(entries)));

  const roots = new Set<string>();
  const files: string[] = [];
  for (const entry of entries) {
    const folder = folderPrefixes([entry]).find((prefix) => ignoredFolders.has(prefix));
    if (folder !== undefined) {
      roots.add(folder);
    } else if (entry.endsWith('/')) {
      roots.add(entry); // Collapsed by a content rule (`dir/**`): the folder itself isn't ignored.
    } else if (MARKDOWN.test(entry)) {
      files.push(entry);
    }
  }

  let truncated = base.truncated;
  for (const folder of roots) {
    if (await isDependencyFolderOnDisk(root, folder)) {
      continue; // `.venv/`, `target/` beside `Cargo.toml`, …: never entered.
    }
    const found = await discoverFolder(path.join(root, ...folder.split('/')), options);
    files.push(...found.files.map((file) => `${folder}${file}`));
    truncated ||= found.truncated;
  }
  const extra = await filterInScope(root, [...new Set(files)]);
  return {
    files: [...new Set([...base.files, ...extra])],
    discovery: base.discovery,
    truncated,
  };
}

/** Judges an ignored folder (`a/b/`, relative to `root`) from what is inside it and beside it. */
function isDependencyFolderOnDisk(root: string, folder: string): Promise<boolean> {
  return judgeOnDisk(path.join(root, ...folder.split('/').filter((segment) => segment !== '')));
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

/** Every folder above each path, shortest first, as `a/`, `a/b/`; a folder entry includes itself. */
function folderPrefixes(paths: readonly string[]): string[] {
  const prefixes = new Set<string>();
  for (const entry of paths) {
    const segments = entry.split('/');
    // `a/b/` splits to ['a', 'b', '']: the folder itself counts. `a/b.md`: only `a/`.
    for (let i = 1; i < segments.length; i += 1) {
      prefixes.add(`${segments.slice(0, i).join('/')}/`);
    }
  }
  return [...prefixes].sort((a, b) => a.length - b.length);
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
