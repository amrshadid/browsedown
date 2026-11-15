/**
 * Builds a throwaway git repository that covers every row of the ignore table in
 * the README ("Which files appear"), plus the git edge cases discovery must handle
 * and symlinks that escape the folder.
 *
 * Fixture repos are created at test time, never committed as nested repos.
 * The layout is described once, in {@link IGNORE_TABLE}, so tests assert
 * against named expectations instead of re-deriving them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * An empty git config file. Used as `GIT_CONFIG_GLOBAL` instead of the null device:
 * Git for Windows rejects `\\.\nul` as a config path ("unable to access").
 */
export const EMPTY_GIT_CONFIG = join(tmpdir(), 'browsedown-empty-gitconfig');
writeFileSync(EMPTY_GIT_CONFIG, '');

/**
 * Environment for every git call the helper makes: no system or global config,
 * so a developer's `core.excludesFile` or signing setup can't change the fixture.
 * Tests that run git themselves should pass the same environment.
 */
export const isolatedGitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const GIT_CONFIG = [
  '-c',
  'init.defaultBranch=main',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

/** Runs git in `cwd` with the isolated environment and returns stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_CONFIG, ...args], {
    cwd,
    env: isolatedGitEnv,
    encoding: 'utf8',
    windowsHide: true,
  });
}

/** `Café é` in NFC: git and the walker must agree on one spelling (macOS NFC rule). */
const UNICODE_DIR = 'docs/My Notes';
const UNICODE_FILE = `${UNICODE_DIR}/café é.md`;

/**
 * Expected results per row, as repo-relative POSIX paths. Markdown only, because
 * the tree lists only `.md`/`.markdown` files.
 */
export const IGNORE_TABLE = {
  /** Row 1: open `docs/` → tracked plus non-ignored untracked Markdown (git discovery). */
  normalFolder: {
    root: 'docs',
    listed: [
      'docs/README.md',
      'docs/a.md',
      'docs/b.md',
      'docs/deep/d.md',
      // Tracked before `.gitignore` matched it: stays visible, like git.
      'docs/old.md',
      UNICODE_FILE,
    ],
    hidden: [
      'docs/ignored.md',
      // Tracked but deleted from disk: `ls-files --cached` still lists it.
      'docs/gone.md',
    ],
  },
  /** Row 2: open an ignored file directly → rendered, no tree, listings unchanged. */
  ignoredFile: { file: '.agent/notes.md' },
  /** Row 3: open an ignored folder explicitly → walk it with only its own rules. */
  ignoredFolder: {
    root: '.agent',
    listed: [
      '.agent/notes.md',
      '.agent/plan.md',
      '.agent/sub/y.md',
      // Force-added (`git add -f`) inside the ignored root: tracked, so visible.
      '.agent/tracked.md',
      // Force-added below a folder the root's own `.gitignore` hides: still tracked.
      '.agent/drafts/forced.md',
    ],
    hidden: ['.agent/drafts/x.md'],
  },
  /** Row 3 variant: an ignored root below an ignored ancestor. */
  ignoredUnderIgnoredAncestor: {
    root: 'notes/private',
    listed: ['notes/private/n.md'],
    hidden: ['notes/private/inner/m.md'],
  },
  /**
   * Row 3 variant: a root hidden by a content-shaped rule (`scratch/**`). The
   * git can't simply un-ignore such a folder, so the walker must handle it.
   */
  contentRuleRoot: {
    root: 'scratch',
    listed: ['scratch/s.md'],
    hidden: ['scratch/tmp/t.md'],
  },
  /** Row 4: links from `docs/a.md` to ignored targets inside the `docs/` scope. */
  linkedIgnored: {
    from: 'docs/a.md',
    targets: ['docs/ignored.md', 'docs/ignored.yml'],
  },
  /** Roots that `git check-ignore -q <root>/` reports as ignored (exit 0). */
  ignoredRoots: ['.agent', 'notes/private', 'scratch'],
  /** Roots that are not ignored (exit 1). */
  notIgnoredRoots: ['docs', 'docs/deep'],
  /** A folder with no Markdown: its branch must be omitted from the tree. */
  emptyBranch: 'docs/empty-branch',
} as const;

/** A created fixture repository. */
export interface IgnoreTableRepo {
  /** Real path (symlinks resolved, e.g. `/private/var/…` on macOS) of the work tree. */
  readonly root: string;
  /** Real path of a sibling folder outside the repo, the target of the escape links. */
  readonly outside: string;
  /**
   * Whether the symlinks were created. Windows without Developer Mode can't make
   * them; tests that need them should skip when this is false.
   */
  readonly symlinks: boolean;
  /** Removes everything, best effort: retries, then gives up quietly (Windows handles). */
  readonly cleanup: () => void;
}

/** Symlinks inside `docs/` that point outside the repo, for the disk half of the scope guard. */
export const ESCAPE_LINKS = {
  file: 'docs/link-out.md',
  dir: 'docs/linkdir',
} as const;

/** Creates the fixture repository in a fresh temp folder. */
export function createIgnoreTableRepo(): IgnoreTableRepo {
  // The native realpath, like the product's fs.promises.realpath: on Windows it expands
  // 8.3 short names (C:\Users\RUNNER~1 → runneradmin); the JavaScript one doesn't.
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'browsedown-')));
  const root = join(base, 'repo');
  const outside = join(base, 'outside');
  const write = (rel: string, content = `# ${rel}\n`): void => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const cleanup = (): void => {
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can hold a handle on a just-used folder (EPERM/EBUSY) beyond the
      // retries. It's a temp folder: leaving it must not fail the suite.
    }
  };

  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.md'), '# Outside the repo\n');
    git(root, 'init', '-q');

    // 1. Committed before any ignore rule exists.
    write('docs/README.md');
    write(
      'docs/a.md',
      [
        '# A',
        '',
        '[ignored](ignored.md) [yaml](ignored.yml) [deep](deep/d.md#section)',
        '[spaces](My%20Notes/caf%C3%A9%20%C3%A9.md) ![logo](img/logo.png)',
        '',
      ].join('\n'),
    );
    write('docs/old.md');
    write('docs/gone.md');
    write('docs/deep/d.md', '# D\n\n## Section\n');
    write('docs/x.txt', 'not markdown\n');
    write('docs/empty-branch/only.txt', 'no markdown here\n');
    write('docs/img/logo.png', 'not really a png\n');
    write(UNICODE_FILE);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'tracked files');

    // 2. Root rules added afterwards: docs/old.md is now tracked-then-ignored.
    write(
      '.gitignore',
      [
        '.agent/',
        'docs/ignored.md',
        'docs/ignored.yml',
        'docs/old.md',
        'notes/',
        'scratch/**',
        '*.log',
        '',
      ].join('\n'),
    );

    // 3. Ignored roots, each with its own nested rules.
    write('.agent/.gitignore', 'drafts/\n');
    write('.agent/notes.md');
    write('.agent/plan.md');
    write('.agent/sub/y.md');
    write('.agent/drafts/x.md');
    write('.agent/tracked.md');
    write('.agent/drafts/forced.md');
    write('notes/private/.gitignore', 'inner/\n');
    write('notes/private/n.md');
    write('notes/private/inner/m.md');
    write('scratch/.gitignore', 'tmp/\n');
    write('scratch/s.md');
    write('scratch/tmp/t.md');

    // 4. Untracked files inside the normal folder.
    write('docs/b.md');
    write('docs/ignored.md');
    write('docs/ignored.yml', 'secret: false\n');
    write('docs/c.log', 'log\n');

    git(root, 'add', '.gitignore');
    git(root, 'add', '-f', '.agent/tracked.md', '.agent/drafts/forced.md');
    git(root, 'commit', '-q', '-m', 'ignore rules and force-added files');

    // 5. A tracked file deleted from disk (not committed).
    rmSync(join(root, 'docs/gone.md'));

    const symlinks = tryCreateEscapeLinks(root, outside);
    return { root, outside, symlinks, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function tryCreateEscapeLinks(root: string, outside: string): boolean {
  try {
    symlinkSync(join(outside, 'secret.md'), join(root, ESCAPE_LINKS.file), 'file');
    symlinkSync(outside, join(root, ESCAPE_LINKS.dir), 'dir');
    return true;
  } catch {
    return false;
  }
}
