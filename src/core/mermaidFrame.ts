/**
 * The document of the Mermaid renderer frame (ADR 0007). The page loads it in an
 * `<iframe sandbox="allow-scripts">`, so it runs in an opaque origin: no access to
 * the page, its storage or the session. The server sends it with its own CSP
 * (nonced scripts, no network) and the page only ever shows its output as images.
 *
 * Both scripts are inlined with the nonce. Loading them by URL would not work:
 * requests from an opaque origin are cross-origin, which the server's
 * `Cross-Origin-Resource-Policy` and Origin check refuse.
 */
import { escapeHtml } from './html';

/** Characters a CSP nonce may contain (base64 and base64url). */
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Text that would end an inline `<script>` element early: `</script`, or
 * `<script`, which after a `<!--` stops a later `</script>` from closing it.
 * A `<!--` on its own is harmless (Mermaid's build has two).
 * https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
 */
const SCRIPT_BREAKERS = /<\/?script/i;

/**
 * Renders the frame document. `libraryJs` is Mermaid's browser build and
 * `rendererJs` our message handler; both are inlined, so neither may contain
 * text that would close the script element early.
 */
export function renderMermaidFrame(nonce: string, libraryJs: string, rendererJs: string): string {
  if (!NONCE.test(nonce)) {
    throw new Error('renderMermaidFrame(): invalid nonce');
  }
  for (const script of [libraryJs, rendererJs]) {
    if (SCRIPT_BREAKERS.test(script)) {
      throw new Error('renderMermaidFrame(): a script contains markup that would end it early');
    }
  }
  const n = escapeHtml(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Diagram renderer</title>
</head>
<body>
<script nonce="${n}">${libraryJs}</script>
<script nonce="${n}">${rendererJs}</script>
</body>
</html>
`;
}
