import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import * as path from 'node:path';

/** A path relative to the git working directory, with `/` separators. */
type RelPath = string;

/**
 * macOS file systems are normalization-insensitive: the same file name can
 * reach us as NFC from git (`core.precomposeUnicode`) and as NFD from other
 * APIs. Normalizing to NFC on macOS makes both spellings one path. Other
 * platforms treat names as exact bytes, so they are left untouched.
 */
export function canonicalPath(rel: RelPath, platform: NodeJS.Platform = process.platform): RelPath {
  return platform === 'darwin' ? rel.normalize('NFC') : rel;
}

/** Generous cap: `ls-files -z` on a 500k-file repository is ~30 MB. */
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Settings forced on every git call. A repository's own config can name programs
 * that git runs while reading the index (`core.fsmonitor`), so a cloned repo could
 * otherwise run code just by being opened. Git also never runs in an untrusted
 * workspace; this is defence in depth.
 */
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];

/**
 * Asks git which files the opened folder holds. Git is the only complete source
 * of truth for ignore rules (nested `.gitignore` files, `.git/info/exclude`, the
 * global excludes file, negations), and `ls-files` is fast on large repositories
 * because it never walks ignored folders such as `node_modules`.
 *
 * Git runs inside the opened folder, so every path is relative to it.
 */
export class GitIgnore {
  private constructor(
    private readonly git: string,
    private readonly cwd: string,
  ) {}

  /** A helper for `folder` when it is inside a git work tree and git is installed. */
  static async detect(folder: string): Promise<GitIgnore | undefined> {
    const git = await resolveGitExecutable();
    if (git === undefined) {
      return undefined;
    }
    try {
      const out = await run(git, folder, ['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true' ? new GitIgnore(git, folder) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Tracked files plus untracked files no ignore rule hides, as git sees them. */
  listFiles(): Promise<RelPath[]> {
    return this.existing(['--cached', '--others', '--exclude-standard']);
  }

  /** Tracked files only. Added to a walk, so force-added files in an ignored folder stay visible. */
  listTracked(): Promise<RelPath[]> {
    return this.existing(['--cached']);
  }

  /**
   * Whether the opened folder itself is ignored. Uses `--no-index`: without it,
   * one force-added file inside an ignored folder makes git call the folder "not
   * ignored". The top folder of a repository is never ignored.
   */
  async isFolderIgnored(): Promise<boolean> {
    const prefix = (await run(this.git, this.cwd, ['rev-parse', '--show-prefix'])).trim();
    if (prefix === '') {
      return false;
    }
    try {
      await run(this.git, path.dirname(this.cwd), [
        'check-ignore',
        '-q',
        '--no-index',
        '--',
        `${path.basename(this.cwd)}/`,
      ]);
      return true;
    } catch (error) {
      if (isExitCode(error, 1)) {
        return false; // Exit code 1 means "not ignored", not a failure.
      }
      throw error;
    }
  }

  /**
   * Untracked paths that ignore rules hide, with fully ignored folders collapsed
   * to one `folder/` entry (`--directory`). A folder that also holds tracked
   * files isn't collapsed: its ignored files and subfolders are listed instead.
   * Used by the sidebar's "Show ignored folders" (ADR 0008).
   */
  async listIgnored(): Promise<RelPath[]> {
    const out = await run(this.git, this.cwd, [
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '--',
      '.',
    ]);
    return splitNul(out).map((p) => canonicalPath(p));
  }

  /**
   * Which of `folders` (relative, each ending in `/`) ignore rules hide, judged
   * from the rules alone (`--no-index`, as in {@link isFolderIgnored}).
   */
  async ignoredFolders(folders: readonly RelPath[]): Promise<RelPath[]> {
    if (folders.length === 0) {
      return [];
    }
    try {
      const out = await run(
        this.git,
        this.cwd,
        ['check-ignore', '-z', '--no-index', '--stdin'],
        `${folders.join('\0')}\0`,
      );
      return splitNul(out).map((p) => canonicalPath(p));
    } catch (error) {
      if (isExitCode(error, 1)) {
        return []; // None of them is ignored.
      }
      throw error;
    }
  }

  /** `ls-files` with `flags`, minus tracked files deleted from disk, without duplicates. */
  private async existing(flags: readonly string[]): Promise<RelPath[]> {
    const [listed, deleted] = await Promise.all([
      run(this.git, this.cwd, ['ls-files', '-z', ...flags, '--', '.']),
      run(this.git, this.cwd, ['ls-files', '-z', '--deleted', '--', '.']),
    ]);
    const gone = new Set(splitNul(deleted).map((p) => canonicalPath(p)));
    // `--cached` lists a path once per merge stage during a conflict: dedupe.
    return [...new Set(splitNul(listed).map((p) => canonicalPath(p)))].filter((p) => !gone.has(p));
  }
}

/**
 * Finds the git executable. On Windows, launching a bare `git` searches the
 * current directory (the workspace) before PATH, so a `git.exe` planted in a
 * repository would run instead. Resolving an absolute path from PATH avoids
 * that. Elsewhere, PATH lookup never includes the working directory implicitly.
 */
async function resolveGitExecutable(): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return 'git';
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) {
      continue; // Relative entries resolve against the workspace: unsafe.
    }
    const candidate = path.join(dir, 'git.exe');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return undefined;
}

/**
 * Runs git without a shell; `input`, when given, is written to its stdin.
 * Exported for tests only.
 */
export function run(
  git: string,
  cwd: string,
  args: readonly string[],
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      git,
      [...SAFE_CONFIG, ...args],
      { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(new GitError(error.message, error.code));
        } else {
          resolve(stdout);
        }
      },
    );
    if (input !== undefined && child.stdin !== null) {
      // If git exits before reading everything, the write fails with EPIPE. The exit
      // status already reports the failure through the callback above, so the pipe
      // error needs only to be handled, or it is an uncaught exception.
      // https://nodejs.org/api/child_process.html#subprocessstdin
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    }
  });
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((part) => part.length > 0);
}

/** A failed git invocation, keeping the exit code (Node's error type loses `Error`-ness). */
class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: string | number | null | undefined,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

function isExitCode(error: unknown, code: number): boolean {
  return error instanceof GitError && error.exitCode === code;
}
