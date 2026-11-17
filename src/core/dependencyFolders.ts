/**
 * Dependency, environment, cache and build-output folders: installed packages,
 * virtual environments and compiler output. Their Markdown (thousands of package
 * READMEs) is never what a reader opened a folder for, so discovery doesn't enter
 * them. The folder the reader opened is never judged: explicit choice wins.
 *
 * A folder is one when any of these holds:
 *
 * 1. Its name belongs to one tool only (`node_modules`, `__pycache__`, `.gradle`).
 * 2. It holds a marker file, whatever it is called: every Python virtual
 *    environment has `pyvenv.cfg` (`env/`, `.venv/`, `my-env/`), a Conda
 *    environment `conda-meta/`, and caches such as Rust's `target/` carry the
 *    standard `CACHEDIR.TAG` (https://bford.info/cachedir/).
 * 3. Its name is generic (`target`, `vendor`, `build`, `bin`) and it sits next to
 *    the project file of the tool that creates it: `target/` beside `Cargo.toml`,
 *    `vendor/` beside `go.mod`. A `build/` folder of real docs, with no build
 *    file beside it, stays visible.
 *
 * Pure: callers pass the names inside the folder and beside it.
 */

/** Names that belong to one tool. Version-control folders are included: never content. */
const TOOL_FOLDERS: ReadonlySet<string> = new Set([
  // Version control
  '.git',
  '.hg',
  '.svn',
  '.jj',
  // JavaScript and TypeScript
  'node_modules',
  'bower_components',
  'jspm_packages',
  'web_modules',
  '.pnpm-store',
  '.yarn',
  '.npm',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.angular',
  '.astro',
  '.docusaurus',
  '.parcel-cache',
  '.turbo',
  '.nx',
  '.vercel',
  '.netlify',
  '.expo',
  '.wrangler',
  '.vite',
  '.nyc_output',
  '.sass-cache',
  // Python
  '__pycache__',
  '__pypackages__',
  '.venv',
  '.tox',
  '.nox',
  '.eggs',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.pytype',
  '.pyre',
  '.hypothesis',
  '.ipynb_checkpoints',
  '.pixi',
  'site-packages',
  'dist-packages',
  // JVM (Java, Kotlin, Scala, Clojure)
  '.gradle',
  '.m2',
  '.kotlin',
  '.bsp',
  '.bloop',
  '.metals',
  '.cpcache',
  '.shadow-cljs',
  // Ruby
  '.bundle',
  // Apple platforms
  'Pods',
  'DerivedData',
  '.swiftpm',
  // Dart and Flutter
  '.dart_tool',
  '.pub-cache',
  // Haskell, OCaml, Elm, Elixir, Erlang, Zig
  '.stack-work',
  'dist-newstyle',
  '.cabal-sandbox',
  '_opam',
  '_esy',
  'elm-stuff',
  '.elixir_ls',
  '.zig-cache',
  'zig-cache',
  'zig-out',
  // R
  'renv',
  'packrat',
  // .NET
  '.vs',
  // Infrastructure as code and serverless
  '.terraform',
  '.terragrunt-cache',
  '.serverless',
  '.aws-sam',
  // Environments and generic caches
  '.direnv',
  '.devenv',
  '.cache',
  '.vscode-test',
]);

/** Name patterns that belong to one tool. */
const TOOL_FOLDER_PATTERNS: readonly RegExp[] = [
  /\.egg-info$/, // Python packaging metadata
  /^bazel-/, // Bazel output links (bazel-bin, bazel-out, bazel-<workspace>)
  /^cmake-build-/, // CLion's CMake output (cmake-build-debug)
];

/** Files or folders inside a folder that mark it as an environment or a cache. */
const MARKERS: ReadonlySet<string> = new Set([
  'pyvenv.cfg', // Every Python virtual environment, whatever its name
  'conda-meta', // A Conda environment
  'CACHEDIR.TAG', // The cache-directory standard (Rust's target/, many caches)
  '.rustc_info.json', // Rust's target/, also in older toolchains without CACHEDIR.TAG
]);

/** A project file: an exact name, or a pattern (`*.csproj`). */
type ProjectFile = string | RegExp;

const DOTNET: readonly ProjectFile[] = [/\.(cs|fs|vb)proj$/, /\.sln$/];

