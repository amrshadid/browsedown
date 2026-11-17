/**
 * The security checklist as one table: a row for every control, run end to end
 * against the real preview server over HTTP, serving a real repository with real
 * symlinks. Run it again before every release.
 *
 * Detailed tables live next to each component (scope.test.ts, scopedFile.test.ts,
 * links.test.ts, markdown.test.ts, pages.test.ts).
 */
import * as http from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverFolder } from '../../src/adapters/discovery';
import { isStrictlyInside, pathFlavor, resolveRequestPath } from '../../src/adapters/scopedFile';
import { newToken, PreviewServer, tokensEqual } from '../../src/adapters/server';
import {
  applyDiscovery,
  checkScopedPath,
  entryUrl,
  fileUrl,
  SessionStore,
  type Session,
} from '../../src/core';
import {
  createIgnoreTableRepo,
  ESCAPE_LINKS,
  type IgnoreTableRepo,
} from '../support/ignoreTableRepo';

interface Response {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

let repo: IgnoreTableRepo;
let docs: string;
let assets: string;
let server: PreviewServer;
let port: number;
let session: Session;
const logs: string[] = [];
/** What the reader hid in Browsedown (ADR 0009): a folder and a single file, as real paths. */
let hiddenPaths: string[] = [];
let aliasCreated = false;
const isHidden = (real: string): boolean =>
  hiddenPaths.some((h) => h === real || isStrictlyInside(h, real, process.platform));

/** Sends a raw request: the target is sent exactly as given, and Host can be spoofed. */
function request(
  target: string,
  options: { method?: string; host?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: target,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? `127.0.0.1:${port}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const file = (path: string): string => `/s/${session.token}/f/${path}`;

beforeAll(async () => {
  repo = createIgnoreTableRepo();
  docs = join(repo.root, 'docs');
  writeFileSync(
    join(docs, 'evil.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  writeFileSync(
    join(docs, 'hostile.md'),
    [
      '# Hostile',
      '<script>alert(1)</script><img src=x onerror=alert(1)>',
      '[up](../../../etc/passwd) [agent](../.agent/notes.md) [in](a.md#a) [web](https://example.com)',
      '![badge](https://img.shields.io/x.svg)',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(docs, 'diagram.md'),
    [
      '# Diagram',
      '```mermaid',
      'flowchart TD',
      '  X["<img src=x onerror=alert(1)>"] --> Y["<script>alert(2)</script>"]',
      '  click X href "javascript:alert(3)"',
      '```',
      '',
    ].join('\n'),
  );
  mkdirSync(join(docs, 'private'), { recursive: true });
  writeFileSync(join(docs, 'private', 'plan.md'), '# Private plan\n\nDo not serve.\n');
  writeFileSync(join(docs, 'private', 'pic.png'), 'not really a png\n');
  writeFileSync(join(docs, 'note.md'), '# Hidden note\n');
  writeFileSync(join(docs, 'links-hidden.md'), '[plan](private/plan.md) [note](note.md)\n');
  try {
    // Elsewhere in the folder, leading into the hidden one.
    symlinkSync(join(docs, 'private', 'plan.md'), join(docs, 'alias.md'));
    aliasCreated = true;
  } catch {
    aliasCreated = false; // Windows without symlink rights.
  }
  hiddenPaths = [realpathSync(join(docs, 'private')), realpathSync(join(docs, 'note.md'))];
  assets = mkdtempSync(join(tmpdir(), 'browsedown-assets-'));
  for (const name of [
    'github-markdown.css',
    'highlight.css',
    'page.css',
    'sidebar.js',
    'mermaid.js',
    'mermaid-frame.js',
  ]) {
    writeFileSync(join(assets, name), `/* ${name} */`);
  }
  const sessions = new SessionStore(tokensEqual);
  session = {
    token: newToken(),
    mode: 'folder',
    scopeRoot: docs,
    scopeName: 'docs',
    entry: undefined,
    files: [],
    tree: [],
    treeHtml: undefined,
    discovery: undefined,
    truncated: false,
    fresh: false,
  };
  applyDiscovery(session, {
    files: ['README.md', 'a.md', 'hostile.md', 'diagram.md'],
    discovery: 'git',
    truncated: false,
  });
  sessions.add(session);
  server = new PreviewServer({
    sessions,
    assetsDir: assets,
    rediscover: () => Promise.resolve(),
    log: (message) => logs.push(message),
    isHidden,
  });
  port = await server.start();
});

