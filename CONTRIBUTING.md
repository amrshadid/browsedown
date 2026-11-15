# Contributing to Browsedown

Thanks for helping. This is a small project with a narrow scope, so please read
[docs/design-principles.md](docs/design-principles.md) before proposing a feature. The
first question for any change is: _does it help someone read the folder or file they
picked?_

## Getting started

Requirements: Node.js 22 or later (see `.nvmrc`), git, and VS Code.

```sh
npm ci
npm run check   # lint, formatting, type check, unit tests
```

Press **F5** in VS Code to launch an **Extension Development Host**. It runs in a separate
window with a temporary profile (`--profile-temp`) and the test fixture folder, so your
own settings, extensions and projects aren't affected.

| Script                     | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `npm run build`            | Bundle to `dist/` with esbuild (extension, sidebar script, CSS) |
| `npm run build:prod`       | Minified build; fails if the extension bundle exceeds 700 KB    |
| `npm run watch`            | Rebuild on change                                               |
| `npm test`                 | Unit tests (Vitest)                                             |
| `npm run test:coverage`    | Unit tests with coverage thresholds                             |
| `npm run test:integration` | End-to-end tests in a downloaded, isolated VS Code              |
| `npm run lint`             | ESLint (strict, type-aware, with architecture boundaries)       |
| `npm run format`           | Prettier                                                        |
| `npm run package`          | Build a `.vsix`                                                 |

## Where code goes

See [docs/architecture.md](docs/architecture.md). In short:

- **Path, link, scope, tree and page logic** goes in `src/core/`. It is pure: no `vscode`,
  no Node I/O. ESLint enforces this.
- **Markdown and YAML rendering** goes in `src/render/`, also pure.
- **I/O** (the HTTP server, file reads, git, the Explorer command) goes in `src/adapters/`.
  Keep it thin, with no rules that could live in the core.
- **The browser sidebar script** goes in `src/client/`. No framework, no globals.
- **Wiring** goes in `src/extension.ts`.

## Standards

- TypeScript `strict` with `exactOptionalPropertyTypes`. No `any`; use `unknown` and narrow it.
- Comments explain _why_. Link to the docs when working around VS Code, Node or unified behaviour.
- New logic ships with tests. A bug fix starts with a failing test.
- **Security changes** must keep `test/unit/security.test.ts` passing and add rows for new controls.
- **Rendering changes** may change the golden HTML in `test/fixtures/render/`. Review that
  diff carefully: it is the contract. Fixtures are byte-exact, and Prettier never touches them.
- Fixture git repositories are built at test time (`test/support/ignoreTableRepo.ts`), never
  committed as nested repositories.
- No new runtime dependencies without a design decision first. The rendering packages are
  pinned exactly.
- No telemetry, network access, or files written into the user's repository. These are
  product promises.

## Dependencies

`package.json` has `overrides` that pin patched versions of a few packages deep inside the
dev tooling. Remove an override once the packages that use it depend on a patched version.

## Commits and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
fix(server): refuse requests with a mismatched Origin

A present Origin header must match the server's own origin.
```

- Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.
- Scopes: `core`, `render`, `server`, `discovery`, `client`, `command`, `config`, `ci`, `docs`, `deps`.
- Keep the subject imperative and under 72 characters. Use the body to explain _why_.
- One logical change per commit. Pull requests are squash-merged, so the PR title must also
  follow the convention.

Before opening a PR, make sure `npm run check` and `npm run test:integration` pass, and
fill in the PR template.

## Reporting bugs

Open an issue with the bug template and include a minimal Markdown sample. The
**Browsedown** output channel (_View → Output_) logs events and errors (never file
contents), and including it helps.

For security issues, see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
