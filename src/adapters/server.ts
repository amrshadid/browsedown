/**
 * The local preview server. Any web page the developer visits can try to reach a
 * localhost server, so every request passes these checks, in order:
 *
 * 1. Method: GET or HEAD only (405). There are no write endpoints at all.
 * 2. Host: exactly `127.0.0.1:<port>` or `localhost:<port>` (421). This stops DNS
 *    rebinding, where a hostile page's own name is re-pointed at 127.0.0.1.
 * 3. Origin: when present, it must be this server's origin (403).
 * 4. Route and token: unknown routes and unknown tokens get the same 404.
 * 5. Files: both halves of the scope guard, then a file-type allowlist.
 *
 * Every response carries the security headers; pages get a fresh CSP nonce and
 * raw images a `sandbox` CSP. Never CORS. Logs hold lifecycle events and error
 * codes only: no paths, tokens or file contents.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';

import {
  entryUrl,
  fileUrl,
  findRootReadme,
  indexUrl,
  missingUrl,
  parseRoute,
  renderIndexBody,
  renderMissingBody,
  renderPage,
  resolveLink,
  type AssetName,
  type PageOptions,
  type ScopedPath,
  type Session,
  type SessionStore,
} from '../core';
import { render } from '../render/markdown';
import { renderYaml } from '../render/yaml';
import { pathFlavor, resolveRequestPath, resolveScopedFile } from './scopedFile';

export interface ServerDeps {
  readonly sessions: SessionStore;
  /** Folder holding the built assets (`dist/assets`). */
  readonly assetsDir: string;
  /** Rebuilds a folder session's tree; called when its entry page is reloaded. */
  readonly rediscover: (session: Session) => Promise<void>;
  readonly log: (message: string) => void;
}

/** Image types served as raw bytes. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const ASSET_TYPES: Readonly<Record<AssetName, string>> = {
  'github-markdown.css': 'text/css; charset=utf-8',
  'highlight.css': 'text/css; charset=utf-8',
  'page.css': 'text/css; charset=utf-8',
  'sidebar.js': 'text/javascript; charset=utf-8',
};

/** A link to a folder opens its README, as on GitHub. */
const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown'];

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

/** For everything that isn't a page or an image: nothing may run or load. */
const CSP_NONE = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** For raw images: an SVG opened directly can't run script. */
const CSP_IMAGE = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** For pages: only our nonced script; styles, images and fonts from this origin. */
function pageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Constant-time token comparison. Different lengths never match. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A new session token: 32 random bytes, base64url (43 characters). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

interface Reply {
  readonly status: number;
  readonly type: string;
  readonly body: string | Buffer;
  readonly csp: string;
  readonly headers?: Readonly<Record<string, string>>;
}

const text = (status: number, message: string): Reply => ({
  status,
  type: 'text/plain; charset=utf-8',
  body: message,
  csp: CSP_NONE,
});

const NOT_FOUND = text(404, 'Not found');

const redirect = (location: string): Reply => ({
  ...text(302, 'Found'),
  headers: { Location: location },
});

/** An error's code (`ENOENT`, `EACCES`, …) or name, never its message: messages hold paths. */
export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? error.name;
  }
  return 'unknown';
}

export class PreviewServer {
  private server: http.Server | undefined;
  private starting: Promise<number> | undefined;
  private port = 0;

  constructor(private readonly deps: ServerDeps) {}

