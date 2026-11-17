/**
 * The server's URL space. Everything a session serves lives under `/s/<token>/`;
 * the bundled assets are public and shared under `/__assets/`, and so is the
 * Mermaid renderer frame at `/__mermaid`: it holds only library code, so it needs
 * no token, and a compromised frame never learns one (ADR 0007).
 *
 * Request targets are parsed from the **raw** string, never through `new URL()`:
 * the WHATWG URL parser treats `%2e%2e` as `..` and resolves dot segments, which
 * would quietly turn `/s/T/f/%2e%2e/x` into `/s/T/x` before the scope guard ever
 * saw it. Here the file path stays exactly as sent, for `checkScopedPath` to judge.
 */

/** A session token: 32 random bytes in base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The bundled files the server may send from `/__assets/`. Anything else is 404. */
const ASSET_NAMES = ['github-markdown.css', 'highlight.css', 'page.css', 'sidebar.js'] as const;
export type AssetName = (typeof ASSET_NAMES)[number];

/** The sandboxed frame that draws Mermaid diagrams for a page. */
export const MERMAID_FRAME_PATH = '/__mermaid';

/** Why a link leads to the explanation page instead of a file. */
/** Why a link leads to the explanation page: outside the scope, not there, or hidden by the reader. */
export type MissingReason = 'outside' | 'missing' | 'hidden';

export type Route =
  | { readonly kind: 'asset'; readonly name: AssetName }
  | { readonly kind: 'favicon' }
  | { readonly kind: 'mermaid-frame' }
  | { readonly kind: 'entry'; readonly token: string }
  | { readonly kind: 'index'; readonly token: string }
  | { readonly kind: 'file'; readonly token: string; readonly encodedPath: string }
  | {
      readonly kind: 'missing';
      readonly token: string;
      readonly ref: string;
      readonly reason: MissingReason;
    }
  | { readonly kind: 'not-found' };

const NOT_FOUND: Route = { kind: 'not-found' };

/**
 * Parses a raw HTTP request target such as `/s/<token>/f/docs/My%20Notes/a.md?x#y`.
 * Pure and total: anything unexpected is `not-found`.
 */
export function parseRoute(target: string): Route {
  if (!target.startsWith('/')) {
    return NOT_FOUND;
  }
  const queryAt = target.indexOf('?');
  const path = queryAt === -1 ? target : target.slice(0, queryAt);
  const query = queryAt === -1 ? '' : target.slice(queryAt + 1);

  if (path === '/favicon.ico') {
    return { kind: 'favicon' };
  }
  if (path === MERMAID_FRAME_PATH) {
    return { kind: 'mermaid-frame' };
  }
  if (path.startsWith('/__assets/')) {
    const name = path.slice('/__assets/'.length);
    return (ASSET_NAMES as readonly string[]).includes(name)
      ? { kind: 'asset', name: name as AssetName }
      : NOT_FOUND;
  }
  const match = /^\/s\/([^/]+)(\/.*)?$/.exec(path);
  const token = match?.[1];
  const rest = match?.[2] ?? '';
  if (token === undefined || !TOKEN.test(token)) {
    return NOT_FOUND;
  }
  if (rest === '/') {
    return { kind: 'entry', token };
  }
  if (rest === '/__index') {
    return { kind: 'index', token };
  }
  if (rest === '/__missing') {
    const params = new URLSearchParams(query);
    const why = params.get('why');
    const reason = why === 'missing' || why === 'hidden' ? why : 'outside';
    return { kind: 'missing', token, ref: params.get('ref') ?? '', reason };
  }
  if (rest.startsWith('/f/') && rest.length > '/f/'.length) {
    return { kind: 'file', token, encodedPath: rest.slice('/f/'.length) };
  }
  return NOT_FOUND;
}

/** `/s/<token>/`: the entry page. */
export function entryUrl(token: string): string {
  return `/s/${token}/`;
}

/** `/s/<token>/__index`: the file index. */
export function indexUrl(token: string): string {
  return `/s/${token}/__index`;
}

/** `/s/<token>/f/<path>` with every segment percent-encoded. `path` is decoded, `/`-separated. */
export function fileUrl(token: string, path: string): string {
  return `/s/${token}/f/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** `/s/<token>/__missing?ref=…&why=…`: the page that explains a dead link. */
export function missingUrl(token: string, ref: string, reason: MissingReason): string {
  return `/s/${token}/__missing?${new URLSearchParams({ ref, why: reason }).toString()}`;
}
