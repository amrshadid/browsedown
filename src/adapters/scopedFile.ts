/**
 * The disk half of the scope guard. `core/scope.ts` proves a path can't climb out
 * of the root by its spelling; this half asks the file system where it really
 * leads. `realpath` resolves every symlink, so a link inside the root that points
 * outside it is refused here. A path is served only when both halves pass.
 */
import { realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { checkScopedPath, type PathFlavor, type ScopedPath } from '../core';

/** The `node:path` functions the guard uses, for one platform. */
type PathApi = Pick<typeof path, 'join' | 'relative' | 'isAbsolute' | 'sep'>;

/** File system access, injectable for tests. */
export interface ScopedFileDeps {
  readonly realpath: (p: string) => Promise<string>;
  readonly isFile: (p: string) => Promise<boolean>;
  readonly platform: NodeJS.Platform;
}

const nodeDeps: ScopedFileDeps = {
  // The native realpath returns the on-disk case and long names (not 8.3) on
  // Windows and macOS, so two real paths can be compared exactly.
  realpath: (p) => realpath(p),
  isFile: async (p) => (await stat(p)).isFile(),
  platform: process.platform,
};

/** The spelling rules for this platform. */
export function pathFlavor(platform: NodeJS.Platform = process.platform): PathFlavor {
  return platform === 'win32' ? 'windows' : 'posix';
}

/**
 * The real path of a regular file inside `realRoot` (already a real path), or
 * `undefined` when it doesn't exist, isn't a regular file, or leads outside the
 * root. Every failure looks the same, so responses reveal nothing about what
 * exists outside the scope.
 */
export async function resolveInRealRoot(
  realRoot: string,
  scoped: ScopedPath,
  deps: ScopedFileDeps = nodeDeps,
): Promise<string | undefined> {
  const api = pathApiFor(deps.platform);
  try {
    const realTarget = await deps.realpath(api.join(realRoot, ...scoped.segments));
    if (!isStrictlyInside(realRoot, realTarget, deps.platform)) {
      return undefined;
    }
    return (await deps.isFile(realTarget)) ? realTarget : undefined;
  } catch {
    return undefined;
  }
}

/** Like {@link resolveInRealRoot}, resolving `root` first (it may be reached through a symlink). */
export async function resolveScopedFile(
  root: string,
  scoped: ScopedPath,
  deps: ScopedFileDeps = nodeDeps,
): Promise<string | undefined> {
  try {
    return await resolveInRealRoot(await deps.realpath(root), scoped, deps);
  } catch {
    return undefined;
  }
}

/** A request path that passed the spelling check, and where it leads on disk, if anywhere. */
export interface RequestPath {
  readonly scoped: ScopedPath;
  readonly real: string | undefined;
}

/**
 * Both halves for a percent-encoded request path. `undefined` means the spelling
 * was refused; `real: undefined` means no servable file is there.
 */
export async function resolveRequestPath(
  root: string,
  encoded: string,
  deps: ScopedFileDeps = nodeDeps,
): Promise<RequestPath | undefined> {
  const check = checkScopedPath(encoded, pathFlavor(deps.platform));
  if (!check.ok) {
    return undefined;
  }
  return { scoped: check.value, real: await resolveScopedFile(root, check.value, deps) };
}

/**
 * True when `target` is strictly below `root`, comparing whole segments, so
 * `/repo2/a.md` is not inside `/repo`. Both must be real paths. `path.win32`
 * compares case-insensitively, as Windows does; POSIX compares exactly, which is
 * also right on a case-sensitive macOS volume.
 */
export function isStrictlyInside(root: string, target: string, platform: NodeJS.Platform): boolean {
  const api = pathApiFor(platform);
  const relative = api.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${api.sep}`) &&
    !api.isAbsolute(relative)
  );
}

function pathApiFor(platform: NodeJS.Platform): PathApi {
  return platform === 'win32' ? path.win32 : path.posix;
}
