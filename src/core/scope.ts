/**
 * The spelling half of the scope guard. Every path that can reach the disk (the
 * file route, every rewritten link) passes here first, as a percent-encoded path
 * relative to the session root. It proves the path can't climb above the root by
 * its spelling; `adapters/scopedFile.ts` then checks where it really leads on disk
 * (symlinks). Both must pass.
 *
 * Rules:
 * - Decode exactly once: `%252e%252e` stays the literal name `%2e%2e`, never `..`.
 *   Malformed encodings are rejected, not passed through.
 * - Everywhere: no control characters (NUL included), no empty segments (a leading
 *   `/`, `//`, a trailing `/`), no `.` or `..` segments.
 * - Windows only: no backslash (a separator there), no `:` (drive letters, NTFS
 *   streams), no device names (`CON`, `COM1`, …), no characters Windows forbids,
 *   and no segment ending in a dot or space (Windows strips those, so `.. ` acts
 *   as `..`). On POSIX these are ordinary file-name characters.
 *
 * https://learn.microsoft.com/windows/win32/fileio/naming-a-file
 */

/** Which platform's rules apply on top of the universal ones. */
export type PathFlavor = 'posix' | 'windows';

/** Why a path was rejected. For tests and diagnostics; the server answers 404 either way. */
export type ScopeRejection =
  | 'malformed-encoding'
  | 'control-character'
  | 'empty-segment'
  | 'dot-segment'
  | 'backslash'
  | 'colon'
  | 'windows-reserved-name'
  | 'windows-forbidden-character'
  | 'windows-trailing-dot-or-space';

/** A path that passed: decoded, relative to the root, with no segment that can climb. */
export interface ScopedPath {
  /** The decoded segments, e.g. `['docs', 'My Notes', 'a.md']`. Never empty. */
  readonly segments: readonly string[];
  /** The segments joined with `/`, e.g. `docs/My Notes/a.md`. */
  readonly path: string;
}

export type ScopeCheck =
  | { readonly ok: true; readonly value: ScopedPath }
  | { readonly ok: false; readonly reason: ScopeRejection };

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const WINDOWS_FORBIDDEN = /[<>"|?*]/;
/** `CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9` (and superscript digits), with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Checks a percent-encoded relative path from a URL, e.g. `docs/My%20Notes/a.md`. Never throws. */
export function checkScopedPath(encoded: string, flavor: PathFlavor): ScopeCheck {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return reject('malformed-encoding');
  }
  return checkDecodedPath(decoded, flavor);
}

/** The same rules for a path that is already decoded (resolved links, discovery results). */
export function checkDecodedPath(decoded: string, flavor: PathFlavor): ScopeCheck {
  if (CONTROL_CHARACTER.test(decoded)) {
    return reject('control-character');
  }
  if (flavor === 'windows' && decoded.includes('\\')) {
    return reject('backslash');
  }
  const segments = decoded.split('/');
  for (const segment of segments) {
    const problem = checkSegment(segment, flavor);
    if (problem !== undefined) {
      return reject(problem);
    }
  }
  return { ok: true, value: { segments, path: segments.join('/') } };
}

function checkSegment(segment: string, flavor: PathFlavor): ScopeRejection | undefined {
  if (segment === '') {
    return 'empty-segment';
  }
  if (segment === '.' || segment === '..') {
    return 'dot-segment';
  }
  if (flavor === 'posix') {
    return undefined;
  }
  if (segment.includes(':')) {
    return 'colon';
  }
  if (WINDOWS_FORBIDDEN.test(segment)) {
    return 'windows-forbidden-character';
  }
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    return 'windows-trailing-dot-or-space';
  }
  // Windows matches device names after trimming spaces before the extension (`CON .md`).
  if (WINDOWS_RESERVED.test(segment.replace(/ +(?=\.|$)/, ''))) {
    return 'windows-reserved-name';
  }
  return undefined;
}

function reject(reason: ScopeRejection): ScopeCheck {
  return { ok: false, reason };
}
