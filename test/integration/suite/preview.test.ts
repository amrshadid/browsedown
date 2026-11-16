/**
 * End to end in a real VS Code: run the command's logic through the extension's
 * API, then talk to the preview server over HTTP (no browser needed). Covers every
 * row of the README's ignore table, file mode, YAML, Mermaid and the explicit selection.
 */
import * as assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  createIgnoreTableRepo,
  EMPTY_GIT_CONFIG,
  ESCAPE_LINKS,
  IGNORE_TABLE,
  type IgnoreTableRepo,
} from '../../support/ignoreTableRepo';

/**
 * The shape of what `activate()` returns (src/extension.ts). Declared here instead of
 * imported: these tests compile to CommonJS, and importing the source would type-check
 * the ESM-only rendering packages under the wrong module system.
 */
interface BrowsedownApi {
  readonly createPreview: (target: vscode.Uri) => Promise<string>;
}

interface Page {
  readonly status: number;
  readonly location: string | undefined;
  readonly body: string;
}

function get(url: string): Promise<Page> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      })
      .on('error', reject);
  });
}

/** Follows the entry redirect and returns the file paths listed in the sidebar tree. */
async function treeOf(entry: string): Promise<{ files: string[]; page: Page }> {
  const first = await get(entry);
  const next =
    first.location === undefined ? first : await get(new URL(first.location, entry).href);
  const files = [
    ...next.body.matchAll(/<a class="bd-row" data-depth="\d+" href="\/s\/[^/]+\/f\/([^"]+)"/g),
  ]
    .map((match) => match[1]!.split('/').map(decodeURIComponent).join('/'))
    .map((file) => file.normalize('NFC'))
    .sort();
  return { files, page: next };
}

const under = (root: string, paths: readonly string[]): string[] =>
  paths.map((p) => p.slice(root.length + 1)).sort();

suite('previews over HTTP', () => {
  let api: BrowsedownApi;
  let repo: IgnoreTableRepo;
  const at = (rel: string): vscode.Uri => vscode.Uri.file(path.join(repo.root, rel));

  suiteSetup(async () => {
    // The extension runs in this process: keep personal git config out of discovery.
    process.env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    const extension = vscode.extensions.getExtension<BrowsedownApi>('browsedown.browsedown');
    assert.ok(extension);
    api = await extension.activate();
    repo = createIgnoreTableRepo();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('browsedown.stopAll');
    repo.cleanup();
  });

  test('row 1: docs/ lists tracked and non-ignored untracked Markdown, scoped to docs/', async () => {
    const { root, listed } = IGNORE_TABLE.normalFolder;
    const { files, page } = await treeOf(await api.createPreview(at(root)));
    assert.equal(page.status, 200);
    assert.deepEqual(files, under(root, listed));
  });

  test('row 2: an ignored file opens directly, with no tree', async () => {
    const entry = await api.createPreview(at(IGNORE_TABLE.ignoredFile.file));
    const { files, page } = await treeOf(entry);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes(IGNORE_TABLE.ignoredFile.file));
    assert.deepEqual(files, []);
    assert.ok(!page.body.includes('data-bd-panel="tree"'));
  });

  test('row 3: an explicitly opened ignored folder lists its Markdown with its own rules', async () => {
    for (const row of [
      IGNORE_TABLE.ignoredFolder,
      IGNORE_TABLE.ignoredUnderIgnoredAncestor,
      IGNORE_TABLE.contentRuleRoot,
    ]) {
      const { files } = await treeOf(await api.createPreview(at(row.root)));
      assert.deepEqual(files, under(row.root, row.listed), row.root);
    }
  });

  test('row 4: a link to an ignored Markdown or YAML file in scope renders it', async () => {
    const entry = await api.createPreview(at('docs'));
    const base = entry.replace(/\/$/, '');
    for (const target of ['ignored.md', 'ignored.yml']) {
      const page = await get(`${base}/f/${target}`);
      assert.equal(page.status, 200, target);
    }
    const yaml = await get(`${base}/f/ignored.yml`);
    assert.ok(yaml.body.includes('language-yaml'));
    assert.ok(yaml.body.includes('<span class="bd-label">source</span>'));
  });

  test('a folder without a README starts on the generated index', async () => {
    const entry = await api.createPreview(at('docs/deep'));
    const first = await get(entry);
    assert.equal(first.status, 302);
    const location = first.location ?? '';
    assert.ok(location.endsWith('/__index'));
    const index = await get(new URL(location, entry).href);
    assert.ok(index.body.includes('There is no README in this folder.'));
  });

  test('explicit selection: a symlinked file is scoped to where it really lives', async function () {
    if (!repo.symlinks) {
      this.skip();
    }
    const entry = await api.createPreview(at(ESCAPE_LINKS.file));
    const base = entry.replace(/\/$/, '');
    // The session's scope is the symlink target's folder, so docs/ files are outside it.
    const page = await get(`${base}/f/a.md`);
    assert.equal(page.status, 404);
  });

  test('a Mermaid diagram gets the renderer frame, built from the shipped assets', async () => {
    writeFileSync(
      path.join(repo.root, 'docs', 'diagram.md'),
      '# Diagram\n\n```mermaid\nflowchart LR\n  A --> B\n```\n',
    );
    const entry = await api.createPreview(at('docs/diagram.md'));
    const { page } = await treeOf(entry);
    assert.ok(page.body.includes('data-bd-diagrams="/__mermaid"'));
    assert.ok(page.body.includes('<figure class="bd-mermaid">'));

    const frame = await get(new URL('/__mermaid', entry).href);
    assert.equal(frame.status, 200);
    // The real Mermaid build and our renderer script, both inlined.
    assert.ok(frame.body.includes('globalThis["mermaid"]'));
    assert.ok(frame.body.includes('bd-diagram-'));
    assert.equal(frame.body.match(/<script\b[^>]*>/g)?.length, 2);
  });

  test('Stop All Previews closes the server', async () => {
    const entry = await api.createPreview(at('docs'));
    await vscode.commands.executeCommand('browsedown.stopAll');
    await assert.rejects(get(entry), /ECONNREFUSED/);
  });
});