afterAll(async () => {
  await server.close();
  repo.cleanup();
  rmSync(assets, { recursive: true, force: true });
});

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

/** Every one of these must be refused, and must not leak the outside file's text. */
async function expectRefused(...targets: string[]): Promise<void> {
  for (const target of targets) {
    const res = await request(file(target));
    expect(res.status, target).toBe(404);
    expect(res.body, target).not.toContain('# .agent/notes.md');
    expect(res.body, target).not.toContain('# Outside the repo');
  }
}

/**
 * Refused by the spelling half on its own, and by the whole guard. The disk half
 * would also catch most of these, which would hide a regression in the spelling
 * half from an end-to-end check alone, so each half is checked.
 */
async function expectBlockedLexically(...encodedPaths: string[]): Promise<void> {
  for (const encoded of encodedPaths) {
    expect(checkScopedPath(encoded, pathFlavor()).ok, encoded).toBe(false);
    expect(await resolveRequestPath(docs, encoded), encoded).toBeUndefined();
  }
  await expectRefused(...encodedPaths);
}

/**
 * Dangerous on Windows only (drive letters, backslashes, NTFS streams). There the
 * spelling half refuses them; on POSIX they are ordinary names, so they must
 * simply lead nowhere. Either way the request is refused and leaks nothing.
 */
async function expectBlockedForThisPlatform(...encodedPaths: string[]): Promise<void> {
  if (pathFlavor() === 'windows') {
    await expectBlockedLexically(...encodedPaths);
    return;
  }
  for (const encoded of encodedPaths) {
    expect((await resolveRequestPath(docs, encoded))?.real, encoded).toBeUndefined();
  }
  await expectRefused(...encodedPaths);
}

interface Row {
  /** The area of the control: network, requests, token, headers, files, paths, scripts, diagrams, hidden, logs. */
  readonly area: string;
  readonly control: string;
  readonly run?: () => Promise<void>;
  /** Rows checked elsewhere say where, and are listed as todo here. */
  readonly checkedIn?: string;
}

