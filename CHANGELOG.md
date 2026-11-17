# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Hide in Browsedown.** Right-click a folder or file in the Explorer or the Browsedown view
  to hide it: it leaves every tree and list and is never served, judged on its real path, so
  a symlink into it is refused too. It works for tracked files, and Show Ignored Folders
  doesn't bring it back. Saved per workspace in VS Code; nothing is written to the
  repository. Unhide from the Hidden section of the Browsedown view or the Command Palette.

## [0.3.0] - 2026-11-17

Third pilot pre-release.

### Added

- **The Browsedown sidebar.** A view in the Activity Bar lists every Markdown file in the
  workspace, the way git sees them. **Open All in Browser** opens the whole list with its
  tree; clicking a doc opens it in that same view. **Show Ignored Folders** adds the docs in
  folders `.gitignore` hides, each read as if you had opened it. The list is gathered only
  while the view is open, and updates when files change in VS Code.
- **Packages, environments and build output are skipped in every stack**: `node_modules`,
  Python virtual environments whatever they're called, Rust and Maven `target/`, Go, PHP and
  Ruby `vendor/`, .NET `bin/` and `obj/`, CocoaPods, Gradle, Dart, Haskell, Elixir,
  Terraform and more, even when a repository commits them. Opening one yourself shows it.
- **Open in Browser from the editor.** A button in the title bar of an open Markdown file
  opens it in the same view, with the tree.

## [0.2.0] - 2026-11-16

Second pilot pre-release.

### Added

- **Mermaid diagrams.** A ` ```mermaid ` block is drawn as a diagram, in the page's light or
  dark theme. **Preview** and **Code** switch between the diagram and its source; the code
  shows while the diagram is drawn, and with a short reason if it can't be. Alt text comes
  from the diagram's `accTitle` and `accDescr`.

### Security

- Diagrams are drawn in a sandboxed frame with its own Content Security Policy: no network,
  no access to the page or the session token. The page shows its output only as images, and
  only pages with a diagram may frame it. Every other page keeps the same policy as before.

## [0.1.0] - 2026-11-15

First pilot pre-release.

### Added

- **Open in Browser** on a folder, Markdown or YAML file in the Explorer: a private local
  page in your default browser. **Stop All Previews** closes the server.
- GitHub Flavored Markdown with GitHub's styles, alerts, footnotes, task lists, syntax
  highlighting and GitHub-style heading ids.
- A file tree scoped to the folder you opened, with folders that open and close; an outline
  of the page's headings that follows the section you're reading; both panels close and
  remember their state.
- Light and dark themes (GitHub's own), following the system or chosen with a button.
- Discovery that follows git (tracked plus untracked files that aren't ignored). An ignored
  folder you open explicitly is listed with only its own `.gitignore` rules, and
  force-added files stay visible.
- Relative links, anchors and images that resolve like on GitHub, with ordinary browser
  history. A dead link leads to a page that says whether the file is missing or outside
  the folder.
- YAML files shown as highlighted source.

### Security

- The server listens on 127.0.0.1 only, behind a random 256-bit session token, with a Host
  allowlist (against DNS rebinding), GET/HEAD only, an Origin check and no CORS.
- Two-part path guard: the spelling (encoded traversal, Windows path quirks) and the disk
  (symlinks out of the folder), on every request and every link.
- Sanitized documents, a strict Content Security Policy with a per-response nonce, and
  sandboxed raw images. The page script can't be broken by a document (DOM clobbering).
  No remote images, no network calls, no telemetry. Read-only.
- Logs hold lifecycle events and error codes only: no paths, tokens or file contents.

[Unreleased]: https://github.com/amrshadid/browsedown/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/amrshadid/browsedown/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/amrshadid/browsedown/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amrshadid/browsedown/releases/tag/v0.1.0
