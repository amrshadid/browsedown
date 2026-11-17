/**
 * Dependency, environment, cache and build folders across stacks: the pure rules,
 * then a real folder with one of each, discovered by walking it and through git.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverDocs, discoverFolder } from '../../src/adapters/discovery';
import { walkFolder } from '../../src/adapters/walker';
import {
  hasDependencyMarker,
  isDependencyFolder,
  isDependencyFolderByName,
  withoutDependencyFolders,
} from '../../src/core';
import { EMPTY_GIT_CONFIG } from '../support/ignoreTableRepo';

const set = (...names: string[]): Set<string> => new Set(names);

describe('isDependencyFolder', () => {
  // [stack, folder name, names beside it]
  it.each([
    ['JavaScript', 'node_modules', []],
    ['JavaScript', 'bower_components', []],
    ['JavaScript (pnpm)', '.pnpm-store', []],
    ['Next.js', '.next', []],
    ['Nuxt', '.nuxt', []],
    ['SvelteKit', '.svelte-kit', []],
    ['Python bytecode', '__pycache__', []],
    ['Python venv (conventional name)', '.venv', []],
    ['Python tox', '.tox', []],
    ['Python packaging', 'mypkg.egg-info', []],
    ['Python', 'site-packages', []],
    ['Python tools', '.pytest_cache', []],
    ['Gradle', '.gradle', []],
    ['Kotlin', '.kotlin', []],
    ['CocoaPods', 'Pods', []],
    ['Xcode', 'DerivedData', []],
    ['Dart / Flutter', '.dart_tool', []],
    ['Haskell (Stack)', '.stack-work', []],
    ['Haskell (Cabal)', 'dist-newstyle', []],
    ['OCaml', '_opam', []],
    ['Elm', 'elm-stuff', []],
    ['Zig', '.zig-cache', []],
    ['R', 'renv', []],
    ['Terraform', '.terraform', []],
    ['Bazel', 'bazel-out', []],
    ['CLion', 'cmake-build-debug', []],
    ['Rust', 'target', ['Cargo.toml']],
    ['Maven', 'target', ['pom.xml']],
    ['sbt', 'target', ['build.sbt']],
    ['Go', 'vendor', ['go.mod']],
    ['PHP (Composer)', 'vendor', ['composer.json']],
    ['Ruby (Bundler)', 'vendor', ['Gemfile']],
    ['Gradle', 'build', ['build.gradle.kts']],
    ['CMake', 'build', ['CMakeLists.txt']],
    ['Flutter', 'build', ['pubspec.yaml']],
    ['JavaScript', 'dist', ['package.json']],
    ['Python', 'dist', ['pyproject.toml']],
    ['.NET', 'bin', ['App.csproj']],
    ['.NET', 'obj', ['Lib.fsproj']],
    ['.NET (NuGet)', 'packages', ['App.sln']],
    ['Elixir', 'deps', ['mix.exs']],
    ['Elixir', '_build', ['mix.exs']],
    ['Swift Package Manager', '.build', ['Package.swift']],
    ['Unity', 'Library', ['ProjectSettings']],
  ])('%s: %s', (_stack, name, beside) => {
    expect(isDependencyFolderByName(name, new Set(beside))).toBe(true);
  });

  it.each([
    ['any-named Python venv', 'pyvenv.cfg'],
    ['Conda environment', 'conda-meta'],
    ['cache-directory standard (Rust target/)', 'CACHEDIR.TAG'],
    ['Rust target/ without the tag', '.rustc_info.json'],
  ])('a folder holding a marker: %s', (_what, marker) => {
    expect(hasDependencyMarker(set(marker, 'lib'))).toBe(true);
    expect(isDependencyFolder({ name: 'env', children: set(marker), siblings: set() })).toBe(true);
  });

  // Generic names are content unless the tool that creates them is beside them.
  it.each([
    ['build', []],
    ['build', ['README.md']],
    ['target', ['package.json']],
    ['vendor', ['README.md']],
    ['bin', ['Makefile']],
    ['deps', []],
    ['dist', ['Cargo.toml']],
    ['docs', ['package.json']],
    ['env', []],
    ['notes', []],
    ['lib', ['package.json']],
  ])('keeps %s beside %j', (name, beside) => {
    expect(isDependencyFolder({ name, children: set('a.md'), siblings: new Set(beside) })).toBe(
      false,
    );
  });
});

describe('withoutDependencyFolders', () => {
  it('drops paths below dependency folders, judged from the listing', () => {
    expect(
      withoutDependencyFolders([
        'README.md',
        'go.mod',
        'vendor/github.com/x/README.md',
        'docs/vendor/notes.md', // No go.mod beside this vendor/: content.
        'env/pyvenv.cfg',
        'env/lib/README.md',
        'node_modules/pkg/README.md',
        'app/App.csproj',
        'app/bin/Debug/x.md',
        'app/README.md',
      ]).sort(),
    ).toEqual(['README.md', 'app/App.csproj', 'app/README.md', 'docs/vendor/notes.md', 'go.mod']);
  });

  it('never judges the opened folder itself', () => {
    // Opened node_modules/pkg explicitly: its own files are kept.
    expect(withoutDependencyFolders(['README.md', 'docs/api.md'])).toEqual([
      'README.md',
      'docs/api.md',
    ]);
  });
});

/** One folder per stack, each with Markdown that must or mustn't be listed. */
const KEPT = [
  'README.md',
  'docs/guide.md',
  'build/notes.md', // A docs folder called build/, with no build file beside it.
  'services/api/README.md',
  'apps/web/README.md',
  'tools/app/README.md',
];
const SKIPPED = [
  'node_modules/pkg/README.md',
  'apps/web/node_modules/react/README.md',
  'apps/web/.next/server/x.md',
  'env/lib/python3.12/site-packages/requests/README.md', // pyvenv.cfg below
  '.venv/lib/README.md',
  'conda-env/README.md', // conda-meta below
  'pkg/__pycache__/x.md',
  'mypkg.egg-info/README.md',
  'target/doc/crate/README.md', // beside Cargo.toml
  'services/api/vendor/github.com/x/README.md', // beside go.mod
  'tools/app/bin/Debug/x.md', // beside App.csproj
  'tools/app/obj/project.md',
  'ios/Pods/Alamofire/README.md',
  'infra/.terraform/modules/x/README.md',
];
const EXTRA_FILES = [
  'Cargo.toml',
  'target/CACHEDIR.TAG',
  'env/pyvenv.cfg',
  '.venv/pyvenv.cfg',
  'conda-env/conda-meta/history',
  'services/api/go.mod',
  'tools/app/App.csproj',
];