const rows: Row[] = [
  {
    area: 'network',
    control: 'binds 127.0.0.1 on an OS-chosen port',
    run: async () => {
      expect(server.boundAddress).toBe('127.0.0.1');
      expect(port).toBeGreaterThan(0);
      expect(server.url('/x')).toBe(`http://127.0.0.1:${port}/x`);
      await Promise.resolve();
    },
  },
  {
    area: 'network',
    control: 'closes on request, and refuses connections afterwards',
    run: async () => {
      const other = new PreviewServer({
        sessions: new SessionStore(tokensEqual),
        assetsDir: assets,
        rediscover: () => Promise.resolve(),
        log: () => undefined,
      });
      const otherPort = await other.start();
      await other.close();
      expect(other.boundAddress).toBeUndefined();
      await expect(
        new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port: otherPort, path: '/' }, resolve).on('error', reject);
        }),
      ).rejects.toThrow(/ECONNREFUSED/);
    },
  },
  {
    area: 'requests',
    control: 'answers 421 to a spoofed Host (DNS rebinding)',
    run: async () => {
      for (const host of [
        'evil.example',
        `evil.example:${port}`,
        '127.0.0.1',
        `127.0.0.1:${port}.evil.example`,
        `0.0.0.0:${port}`,
        `[::1]:${port}`,
      ]) {
        expect((await request(entryUrl(session.token), { host })).status, host).toBe(421);
      }
      expect((await request(entryUrl(session.token), { host: `localhost:${port}` })).status).toBe(
        302,
      );
    },
  },
  {
    area: 'requests',
    control: 'answers 405 to POST and every other method',
    run: async () => {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const res = await request(file('a.md'), { method });
        expect(res.status, method).toBe(405);
        expect(res.headers.allow).toBe('GET, HEAD');
      }
      const head = await request(file('a.md'), { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.body).toBe('');
    },
  },
  {
    area: 'requests',
    control: 'rejects a cross-origin Origin header',
    run: async () => {
      const from = async (origin: string): Promise<number> =>
        (await request(file('a.md'), { headers: { origin } })).status;
      expect(await from('http://evil.example')).toBe(403);
      expect(await from('null')).toBe(403);
      expect(await from(`http://127.0.0.1:${port}`)).toBe(200);
    },
  },
  {
    area: 'token',
    control: 'answers 404 to an unknown or malformed token, the same as any unknown route',
    run: async () => {
      const unknown = await request(`/s/${newToken()}/f/a.md`);
      const malformed = await request('/s/abc/f/a.md');
      const nowhere = await request('/nowhere');
      for (const res of [unknown, malformed, nowhere]) {
        expect(res.status).toBe(404);
        expect(res.body).toBe(nowhere.body);
      }
      expect(tokensEqual(session.token, `${session.token.slice(0, -1)}x`)).toBe(false);
      expect(tokensEqual(session.token, session.token.slice(1))).toBe(false);
    },
  },
  {
    area: 'headers',
    control: 'sends a CSP with a fresh nonce per page, and the security headers on every response',
    run: async () => {
      const first = await request(file('a.md'));
      const second = await request(file('a.md'));
      const csp = (res: Response): string => String(res.headers['content-security-policy']);
      const nonce = (res: Response): string =>
        /script-src 'nonce-([^']+)'/.exec(csp(res))?.[1] ?? '';
      expect(nonce(first)).not.toBe('');
      expect(nonce(first)).not.toBe(nonce(second));
      expect(csp(first)).toContain("default-src 'none'");
      expect(csp(first)).toContain("img-src 'self' data:");
      expect(csp(first)).toContain("frame-ancestors 'none'");
      expect(first.headers['content-type']).toBe('text/html; charset=utf-8');
      for (const res of [
        first,
        await request('/__assets/page.css'),
        await request('/nowhere'),
        await request(file('a.md'), { method: 'POST' }),
        await request(file('a.md'), { host: 'evil.example' }),
      ]) {
        expect(res.headers).toMatchObject(SECURITY_HEADERS);
        expect(res.headers['content-security-policy']).toBeDefined();
      }
    },
  },
  {
    area: 'headers',
    control: 'never sends CORS headers',
    run: async () => {
      const responses = [
        await request(file('a.md'), { headers: { origin: `http://127.0.0.1:${port}` } }),
        await request(file('a.md'), {
          method: 'OPTIONS',
          headers: { origin: 'http://evil.example' },
        }),
        await request('/__assets/sidebar.js'),
        await request('/__mermaid'),
      ];
      for (const res of responses) {
        expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
      }
    },
  },
  {
    area: 'files',
    control: 'serves only Markdown, YAML and images; everything else is 404',
    run: async () => {
      expect((await request(file('a.md'))).status).toBe(200);
      expect((await request(file('ignored.yml'))).status).toBe(200);
      expect((await request(file('img/logo.png'))).headers['content-type']).toBe('image/png');
      for (const path of ['x.txt', 'c.log', '..%2F.gitignore', 'evil.svg.txt']) {
        expect((await request(file(path))).status, path).toBe(404);
      }
      expect((await request('/__assets/extension.js')).status).toBe(404);
    },
  },
  {
    area: 'files',
    control: 'serves raw images with a sandbox CSP, so a direct SVG cannot run script',
    run: async () => {
      const svg = await request(file('evil.svg'));
      expect(svg.status).toBe(200);
      expect(svg.headers['content-type']).toBe('image/svg+xml');
      expect(svg.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    },
  },
  {
    area: 'paths',
    control: 'blocks traversal: ../ plain and %2e%2e%2f encoded',
    run: () =>
      expectBlockedLexically(
        '%2e%2e/.agent/notes.md',
        '%2e%2e%2f.agent%2fnotes.md',
        '%2E%2E%2F%2E%2E%2F..%2Fetc%2Fpasswd',
        'a.md/%2e%2e/%2e%2e/.agent/notes.md',
      ),
  },
  {
    area: 'paths',
    control: 'decodes once: %252e%252e stays a literal name',
    run: () => expectRefused('%252e%252e/.agent/notes.md', '%252e%252e%252f.agent%252fnotes.md'),
  },
  {
    area: 'paths',
    control: 'blocks absolute and UNC paths everywhere, drive letters and backslashes',
    run: async () => {
      await expectBlockedLexically(
        `/${repo.outside}/secret.md`.replace(/\/\/+/g, '/'),
        '//server/share/a.md',
      );
      await expectBlockedForThisPlatform(
        encodeURIComponent(join(repo.outside, 'secret.md')),
        'C:%2FWindows%2Fwin.ini',
        'C:',
        '%5C%5Cserver%5Cshare%5Ca.md',
        '..%5C.agent%5Cnotes.md',
      );
    },
  },
  {
    area: 'paths',
    control: 'blocks NUL everywhere, and NTFS alternate data streams',
    run: async () => {
      await expectBlockedLexically('a.md%00.png');
      await expectBlockedForThisPlatform('a.md:secret', 'a.md::$DATA');
    },
  },
  {
    area: 'paths',
    control: 'blocks symlinks that escape the root (file and folder)',
    run: async () => {
      if (!repo.symlinks) {
        return; // No symlink rights (Windows): covered by the injected test in scopedFile.test.ts.
      }
      await expectRefused(
        ESCAPE_LINKS.file.replace('docs/', ''),
        `${ESCAPE_LINKS.dir.replace('docs/', '')}/secret.md`,
      );
    },
  },
  {
    area: 'paths',
    control: 'still serves in-scope files, including ignored ones a link may point to',
    run: async () => {
      const res = await request(file('ignored.md'));
      expect(res.status).toBe(200);
      expect(res.body).toContain('docs/ignored.md');
    },
  },
  {
    area: 'paths',
    control: 'applies the guard to every rewritten link',
    run: async () => {
      const { body } = await request(file('hostile.md'));
      const article = /<article[\s\S]*<\/article>/.exec(body)?.[0] ?? '';
      const hrefs = article.match(/href="[^"]*"/g) ?? [];
      expect(hrefs).toContain(`href="${fileUrl(session.token, 'a.md')}#a"`);
      expect(hrefs).toContain('href="https://example.com"');
      // Both climb out of docs/: they go to the explanation page, never to a file.
      for (const ref of ['../../../etc/passwd', '../.agent/notes.md']) {
        const query = new URLSearchParams({ ref, why: 'outside' }).toString();
        expect(hrefs).toContain(
          `href="/s/${session.token}/__missing?${query.replace(/&/g, '&#x26;')}"`,
        );
      }
    },
  },
  {
    area: 'paths',
    control: 'applies the guard to the explicit selection',
    checkedIn: 'test/integration/suite/preview.test.ts (needs VS Code)',
  },
  {
    area: 'scripts',
    control: 'documents never run script, and the only script is the nonced sidebar client',
    run: async () => {
      const res = await request(file('hostile.md'));
      const csp = String(res.headers['content-security-policy']);
      const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
      expect(res.body.match(/<script\b[^>]*>/gi)).toEqual([
        `<script nonce="${nonce}" src="/__assets/sidebar.js">`,
      ]);
      expect(res.body).not.toMatch(/onerror=|javascript:/i);
      // Remote images are not loaded (no network requests).
      expect(res.body).not.toContain('src="https://img.shields.io');
      expect(res.body).toContain('bd-remote-image');
    },
  },
  {
    area: 'diagrams',
    control: 'a page may frame the renderer only when it has a diagram',
    run: async () => {
      const csp = async (path: string): Promise<string> =>
        String((await request(file(path))).headers['content-security-policy']);
      expect(await csp('diagram.md')).toContain("frame-src 'self'");
      expect(await csp('diagram.md')).toContain("frame-ancestors 'none'");
      for (const path of ['a.md', 'hostile.md', 'ignored.yml']) {
        expect(await csp(path), path).not.toContain('frame-src');
      }
      expect((await request(file('diagram.md'))).body).toContain('data-bd-diagrams="/__mermaid"');
      expect((await request(file('a.md'))).body).not.toContain('data-bd-diagrams');
    },
  },
  {
    area: 'diagrams',
    control: 'the renderer frame: own CSP, no network, framable by this origin only, no token',
    run: async () => {
      const res = await request('/__mermaid');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      const nonce = /script-src 'nonce-([^']+)'/.exec(
        String(res.headers['content-security-policy']),
      )?.[1];
      expect(res.headers['content-security-policy']).toBe(
        `default-src 'none'; script-src 'nonce-${nonce ?? ''}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      );
      expect(res.headers).toMatchObject({ ...SECURITY_HEADERS, 'x-frame-options': 'SAMEORIGIN' });
      expect(res.body.match(/<script\b[^>]*>/gi)).toEqual([
        `<script nonce="${nonce ?? ''}">`,
        `<script nonce="${nonce ?? ''}">`,
      ]);
      expect(res.body).toContain('/* mermaid.js */');
      expect(res.body).toContain('/* mermaid-frame.js */');
      expect(res.body).not.toContain(session.token);
    },
  },
  {
    area: 'diagrams',
    control: 'the renderer frame passes the request checks, and its scripts are not served alone',
    run: async () => {
      expect(
        (await request('/__mermaid', { headers: { origin: 'http://evil.example' } })).status,
      ).toBe(403);
      expect((await request('/__mermaid', { headers: { origin: 'null' } })).status).toBe(403);
      expect((await request('/__mermaid', { host: `evil.example:${port}` })).status).toBe(421);
      expect((await request('/__mermaid', { method: 'POST' })).status).toBe(405);
      for (const target of [
        '/__assets/mermaid.js',
        '/__assets/mermaid-frame.js',
        `/s/${session.token}/__mermaid`,
      ]) {
        expect((await request(target)).status, target).toBe(404);
      }
    },
  },
  {
    area: 'diagrams',
    control: 'diagram text reaches the page only as escaped code',
    run: async () => {
      const { body } = await request(file('diagram.md'));
      expect(body).toContain('<figure class="bd-mermaid"><pre><code class="language-mermaid">');
      // The hostile labels are text inside the code block, never tags.
      expect(body).toContain('&#x3C;img src=x onerror=alert(1)>');
      expect(body).not.toMatch(/<img src=x|<script>alert/);
      expect(body.match(/<script\b[^>]*>/gi)?.length).toBe(1); // Only the page script.
    },
  },
  {
    area: 'diagrams',
    control: 'the frame is sandboxed, and the page shows its output only as images',
    checkedIn: 'src/client/diagrams.ts; manual browser check before every release',
  },
  {
    area: 'hidden',
    control: 'never serves a hidden file, or a file or image in a hidden folder',
    run: async () => {
      for (const path of ['note.md', 'private/plan.md', 'private/pic.png']) {
        const res = await request(file(path));
        expect(res.status, path).toBe(404);
        expect(res.body, path).toContain('you hid in Browsedown');
        expect(res.body, path).not.toContain('Do not serve');
        expect(res.headers['content-type'], path).toBe('text/html; charset=utf-8');
      }
      expect((await request(file('a.md'))).status).toBe(200); // Beside it: served.
    },
  },
  {
    area: 'hidden',
    control: 'judges the real path: a symlink into a hidden folder is refused',
    run: async () => {
      if (!aliasCreated) {
        return; // No symlink rights (Windows): the real-path rule is unit-tested in hidden.test.ts.
      }
      const res = await request(file('alias.md'));
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('Do not serve');
    },
  },
  {
    area: 'hidden',
    control: 'a link to a hidden file leads to the page that says why, never the file',
    run: async () => {
      const page = await request(file('links-hidden.md'));
      expect(page.status).toBe(200);
      const href = /href="([^"]*private\/plan\.md)"/.exec(page.body)?.[1] ?? '';
      expect(href).not.toBe('');
      const followed = await request(href.replace(/&#x26;/g, '&'));
      expect(followed.status).toBe(404);
      expect(followed.body).toContain('you hid in Browsedown');
    },
  },
  {
    area: 'hidden',
    control: 'hidden files leave the tree, symlinks into them included',
    run: async () => {
      const result = await discoverFolder(docs, { trusted: true, isHidden });
      expect(result.files).not.toContain('note.md');
      expect(result.files.filter((f) => f.startsWith('private/'))).toEqual([]);
      expect(result.files).not.toContain('alias.md');
      expect(result.files).toContain('a.md');
    },
  },
  {
    area: 'logs',
    control: 'never logs file contents, paths or tokens',
    run: async () => {
      await request(file('a.md'));
      await request(file('%2e%2e/.agent/notes.md'));
      const joined = logs.join('\n');
      expect(joined).not.toContain(session.token);
      expect(joined).not.toContain('a.md');
      expect(joined).not.toContain('notes.md');
      expect(logs.some((line) => line.startsWith('Preview server started'))).toBe(true);
    },
  },
];

describe('security controls', () => {
  for (const row of rows) {
    const name = `${row.area}: ${row.control}`;
    if (row.run === undefined) {
      it.todo(`${name} (checked in ${row.checkedIn ?? '?'})`);
    } else {
      it(name, row.run);
    }
  }
});
