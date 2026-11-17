/**
 * The docs sidebar (ADR 0008) in a real VS Code, on the fixture workspace: what it
 * lists, and that "Open all" and a doc click give a working preview over HTTP.
 */
import * as assert from 'node:assert/strict';
import * as http from 'node:http';

import * as vscode from 'vscode';

/** The shape of what `activate()` returns (src/extension.ts); see preview.test.ts. */
interface BrowsedownApi {
  readonly docsFiles: () => Promise<readonly string[]>;
  readonly docsPreview: (doc?: string) => Promise<string>;
  readonly editorPreview: (file: vscode.Uri) => Promise<string>;
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

const tokenOf = (url: string): string => /\/s\/([^/]+)\//.exec(url)?.[1] ?? '';

suite('docs sidebar', () => {
  let api: BrowsedownApi;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<BrowsedownApi>('browsedown.browsedown');
    assert.ok(extension);
    api = await extension.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('browsedown.stopAll');
  });

  test('contributes the Activity Bar view and its commands', async () => {
    const manifest = vscode.extensions.getExtension('browsedown.browsedown')?.packageJSON as {
      contributes: { views: Record<string, { id: string }[]> };
    };
    assert.deepEqual(
      manifest.contributes.views.browsedown?.map((view) => view.id),
      ['browsedown.docs'],
    );
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'browsedown.openAll',
      'browsedown.openDoc',
      'browsedown.refreshDocs',
      'browsedown.showIgnored',
      'browsedown.hideIgnored',
    ]) {
      assert.ok(commands.includes(command), command);
    }
  });

  test('lists the workspace Markdown the way git sees it', async () => {
    assert.deepEqual([...(await api.docsFiles())].sort(), ['docs/README.md']);
  });

  test('Open all gives a folder preview whose tree is the list', async () => {
    const entry = await api.docsPreview();
    const first = await get(entry);
    // The fixture workspace has no README at its root: the generated index.
    assert.equal(first.status, 302);
    const index = await get(new URL(first.location ?? '', entry).href);
    assert.equal(index.status, 200);
    assert.ok(index.body.includes('/f/docs/README.md"'));
    assert.ok(index.body.includes('data-bd-panel="tree"'));
  });

  test('a doc opens inside the same preview, marked in the tree', async () => {
    const all = await api.docsPreview();
    const doc = await api.docsPreview('docs/README.md');
    assert.equal(tokenOf(doc), tokenOf(all), 'the sidebar reuses its preview session');
    const page = await get(doc);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Fixture docs'));
    assert.ok(/href="[^"]*\/f\/docs\/README\.md" aria-current="page"/.test(page.body));
  });

  test('the editor button opens the file in the all-docs preview, with the tree', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const file = vscode.Uri.joinPath(folder.uri, 'docs', 'README.md');
    const url = await api.editorPreview(file);
    assert.equal(tokenOf(url), tokenOf(await api.docsPreview()));
    const page = await get(url);
    assert.equal(page.status, 200);
    assert.ok(/href="[^"]*\/f\/docs\/README\.md" aria-current="page"/.test(page.body));
  });

  test('a hidden doc leaves the Docs list, and comes back when unhidden', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const readme = vscode.Uri.joinPath(folder.uri, 'docs', 'README.md');
    await vscode.commands.executeCommand('browsedown.hide', readme);
    try {
      await vscode.commands.executeCommand('browsedown.refreshDocs');
      assert.deepEqual([...(await api.docsFiles())], []);
    } finally {
      await vscode.commands.executeCommand('browsedown.unhide', readme);
    }
    await vscode.commands.executeCommand('browsedown.refreshDocs');
    assert.deepEqual([...(await api.docsFiles())], ['docs/README.md']);
  });

  test('a workspace folder itself cannot be hidden', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    await vscode.commands.executeCommand('browsedown.hide', folder.uri);
    await vscode.commands.executeCommand('browsedown.refreshDocs');
    assert.deepEqual([...(await api.docsFiles())], ['docs/README.md']);
  });

  test('Stop All Previews ends the sidebar preview; the next one is new', async () => {
    const before = await api.docsPreview();
    await vscode.commands.executeCommand('browsedown.stopAll');
    const after = await api.docsPreview();
    assert.notEqual(tokenOf(after), tokenOf(before));
    assert.equal((await get(after)).status, 302);
  });
});
