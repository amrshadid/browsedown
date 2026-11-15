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
- On narrow windows both panels float over the page, and Esc closes them.

A link to something that's missing, or outside what you opened, leads to a page that says
which one it is, never a silent error or the wrong file.

## Commands

| Command                           | Where                                                 |
| --------------------------------- | ----------------------------------------------------- |
| **Open in Browser**               | Right-click a folder, Markdown or YAML file           |
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

A tracked file stays visible even if an ignore pattern matches it later, as in git
([gitignore documentation](https://git-scm.com/docs/gitignore)).

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
  allows only the extension's own small sidebar script.
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

These are deliberate choices for the first release:

- **Local desktop windows only.** Remote, WSL, Codespaces and VS Code for the Web aren't
  supported yet: they tunnel the local server through a different address, which the
  security checks refuse.
- **Remote images are not loaded**, including badges. They show their alt text instead, to
  keep the no-network promise.
- **GitHub Flavored Markdown only.** No Mermaid, math or MDX.
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
