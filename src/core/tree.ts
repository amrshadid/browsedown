/**
 * Builds the sidebar tree from scope-relative file paths. Discovery passes only
 * Markdown files, so every folder in the tree holds at least one. Sorted the way
 * GitHub readers expect: folders first, README first, then case-insensitive
 * natural order (`2-setup.md` before `10-deploy.md`).
 */

/** A file in the tree. */
export interface TreeFile {
  readonly kind: 'file';
  readonly name: string;
  /** Scope-relative path with `/` separators, e.g. `docs/setup.md`. */
  readonly path: string;
}

/** A folder in the tree. Never empty. */
export interface TreeFolder {
  readonly kind: 'folder';
  readonly name: string;
  /** Scope-relative path with `/` separators, e.g. `docs/guides`. */
  readonly path: string;
  readonly children: readonly TreeNode[];
}

export type TreeNode = TreeFile | TreeFolder;

interface MutableFolder {
  readonly folders: Map<string, MutableFolder>;
  readonly files: Set<string>;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Builds a sorted tree. Duplicates and empty segments in the input are ignored. */
export function buildTree(paths: readonly string[]): TreeNode[] {
  const root: MutableFolder = { folders: new Map(), files: new Set() };
  for (const path of paths) {
    const segments = path.split('/').filter((segment) => segment !== '');
    const fileName = segments.pop();
    if (fileName === undefined) {
      continue;
    }
    let folder = root;
    for (const segment of segments) {
      let next = folder.folders.get(segment);
      if (next === undefined) {
        next = { folders: new Map(), files: new Set() };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.files.add(fileName);
  }
  return toNodes(root, '');
}

function toNodes(folder: MutableFolder, prefix: string): TreeNode[] {
  const join = (name: string): string => (prefix === '' ? name : `${prefix}/${name}`);
  const folders = [...folder.folders.entries()]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([name, child]): TreeFolder => ({
      kind: 'folder',
      name,
      path: join(name),
      children: toNodes(child, join(name)),
    }));
  const files = [...folder.files]
    .sort(compareFiles)
    .map((name): TreeFile => ({ kind: 'file', name, path: join(name) }));
  return [...folders, ...files];
}

function isReadme(name: string): boolean {
  return /^readme\.(md|markdown)$/i.test(name);
}

function compareFiles(a: string, b: string): number {
  const readme = Number(isReadme(b)) - Number(isReadme(a));
  return readme !== 0 ? readme : compareNames(a, b);
}

/** Case-insensitive natural order, with a byte comparison to break ties deterministically. */
function compareNames(a: string, b: string): number {
  const order = collator.compare(a, b);
  if (order !== 0) {
    return order;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every ancestor folder path of `path`, nearest last: `a/b/c.md` → `['a', 'a/b']`. */
export function ancestorFolders(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}
