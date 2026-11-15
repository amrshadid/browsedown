# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/amrshadid/browsedown/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/amrshadid/browsedown/releases/tag/v0.1.0