  /** Starts the server on 127.0.0.1 and an OS-chosen port, once. Returns the port. */
  start(): Promise<number> {
    this.starting ??= new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handle(req, res);
      });
      server.once('error', (error) => {
        if (this.server !== server) {
          this.starting = undefined; // It never listened: let the next preview retry.
        }
        reject(error);
      });
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        this.deps.log(`Preview server started on 127.0.0.1:${this.port}.`);
        resolve(this.port);
      });
    });
    return this.starting;
  }

  /** The absolute URL of a server path, e.g. `http://127.0.0.1:1234/s/<token>/`. */
  url(serverPath: string): string {
    return `http://127.0.0.1:${this.port}${serverPath}`;
  }

  /** The address the server listens on (`127.0.0.1`), or `undefined` when stopped. */
  get boundAddress(): string | undefined {
    const address = this.server?.address();
    return typeof address === 'object' && address !== null ? address.address : undefined;
  }

  /**
   * Stops the server and drops open connections. Safe to call when stopped, and
   * while a start is still pending: it waits for that start, then stops it.
   */
  async close(): Promise<void> {
    const starting = this.starting;
    this.starting = undefined;
    await starting?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
    this.deps.log('Preview server stopped.');
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let reply: Reply;
    try {
      reply = await this.route(req);
    } catch (error) {
      this.deps.log(`A request failed (${errorCode(error)}).`);
      reply = text(500, 'Internal error');
    }
    const body = typeof reply.body === 'string' ? Buffer.from(reply.body, 'utf8') : reply.body;
    res.writeHead(reply.status, {
      ...BASE_HEADERS,
      'Content-Security-Policy': reply.csp,
      'Content-Type': reply.type,
      'Content-Length': String(body.length),
      ...reply.headers,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  private async route(req: http.IncomingMessage): Promise<Reply> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return { ...text(405, 'Method not allowed'), headers: { Allow: 'GET, HEAD' } };
    }
    const allowedHosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    if (!allowedHosts.includes((req.headers.host ?? '').toLowerCase())) {
      return text(421, 'Misdirected request');
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts.map((h) => `http://${h}`).includes(origin)) {
      return text(403, 'Forbidden');
    }

    const route = parseRoute(req.url ?? '');
    switch (route.kind) {
      case 'not-found':
        return NOT_FOUND;
      case 'favicon':
        return { status: 204, type: 'text/plain', body: '', csp: CSP_NONE };
      case 'asset':
        return {
          status: 200,
          type: ASSET_TYPES[route.name],
          body: await readFile(path.join(this.deps.assetsDir, route.name)),
          csp: CSP_NONE,
        };
      default:
        break;
    }

    const session = this.deps.sessions.find(route.token);
    if (session === undefined) {
      return NOT_FOUND;
    }
    switch (route.kind) {
      case 'entry':
        return this.entry(session);
      case 'index':
        return this.page(session, {
          currentPath: '',
          title: 'Files',
          bodyHtml: renderIndexBody(
            session.tree ?? [],
            (p) => fileUrl(session.token, p),
            session.truncated,
          ),
          headings: [],
        });
      case 'missing':
        return this.missing(session, route.ref, route.reason);
      case 'file':
        return this.file(session, route.encodedPath);
    }
  }

  /** `/s/<token>/`: the README or the index. Reloading it rebuilds a folder's tree. */
  private async entry(session: Session): Promise<Reply> {
    if (session.mode === 'folder') {
      if (session.fresh) {
        session.fresh = false; // Discovery just ran when the preview was opened.
      } else {
        await this.deps.rediscover(session);
        session.fresh = false;
      }
    }
    const start = session.mode === 'folder' ? findRootReadme(session.files ?? []) : session.entry;
    return redirect(start === undefined ? indexUrl(session.token) : fileUrl(session.token, start));
  }

  private async file(session: Session, encodedPath: string): Promise<Reply> {
    const request = await resolveRequestPath(session.scopeRoot, encodedPath);
    if (request === undefined) {
      return NOT_FOUND;
    }
    const relPath = request.scoped.path;
    const extension = path.posix.extname(relPath).toLowerCase();
    const imageType = IMAGE_TYPES[extension];
    const isMarkdown = extension === '.md' || extension === '.markdown';
    const isYaml = extension === '.yml' || extension === '.yaml';

    if (!isMarkdown && !isYaml && imageType === undefined) {
      const readme = await this.folderReadme(session, request.scoped);
      return readme === undefined
        ? this.missing(session, relPath, 'missing')
        : redirect(fileUrl(session.token, readme));
    }
    if (request.real === undefined) {
      return this.missing(session, relPath, 'missing');
    }
    if (imageType !== undefined) {
      return { status: 200, type: imageType, body: await readFile(request.real), csp: CSP_IMAGE };
    }
    const source = await readFile(request.real, 'utf8');
    if (isYaml) {
      return this.page(session, {
        currentPath: relPath,
        bodyHtml: renderYaml(source),
        headings: [],
        label: 'source',
      });
    }
    const rendered = render(source, { rewriteUrl: (url) => this.linkUrl(session, relPath, url) });
    return this.page(session, {
      currentPath: relPath,
      bodyHtml: rendered.html,
      headings: rendered.headings,
    });
  }

  /** The README inside `folder`, if the path names a folder that has one in scope. */
  private async folderReadme(session: Session, folder: ScopedPath): Promise<string | undefined> {
    for (const name of README_NAMES) {
      const segments = [...folder.segments, name];
      const candidate = { segments, path: segments.join('/') };
      if ((await resolveScopedFile(session.scopeRoot, candidate)) !== undefined) {
        return candidate.path;
      }
    }
    return undefined;
  }

  /** Where a local link in `fromPath` should point: a file route, or the dead-link page. */
  private linkUrl(session: Session, fromPath: string, url: string): string {
    const target = resolveLink(fromPath, url, pathFlavor());
    switch (target.kind) {
      case 'local':
        return fileUrl(session.token, target.path) + target.fragment;
      case 'outside':
        return missingUrl(session.token, url, 'outside');
      default:
        return url; // The renderer passes only local URLs; anchors and externals stay as written.
    }
  }

  private missing(session: Session, ref: string, reason: 'outside' | 'missing'): Reply {
    const page = this.page(session, {
      currentPath: '',
      title: 'Link not available',
      bodyHtml: renderMissingBody(ref, reason, session.scopeName),
      headings: [],
    });
    return { ...page, status: 404 };
  }

  private page(
    session: Session,
    content: Pick<PageOptions, 'currentPath' | 'bodyHtml' | 'headings'> &
      Partial<Pick<PageOptions, 'title' | 'label'>>,
  ): Reply {
    const nonce = randomBytes(16).toString('base64');
    const html = renderPage({
      ...content,
      scopeName: session.scopeName,
      treeHtml: session.mode === 'folder' ? session.treeHtml : undefined,
      currentHref: fileUrl(session.token, content.currentPath),
      homeHref: entryUrl(session.token),
      assetBase: '/__assets',
      nonce,
      stateKey: `browsedown:${session.token.slice(0, 12)}`,
    });
    return { status: 200, type: 'text/html; charset=utf-8', body: html, csp: pageCsp(nonce) };
  }
}