/** Generic names, skipped only beside the project file of a tool that creates them. */
const BESIDE_PROJECT: ReadonlyMap<string, readonly ProjectFile[]> = new Map([
  ['target', ['Cargo.toml', 'pom.xml', 'build.sbt', 'project.clj', 'build.boot']],
  ['vendor', ['go.mod', 'composer.json', 'Gemfile']],
  [
    'build',
    [
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
      'CMakeLists.txt',
      'pubspec.yaml',
      'setup.py',
      'pyproject.toml',
      'package.json',
    ],
  ],
  ['dist', ['package.json', 'setup.py', 'pyproject.toml']],
  ['out', ['package.json', 'tsconfig.json', 'build.gradle', 'build.gradle.kts']],
  ['coverage', ['package.json', 'pyproject.toml', 'setup.py', 'Gemfile']],
  ['bin', DOTNET],
  ['obj', DOTNET],
  ['packages', [/\.sln$/]],
  ['deps', ['mix.exs', 'rebar.config']],
  ['_build', ['mix.exs', 'rebar.config', 'dune-project']],
  ['.build', ['Package.swift']],
  ['Carthage', ['Cartfile']],
  ['Library', ['ProjectSettings']], // Unity
  ['Temp', ['ProjectSettings']], // Unity
]);

/** What {@link isDependencyFolder} needs to know about a folder. */
export interface FolderContext {
  readonly name: string;
  /** Names directly inside the folder (files and folders). */
  readonly children: ReadonlySet<string>;
  /** Names directly inside its parent, including the folder itself. */
  readonly siblings: ReadonlySet<string>;
}

/** Rules 1 and 3: decided from the name and what sits beside it, before reading the folder. */
export function isDependencyFolderByName(name: string, siblings: ReadonlySet<string>): boolean {
  if (TOOL_FOLDERS.has(name) || TOOL_FOLDER_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  const projectFiles = BESIDE_PROJECT.get(name);
  if (projectFiles === undefined) {
    return false;
  }
  return projectFiles.some((file) =>
    typeof file === 'string' ? siblings.has(file) : [...siblings].some((s) => file.test(s)),
  );
}

/** Rule 2: decided from what the folder holds. */
export function hasDependencyMarker(children: ReadonlySet<string>): boolean {
  for (const marker of MARKERS) {
    if (children.has(marker)) {
      return true;
    }
  }
  return false;
}

/** Whether discovery should leave the folder out (all three rules). */
export function isDependencyFolder(folder: FolderContext): boolean {
  return (
    isDependencyFolderByName(folder.name, folder.siblings) || hasDependencyMarker(folder.children)
  );
}

/**
 * Drops paths that pass through a dependency folder, judging each folder from the
 * listing itself: its children and siblings are the listed paths below it and
 * beside it. Used on git's listing, which already left ignored files out, so this
 * catches what a repository commits (a `vendor/` folder, a checked-in `.venv`).
 * Paths are relative to the opened folder, which is never judged.
 */
export function withoutDependencyFolders(paths: readonly string[]): string[] {
  const children = new Map<string, Set<string>>();
  const childrenOf = (folder: string): Set<string> => {
    let set = children.get(folder);
    if (set === undefined) {
      set = new Set();
      children.set(folder, set);
    }
    return set;
  };
  for (const file of paths) {
    const segments = file.split('/');
    for (let i = 0; i < segments.length; i += 1) {
      childrenOf(segments.slice(0, i).join('/')).add(segments[i] ?? '');
    }
  }
  const verdicts = new Map<string, boolean>();
  const isSkipped = (folder: string): boolean => {
    const known = verdicts.get(folder);
    if (known !== undefined) {
      return known;
    }
    const slash = folder.lastIndexOf('/');
    const parent = slash === -1 ? '' : folder.slice(0, slash);
    const verdict =
      (parent !== '' && isSkipped(parent)) ||
      isDependencyFolder({
        name: folder.slice(slash + 1),
        children: children.get(folder) ?? new Set(),
        siblings: children.get(parent) ?? new Set(),
      });
    verdicts.set(folder, verdict);
    return verdict;
  };
  return paths.filter((file) => {
    const slash = file.lastIndexOf('/');
    return slash === -1 || !isSkipped(file.slice(0, slash));
  });
}