function writeTree(root: string, files: readonly string[]): void {
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), file.endsWith('.md') ? `# ${file}\n` : '');
  }
}

describe('discovery across stacks', () => {
  let root: string;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'browsedown-stacks-')));
    writeTree(root, [...KEPT, ...SKIPPED, ...EXTRA_FILES]);
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('a walked folder (outside git) lists the docs and none of the dependency folders', async () => {
    const result = await discoverFolder(root, { trusted: true });
    expect(result.discovery).toBe('walk');
    expect([...result.files].sort()).toEqual([...KEPT].sort());
  });

  it('a dependency folder opened explicitly is listed: explicit choice wins', async () => {
    const result = await walkFolder(join(root, 'node_modules'));
    expect(result.files).toContain('pkg/README.md');
    const venv = await discoverFolder(join(root, 'env'), { trusted: true });
    expect(venv.files).toContain('lib/python3.12/site-packages/requests/README.md');
  });
});

describe('discovery across stacks, in git', () => {
  let root: string;
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG, GIT_CONFIG_NOSYSTEM: '1' },
    });
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    noSystem: process.env.GIT_CONFIG_NOSYSTEM,
  };

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    root = realpathSync(mkdtempSync(join(tmpdir(), 'browsedown-stacks-git-')));
    writeTree(root, [...KEPT, ...SKIPPED, ...EXTRA_FILES, 'notes/plan.md']);
    // What projects usually ignore. The Go vendor/ and .NET bin/ are committed here,
    // as some repositories do, so git lists them: the rules must still drop them.
    writeFileSync(
      join(root, '.gitignore'),
      [
        'node_modules/',
        '.next/',
        'env/',
        '.venv/',
        'conda-env/',
        '__pycache__/',
        '*.egg-info/',
        'target/',
        'tools/app/obj/',
        '.terraform/',
        'ios/Pods/',
        'notes/',
        '',
      ].join('\n'),
    );
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [
      ['GIT_CONFIG_GLOBAL', saved.global],
      ['GIT_CONFIG_NOSYSTEM', saved.noSystem],
    ] as const) {
      if (value === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restoring the environment
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('drops committed dependency folders from git’s listing', async () => {
    expect(git('ls-files', 'services/api/vendor', 'tools/app/bin')).not.toBe('');
    const result = await discoverFolder(root, { trusted: true });
    expect(result.discovery).toBe('git');
    expect([...result.files].sort()).toEqual([...KEPT].sort());
  });

  it('Show Ignored Folders adds ignored docs, never an ignored environment or cache', async () => {
    const result = await discoverDocs(root, { trusted: true, includeIgnored: true });
    expect([...result.files].sort()).toEqual([...KEPT, 'notes/plan.md'].sort());
  });
});
