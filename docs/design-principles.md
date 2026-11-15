# Design principles

Browsedown follows **HCD (Human-Centred Design)**: the reader, their task and their
trust come before features. Our user is a developer who wants to _read_ a folder of
Markdown, not build a site.

Use these principles to judge features, defaults and pull requests. If a change doesn't help
someone read the folder or file they picked, it's out of scope.

## 1. One action, exact scope

What you right-click is the boundary and the tree. There are no settings, no site config and
no build step. Opening the same folder twice gives two independent previews.

## 2. Reading, not tooling

Pages look like GitHub, follow the system's light or dark theme, and the sidebar stays quiet.
The browser does what browsers do: history, copy link, open in a new tab, find on the page.
Links are ordinary links, so we never reimplement navigation.

## 3. Respect the repository's intent, and let explicit choice win

Automatic discovery follows git, including every ignore source (`.gitignore`, the local
`.git/info/exclude`, global excludes), because ignored files are usually noise. But if you
explicitly open an ignored folder or file, you asked for it, so you get it, with the
`.gitignore` files inside that folder still applied.

## 4. Honest navigation

Links resolve the way they do on GitHub: relative to the file that contains them. A link to
something missing or outside the preview leads to a page that says which one, never a silent
404 or the wrong file.

## 5. Private and safe by default

The server listens on `127.0.0.1` only, behind an unguessable session URL and `Host` checks.
Scripts in documents never run, nothing outside the opened folder is served (encoded
traversal and symlinks included), and there are no network calls and no telemetry. The
extension is read-only. See [SECURITY.md](../SECURITY.md).

## 6. Light footprint

Scan once when a preview opens, render each page when it's requested, and run nothing when
no preview is open. No live reload; reload the page instead.

## 7. Evaluate with real people

Every feature has to earn its place in the pilot: do readers get the view they wanted in one
action? We'd rather do one thing reliably than many things loosely.
