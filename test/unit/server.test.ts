/**
 * Server behaviour outside the security table: folder links, rescanning, the
 * start/stop lifecycle and what errors put in the log.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newToken, PreviewServer, tokensEqual } from '../../src/adapters/server';
import { applyDiscovery, entryUrl, fileUrl, SessionStore, type Session } from '../../src/core';

let base: string;
let assets: string;

beforeAll(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'browsedown-server-')));
  mkdirSync(join(base, 'guide'));
  writeFileSync(join(base, 'README.md'), '# Home\n\n[Guide](guide) [Guide again](guide/)\n');
  writeFileSync(join(base, 'guide', 'README.md'), '# Guide\n');
  writeFileSync(join(base, 'locked.md'), '# Locked\n');
  assets = join(base, '.assets');
  mkdirSync(assets);
  for (const name of ['github-markdown.css', 'highlight.css', 'page.css', 'sidebar.js']) {
    writeFileSync(join(assets, name), '');
  }
});

afterAll(() => {
  chmodSync(join(base, 'locked.md'), 0o644);
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function folderSession(): Session {
  const session: Session = {
    token: newToken(),
    mode: 'folder',
    scopeRoot: base,
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
    files: ['README.md', 'guide/README.md'],
    discovery: 'walk',
    truncated: false,
  });
  return session;
}

function get(port: number, target: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: target }, (res) => {
        res.resume();
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            ...(res.headers.location === undefined ? {} : { location: res.headers.location }),
          });
        });
      })
      .on('error', reject);
  });
}

describe('PreviewServer', () => {
  it('opens the README when a link names a folder, with or without a trailing slash', async () => {
    const session = folderSession();
    const sessions = new SessionStore(tokensEqual);
    sessions.add(session);
    const server = new PreviewServer({
      sessions,
      assetsDir: assets,
      rediscover: () => Promise.resolve(),
      log: () => undefined,
    });
    const port = await server.start();
    try {
      const folder = await get(port, `/s/${session.token}/f/guide`);
      expect(folder.status).toBe(302);
      expect(folder.location).toBe(fileUrl(session.token, 'guide/README.md'));
      expect((await get(port, `/s/${session.token}/f/nowhere`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('uses the fresh discovery on the first entry load, and rescans on a reload', async () => {
    const session = folderSession();
    const sessions = new SessionStore(tokensEqual);
    sessions.add(session);
    let scans = 0;
    const server = new PreviewServer({
      sessions,
      assetsDir: assets,
      rediscover: () => {
        scans += 1;
        return Promise.resolve();
      },
      log: () => undefined,
    });
    const port = await server.start();
    try {
      expect((await get(port, entryUrl(session.token))).status).toBe(302);
      expect(scans).toBe(0);
      await get(port, entryUrl(session.token));
      expect(scans).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('stops cleanly when closed while still starting, and can start again', async () => {
    const server = new PreviewServer({
      sessions: new SessionStore(tokensEqual),
      assetsDir: assets,
      rediscover: () => Promise.resolve(),
      log: () => undefined,
    });
    const starting = server.start();
    await server.close();
    const port = await starting;
    expect(server.boundAddress).toBeUndefined();
    await expect(get(port, '/')).rejects.toThrow(/ECONNREFUSED/);

    const again = await server.start();
    expect(server.boundAddress).toBe('127.0.0.1');
    expect((await get(again, '/nowhere')).status).toBe(404);
    await server.close();
  });

  it('logs only an error code when a request fails, never the path', async (ctx) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      ctx.skip(); // chmod can't make a file unreadable here.
    }
    chmodSync(join(base, 'locked.md'), 0o000);
    const session = folderSession();
    const sessions = new SessionStore(tokensEqual);
    sessions.add(session);
    const logs: string[] = [];
    const server = new PreviewServer({
      sessions,
      assetsDir: assets,
      rediscover: () => Promise.resolve(),
      log: (message) => logs.push(message),
    });
    const port = await server.start();
    try {
      expect((await get(port, fileUrl(session.token, 'locked.md'))).status).toBe(500);
      expect(logs).toContain('A request failed (EACCES).');
      expect(logs.join('\n')).not.toContain(base);
    } finally {
      await server.close();
    }
  });
});
