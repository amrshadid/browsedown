# Architecture

Browsedown uses a **functional core with an imperative shell**. The risky logic (is
this path inside the preview? where does this link point? what does the tree contain?) is
pure TypeScript with no VS Code or file-system access, so it can be tested exhaustively with
hostile inputs. A thin shell of adapters does the I/O.

```
src/
├── core/                 Pure logic: no `vscode`, no Node I/O (ESLint enforces this)
│   ├── environment.ts    Desktop-only rule: refuse remote and web windows
│   ├── scope.ts          Path guard, part 1: the spelling check
│   ├── links.ts          Resolve links relative to their document
│   ├── routes.ts         /s/<token>/… URLs, parsed from the raw request
│   ├── sessions.ts       In-memory preview sessions
│   ├── tree.ts           Paths → sidebar tree
│   ├── ignoreWalk.ts     .gitignore rules inside an opened ignored folder
│   ├── pages.ts          HTML page templates (layout, index, dead-link page)
│   └── html.ts           Escaping for the templates
├── render/
│   ├── markdown.ts       Markdown → sanitized HTML (unified pipeline)
│   └── yaml.ts           YAML → highlighted source
├── adapters/             I/O, no rules
│   ├── server.ts         The local HTTP server and every request check
│   ├── scopedFile.ts     Path guard, part 2: real paths on disk
│   ├── discovery.ts      Chooses git or the walker; filters through the guard
│   ├── gitIgnore.ts      git ls-files / check-ignore
│   ├── walker.ts         Folder walk for ignored folders and non-git folders
│   └── command.ts        The Explorer command: selection → session → URL
├── client/
│   ├── sidebar.ts        Tiny browser script: panels, theme, outline highlight
│   └── page.css          The page chrome, in GitHub's light and dark colours
└── extension.ts          Composition root: wiring and commands
```

Dependencies point inward: `extension.ts → adapters → core/render`. The client is
self-contained and runs in the browser.

## The life of a request

```
browser ── GET /s/<token>/f/docs/setup.md ──► server.ts
  1. method GET/HEAD, Host allowlist, Origin check
  2. routes.ts: parse the raw target; token → session (constant-time compare)
  3. scope.ts: decode once, reject hostile spellings
  4. scopedFile.ts: realpath, must stay inside the root; allowed file type
  5. markdown.ts: render and sanitize; links.ts resolves every link
  6. pages.ts: wrap in the layout with a fresh script nonce
  7. respond with strict security headers (CSP, no-referrer, no CORS)
```

## Rendering

The pipeline is unified (remark and rehype) in a fixed order:

```
parse → GFM → alerts → to HTML (keep raw HTML) → parse raw HTML
      → sanitize → heading ids → highlight → rewrite links → stringify
```

Sanitizing comes **before** heading ids, highlighting and link rewriting, so the trusted
markup they add isn't stripped, and everything the document itself contains is checked. A
golden test pins the exact output for an adversarial sample document.

## Discovery

- **Normal folder in git:** `git ls-files --cached --others --exclude-standard`, filtered to
  Markdown. Git is the authority on its own ignore rules.
- **An ignored folder you opened, or a folder outside git:** walk the folder and apply only
  the `.gitignore` files inside it, plus any files git tracks there. Rules from outside the
  folder don't apply: the folder you picked is the boundary.
- **A single file:** no scan at all.

## Why these choices

- **Two-part path guard.** Checking the spelling alone misses symlinks, and checking the disk
  alone is easy to get subtly wrong with encodings and Windows paths. Both must pass, and
  the tests check each part independently.
- **Real links, no single-page app.** Every page is a normal URL, so the browser's own
  history, bookmarks and new-tab behaviour work without code.
- **In-memory sessions.** Nothing is written anywhere. A preview lives until VS Code closes
  or you stop it.
- **unified for rendering.** It is the only stack we found that sanitizes and rewrites links
  in raw HTML and Markdown in one syntax tree, so an `<img src>` written as HTML can't escape
  the scope.

## Testing

| Layer        | Tool                               | What                                                             |
| ------------ | ---------------------------------- | ---------------------------------------------------------------- |
| Core, render | Vitest                             | Table-driven hostile inputs, golden HTML. Coverage ≥ 90%.        |
| Security     | Vitest                             | One table with a row per control (`test/unit/security.test.ts`). |
| Adapters     | Vitest + real git                  | A git repository built at test time covering every ignore case.  |
| End to end   | `@vscode/test-cli` in real VS Code | Run the command, then make HTTP requests to the server.          |
