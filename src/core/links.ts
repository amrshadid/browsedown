/**
 * Resolves a link the way GitHub does: relative to the file that contains it.
 * Pure; the server turns the answer into a URL.
 *
 * Resolution is done segment by segment instead of with `new URL()`, because the
 * URL parser clamps `..` at the root: `new URL('../../secret.md', 'http://x/a.md')`
 * silently becomes `/secret.md`, which would send an out-of-scope link to the
 * wrong file. Here, climbing above the scope root is reported as `outside`.
 */
import { checkDecodedPath, type PathFlavor } from './scope';

export type LinkTarget =
  /** `#install`: stays on the page. */
  | { readonly kind: 'anchor' }
  /** `https:`, `mailto:`, `//host/…`: leaves the preview. */
  | { readonly kind: 'external' }
  /** A file inside the scope. `fragment` is `''` or `#…`, kept as written. */
  | { readonly kind: 'local'; readonly path: string; readonly fragment: string }
  /** Climbs above the scope root, or can't name a file safely. */
  | { readonly kind: 'outside' };

/** An absolute URL with a scheme, or a protocol-relative one (`//host`). */
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Resolves `href` (as written in the document, percent-encoded) found in the file
 * at `fromPath` (decoded, scope-relative, e.g. `docs/guide.md`).
 *
 * - A leading `/` means the scope root (GitHub: the repository root).
 * - A trailing `/` means a folder; it resolves to that folder's `README.md`.
 * - The query string is dropped; the fragment is kept.
 */
export function resolveLink(fromPath: string, href: string, flavor: PathFlavor): LinkTarget {
  if (href.startsWith('#')) {
    return { kind: 'anchor' };
  }
  if (EXTERNAL.test(href)) {
    return { kind: 'external' };
  }
  const hashAt = href.indexOf('#');
  const fragment = hashAt === -1 ? '' : href.slice(hashAt);
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  let path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);

  if (path === '') {
    // `?x` or `` alone: the current file.
    return { kind: 'local', path: fromPath, fragment };
  }
  const stack: string[] = [];
  if (path.startsWith('/')) {
    path = path.slice(1);
  } else {
    stack.push(...fromPath.split('/').slice(0, -1));
  }
  const raw = path.split('/');
  const isFolder = raw[raw.length - 1] === '';
  for (const part of raw) {
    let segment: string;
    try {
      segment = decodeURIComponent(part);
    } catch {
      return { kind: 'outside' };
    }
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (stack.length === 0) {
        return { kind: 'outside' };
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (isFolder) {
    stack.push('README.md');
  }
  if (stack.length === 0) {
    return { kind: 'outside' };
  }
  const check = checkDecodedPath(stack.join('/'), flavor);
  return check.ok ? { kind: 'local', path: check.value.path, fragment } : { kind: 'outside' };
}
