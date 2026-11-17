# Security policy

Browsedown runs a small web server on your machine so your browser can show the
Markdown you opened. A server like that is reachable by any web page you visit, so the
design assumes a hostile page is trying to read your files.

Every control below has an automated test that runs against the real server over HTTP
(`test/unit/security.test.ts`, one row per control), and the checklist is run again before
each release.

## Threat model

**What we protect:** the contents of files on your machine, and the fact that they exist.

**Who attacks:** a web page open in any browser tab, including pages that use DNS rebinding
to make requests look same-origin, or that guess URLs. A Markdown file in the folder you
opened may also contain hostile HTML or links.

**Out of scope:** malware already running as your user, and someone with access to your
unlocked machine.

## Controls

| Control                                                                                                                                                                                                                                               | What it stops                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Listens on `127.0.0.1` only, on a port the OS chooses                                                                                                                                                                                                 | Other machines on the network                                                  |
| `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, else 421                                                                                                                                                                              | DNS rebinding                                                                  |
| `GET` and `HEAD` only, and a present `Origin` must match                                                                                                                                                                                              | Cross-site writes; there are no write endpoints at all                         |
| Each preview has a random 256-bit session token in its URL, compared in constant time; unknown tokens get 404                                                                                                                                         | Guessed URLs                                                                   |
| `Referrer-Policy: no-referrer`                                                                                                                                                                                                                        | The token leaking to sites you click through to                                |
| A strict Content Security Policy with a per-response nonce; HTML is sanitized, and `name` attributes are prefixed                                                                                                                                     | Scripts in documents; a document breaking the page script (DOM clobbering)     |
| Mermaid diagrams are drawn in a sandboxed frame (an opaque origin with its own policy: no network, only this server may frame it, and no session token). The page shows the results only as images, and allows the frame only on pages with a diagram | Diagram text running script in the page, or reaching your files or the network |
| Folders and files you hide in Browsedown are never served, judged on their real path after both path checks (so a symlink into a hidden folder is refused too)                                                                                        | Serving something you chose to keep out of your previews                       |
| Raw images are served with a `sandbox` policy                                                                                                                                                                                                         | An SVG opened directly running script                                          |
| No CORS headers, ever                                                                                                                                                                                                                                 | Other sites reading responses                                                  |
| Only Markdown, YAML and common image types are served                                                                                                                                                                                                 | Reading arbitrary files in scope                                               |
| **Path guard, part 1 (spelling):** decode once; reject `..`, `.`, empty segments, NUL and control characters; on Windows also backslashes, `:` (drive letters, NTFS streams), device names and trailing dots or spaces                                | Encoded traversal such as `%2e%2e%2f` and `%252e`, Windows path tricks         |
| **Path guard, part 2 (on disk):** resolve the real path of the root and the target; the target must be a regular file strictly inside the root                                                                                                        | Symlinks that point outside the folder                                         |
| Logs hold lifecycle events and error codes only; never file contents, paths or tokens                                                                                                                                                                 | Leaks through logs                                                             |

The same path guard applies to the folder or file you open, every request and every
rewritten link.

**What the session URL unlocks.** A preview serves Markdown, YAML and images anywhere
inside the folder it was opened on (for a single file: its workspace folder), including
files git ignores, so that links to them work. The tree only lists what discovery finds,
but anyone who has the URL can request any such file in that scope. The URL never leaves
your machine on its own (no referrer, no network calls), and it stops working when VS Code
closes or you run **Stop All Previews**. Treat it like a password: don't paste it anywhere.

**git safety:** git runs only with read-only commands, never in an untrusted workspace,
always with `core.fsmonitor` disabled (so a repository's config can't make git start
another program), and on Windows by absolute path, never from the workspace folder.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository instead (**Security → Report a vulnerability**).

We aim to acknowledge reports within 7 days. Only the latest release is supported with fixes.
