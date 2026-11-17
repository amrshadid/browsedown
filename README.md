<p align="center"><img src="media/icon.png" width="128" alt="Browsedown icon"></p>

# Browsedown

**Right-click a Markdown folder or file in VS Code and read it in your browser.**

You get a GitHub-style page, a sidebar tree scoped to exactly what you picked, and links,
anchors and Back/Forward that just work. No config, and nothing is written to your repository.

> [!NOTE]
> **Pilot pre-release (v0.1.0).** It works, and we're testing it with a few readers before a
> wider release. Feedback is very welcome: [open an issue](https://github.com/amrshadid/browsedown/issues).

## Install

Download `browsedown-0.1.0.vsix` from the [latest release](https://github.com/amrshadid/browsedown/releases), then in VS Code
open the Extensions view, choose **…** → **Install from VSIX…**, and pick the file. It needs
VS Code 1.100 or newer on a local desktop window.

## Why

Repositories are full of Markdown meant to be _read_: `docs/`, READMEs, decision records,
plans and runbooks. More and more of it is written by coding agents, and some of it lives
in folders git ignores. You still need to read it, review it and follow its links.

The usual options each get in the way:

- **The editor preview** shows one file at a time inside the editor, with no tree, and links
  open more editor tabs.
- **A Git host's renderer** needs a push, and can't show ignored or uncommitted files.
- **Documentation site generators** need config, a scaffold and a build. That's a lot of
  work to read a folder once.

Browsedown gives you the ordinary experience of reading docs on the web (a tree, real
links, Back and Forward, a tab you keep open next to the editor) in one click, on exactly
the folder or file you chose. More in [docs/why.md](docs/why.md).

## How it works

1. **Right-click** a folder, or a `.md`, `.markdown`, `.yml` or `.yaml` file in the Explorer.
2. Choose **Open in Browser**.
3. A private tab opens in your default browser.

| You open      | You get                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| A folder      | A collapsible tree of its Markdown files (empty branches left out), starting at its `README.md` or a file index. |
| Markdown file | That page, with working links to other files nearby. No tree.                                                    |
| YAML file     | Syntax-highlighted source in the same layout.                                                                    |

Or use the **Browsedown** view in the Activity Bar (the book icon). It lists every Markdown
file in your workspace, the way git sees them:

- **Open All in Browser** (the arrow at the top) opens the whole list in the browser, with
  the tree.
- **Click a doc** to open it in that same view, with the tree beside it.
- **Show Ignored Folders** (the eye) adds the docs in folders `.gitignore` hides, such as
  agent notes. Each ignored folder is listed as if you had opened it yourself.
  Installed packages, virtual environments and build output stay out (see below).
- Hover a folder to open just that folder, or a doc to open it in the editor.

The list is gathered when the view is open and updates when files change in VS Code; the
refresh button gathers it again.

Editing a Markdown file? The **Open in Browser** button in the editor's title bar opens it
in the same view, with the tree. The page doesn't reload by itself: reload the tab after you
save. For a live preview of diagrams while you write, VS Code's own preview with the
[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)
extension is the right tool.

Relative links, heading anchors and local images resolve from the file that contains them,
the way they do on GitHub. Links are ordinary browser links, so Back, Forward, copy link and
open-in-new-tab all work.

Made for reading:

- **File tree** on the left: folders open and close, the current file is highlighted, and the
  panel closes when you want the room. It remembers your choices while you browse.
- **Outline** of the page's headings on the right, closed until you open it. It follows the
  section you're reading.
- **Light and dark**: pages follow your system, or pick Light or Dark with the theme button.
  These are GitHub's own themes.
- **Mermaid diagrams**: a ` ```mermaid ` block is drawn as a diagram, in the page's light or
  dark theme. **Preview** and **Code** switch between the diagram and its source, and the
  code stays visible while the diagram is drawn or if it can't be.
- On narrow windows both panels float over the page, and Esc closes them.

A link to something that's missing, or outside what you opened, leads to a page that says
which one it is, never a silent error or the wrong file.

## Commands

| Command                           | Where                                                 |
| --------------------------------- | ----------------------------------------------------- |
| **Open in Browser**               | Right-click a folder, Markdown or YAML file           |
| **Open in Browser** (editor)      | The title bar of an open Markdown file                |
| **Open All in Browser**           | The Browsedown view, or the Command Palette           |
| **Show / Hide Ignored Folders**   | The Browsedown view, or the Command Palette           |
| **Refresh Docs**                  | The Browsedown view, or the Command Palette           |
| **Browsedown: Stop All Previews** | Command Palette. Closes the local server immediately. |

Previews also stop when VS Code closes. Nothing runs when no preview is open.

## Which files appear

Automatic discovery follows git. Opening something yourself is an explicit choice, and it wins.
"Ignored" means ignored by any of git's sources: `.gitignore` files, the repository's local
`.git/info/exclude`, or your global excludes file.

| Action                                                     | Result                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Open `docs/`                                               | Tracked Markdown, plus untracked Markdown that isn't ignored. Ignored files stay out of the tree.                      |
| Open an ignored file, such as `drafts/notes.md`            | That file is rendered. Other listings are unchanged.                                                                   |
| Open an ignored folder, such as `drafts/`                  | Its Markdown is listed. The rule that hides the folder itself is overridden; `.gitignore` files inside it still apply. |
| Follow a link to an ignored Markdown or YAML file in scope | The linked file is rendered. It stays out of the tree.                                                                 |
| The Browsedown view                                        | The whole workspace, listed like opening its folder: ignored files stay out.                                           |
| The Browsedown view with **Show Ignored Folders**          | Also the Markdown in ignored folders and files, each folder listed as if you opened it.                                |

A tracked file stays visible even if an ignore pattern matches it later, as in git
([gitignore documentation](https://git-scm.com/docs/gitignore)).

**Packages, environments and build output are skipped, in every stack.** Their Markdown is
thousands of package READMEs, not your docs, so Browsedown never looks inside them, even if
the repository commits them (a `vendor/` folder, say). A folder is skipped when:

- its name belongs to one tool: `node_modules`, `__pycache__`, `.venv`, `.tox`, `.gradle`,
  `Pods`, `.dart_tool`, `.stack-work`, `elm-stuff`, `.terraform` and more;
- it holds a marker file, whatever it's called: `pyvenv.cfg` (any Python virtual
  environment), `conda-meta` (Conda) or `CACHEDIR.TAG` (Rust's `target/` and other caches);
- or its name is generic and the tool that creates it is right beside it: `target/` next to
  `Cargo.toml` or `pom.xml`, `vendor/` next to `go.mod`, `composer.json` or `Gemfile`,
  `bin/` and `obj/` next to a `.csproj`, `build/` next to a Gradle, CMake or Flutter build
  file, `deps/` and `_build/` next to `mix.exs`. A `build/` folder of real docs with no
  build file beside it is listed as usual.

Opening one of these folders yourself shows all of it: your explicit choice wins. The
complete list is in
[`src/core/dependencyFolders.ts`](src/core/dependencyFolders.ts).

## Private and safe by default

A local server that serves your files is something any web page you visit could try to
reach. In 2026, flaws of exactly this kind were disclosed in popular VS Code extensions
([report](https://thehackernews.com/2026/02/critical-flaws-found-in-four-vs-code.html)).
So security is part of the design:

- The server listens on `127.0.0.1` only, on a port the OS picks, and each preview has an
  unguessable session URL.
- Requests with an unexpected `Host` header are refused, which blocks DNS rebinding.
- It serves only what you opened. Paths are checked twice: once by their spelling (encoded
  `../` tricks and Windows path quirks included) and once on disk (symlinks out of the
  folder are refused).
- Scripts in documents never run. HTML is sanitized, and a strict Content Security Policy
  allows only the extension's own small page script.
- Mermaid diagrams are drawn in a sandboxed frame that can't reach the page, your files or
  the network. The page shows what it draws only as images.
- Read-only, with no network calls, no remote images, no telemetry and no CORS.

See [SECURITY.md](SECURITY.md) for the threat model and how to report a problem.

## Design principles

Browsedown follows **HCD (Human-Centred Design)**: the reader, their task and their
trust come before features.

- **One action, exact scope.** What you right-click is the boundary and the tree.
- **Reading, not tooling.** GitHub-familiar pages, and the browser does what browsers do.
- **Respect the repository's intent.** Discovery follows git; your explicit choice wins.
- **Honest navigation.** Links resolve like on GitHub, and dead ends say why.
- **Private and safe by default.** See above.
- **Light footprint.** Scan once, render on request, and nothing runs when no preview is open.

More in [docs/design-principles.md](docs/design-principles.md).

## Limitations

These are deliberate choices for now:

- **Local desktop windows only.** Remote, WSL, Codespaces and VS Code for the Web aren't
  supported yet: they tunnel the local server through a different address, which the
  security checks refuse.
- **Remote images are not loaded**, including badges. They show their alt text instead, to
  keep the no-network promise.
- **GitHub Flavored Markdown and Mermaid only.** No math or MDX.
- **Diagrams are images.** Text inside a diagram can't be selected or found with the
  browser's find, and Mermaid `click` links don't work. **Code** shows the source.
- **No live reload.** Reload the page to see edits.
- An ignored folder you open inherits no rules from outside it: only the `.gitignore` files
  inside it apply.
- In an untrusted workspace, git isn't run. Folders are listed by walking them and applying
  the `.gitignore` files inside them.
- Very large folders: a walked folder's tree stops after 20,000 entries, and says so.
- Your Light or Dark choice lasts until VS Code restarts, because each session gets a new
  private address.

## How it compares

As of November 2026, we found no VS Code extension on the Visual Studio Marketplace or Open
VSX that, from a single Explorer right-click on a folder or file, opens the system browser
with a sidebar tree scoped to that folder, discovers Markdown the way git does (tracked plus
untracked-but-not-ignored, while still letting you browse an ignored folder you selected),
and keeps relative links, heading anchors and browser Back/Forward working across files.
Several tools cover parts of this, for example Markdown Mirror, Markdown Forge, Markdown
Live Server and seemore.

If you know of one that does all of it, please open an issue. We'd rather point people to it.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get set up. The
architecture is described in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
