import * as path from 'node:path';

import * as vscode from 'vscode';

import { createPreview, PreviewError } from './adapters/command';
import { discoverDocs } from './adapters/discovery';
import { DocsView, type DocsItem, type DocsRoot } from './adapters/docsView';
import { errorCode, PreviewServer, tokensEqual } from './adapters/server';
import { applyDiscovery, SessionStore } from './core';

/** What `activate` returns; used by the integration tests, not a public contract. */
interface BrowsedownApi {
  /** Creates a preview session and returns its URL without opening a browser. */
  readonly createPreview: (target: vscode.Uri) => Promise<string>;
  /** The Docs view's list for the first workspace folder, scope-relative. */
  readonly docsFiles: () => Promise<readonly string[]>;
  /** The URL of the Docs view's "all docs" preview of the first workspace folder. */
  readonly docsPreview: (doc?: string) => Promise<string>;
  /** The URL the editor's Open in Browser button opens for `file`. */
  readonly editorPreview: (file: vscode.Uri) => Promise<string>;
}

/** Files created, deleted or renamed through VS Code that can change the Docs list. */
const DOCS_RELEVANT = /(\.(md|markdown)$)|(^[^.]*$)/i;

/**
 * Composition root: wires the server, sessions and discovery, and registers the
 * commands. Everything disposable goes into `context.subscriptions`, so VS Code
 * releases it, closing the server, when the extension deactivates.
 */
export function activate(context: vscode.ExtensionContext): BrowsedownApi {
  const output = vscode.window.createOutputChannel('Browsedown', { log: true });
  const log = (message: string): void => {
    output.info(message);
  };
  const sessions = new SessionStore(tokensEqual);
  const server = new PreviewServer({
    sessions,
    assetsDir: context.asAbsolutePath('dist/assets'),
    log,
    // Reloading a folder's entry page rebuilds its tree, the way it was first found.
    rediscover: async (session) => {
      applyDiscovery(
        session,
        await discoverDocs(session.scopeRoot, {
          trusted: vscode.workspace.isTrusted,
          includeIgnored: session.includeIgnored === true,
        }),
      );
    },
  });
  const docs = new DocsView({ sessions, server, log, state: context.workspaceState });
  const docsTree = vscode.window.createTreeView('browsedown.docs', {
    treeDataProvider: docs,
    showCollapseAll: true,
  });
  docs.attach(docsTree);

  const firstRoot = async (): Promise<DocsRoot> => {
    const root = (await docs.roots())[0];
    if (root === undefined) {
      throw new PreviewError('Open a folder to list its Markdown docs.');
    }
    return root;
  };
  const api: BrowsedownApi = {
    createPreview: (target) => createPreview({ sessions, server, log }, target),
    docsFiles: async () => (await firstRoot()).result.files,
    docsPreview: async (doc) => docs.previewUrl(await firstRoot(), doc),
    // A file in a workspace folder opens in that folder's "all docs" preview, with the
    // tree, like a click in the Docs view; anything else opens on its own.
    editorPreview: async (file) => {
      const found = file.scheme === 'file' ? await docs.locate(file.fsPath) : undefined;
      return found === undefined
        ? createPreview({ sessions, server, log }, file)
        : docs.previewUrl(found.root, found.doc);
    },
  };

  /** Opens a preview URL in the browser, reporting failures the same way everywhere. */
  const openInBrowser = async (url: () => Promise<string>): Promise<void> => {
    try {
      await vscode.env.openExternal(vscode.Uri.parse(await url(), true));
    } catch (error) {
      const message =
        error instanceof PreviewError
          ? error.message
          : 'Browsedown could not open this preview. See the Browsedown output for details.';
      log(`A preview failed to open (${errorCode(error)}).`);
      void vscode.window.showErrorMessage(message);
    }
  };

  /** "Open all": the item's workspace folder, the only one, or one the reader picks. */
  const pickRoot = async (item?: DocsItem): Promise<DocsRoot | undefined> => {
    if (item !== undefined) {
      return item.root;
    }
    const roots = await docs.roots();
    if (roots.length <= 1) {
      return firstRoot();
    }
    const picked = await vscode.window.showQuickPick(
      roots.map((root) => ({ label: root.folder.name, root })),
      { placeHolder: 'Which workspace folder should open in the browser?' },
    );
    return picked?.root;
  };

  context.subscriptions.push(
    output,
    { dispose: () => void server.close() },
    vscode.commands.registerCommand(
      'browsedown.openInBrowser',
      async (uri?: vscode.Uri, selected?: vscode.Uri[]) => {
        // Multi-select passes every item; the first one wins.
        const target = selected?.[0] ?? uri ?? vscode.window.activeTextEditor?.document.uri;
        if (target === undefined) {
          void vscode.window.showInformationMessage(
            'Right-click a folder or a Markdown file in the Explorer to open it in your browser.',
          );
          return;
        }
        await openInBrowser(() => api.createPreview(target));
      },
    ),
    docs,
    docsTree,
    vscode.commands.registerCommand('browsedown.openEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target !== undefined) {
        await openInBrowser(() => api.editorPreview(target));
      }
    }),
    vscode.commands.registerCommand('browsedown.refreshDocs', () => {
      docs.refresh();
    }),
    vscode.commands.registerCommand('browsedown.showIgnored', () => docs.setShowIgnored(true)),
    vscode.commands.registerCommand('browsedown.hideIgnored', () => docs.setShowIgnored(false)),
    vscode.commands.registerCommand('browsedown.openAll', async (item?: DocsItem) => {
      const root = await pickRoot(item).catch(() => undefined);
      if (root !== undefined) {
        await openInBrowser(() => docs.previewUrl(root));
      } else if ((await docs.roots()).length === 0) {
        void vscode.window.showInformationMessage('Open a folder to list its Markdown docs.');
      }
    }),
    vscode.commands.registerCommand('browsedown.openDoc', async (item?: DocsItem) => {
      if (item?.kind === 'doc') {
        await openInBrowser(() => docs.previewUrl(item.root, item.node.path));
      }
    }),
    vscode.commands.registerCommand('browsedown.openFolder', async (item?: DocsItem) => {
      if (item?.kind === 'folder') {
        const folder = vscode.Uri.file(path.join(item.root.realRoot, ...item.node.path.split('/')));
        await openInBrowser(() => api.createPreview(folder));
      }
    }),
    vscode.commands.registerCommand('browsedown.openInEditor', async (item?: DocsItem) => {
      if (item?.kind === 'doc') {
        const file = vscode.Uri.file(path.join(item.root.realRoot, ...item.node.path.split('/')));
        await vscode.commands.executeCommand('vscode.open', file);
      }
    }),
    // The list changes with the workspace. No file watcher: only what VS Code reports.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      docs.refresh();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      docs.refresh();
    }),
    ...[vscode.workspace.onDidCreateFiles, vscode.workspace.onDidDeleteFiles].map((event) =>
      event(({ files }) => {
        if (files.some((file) => DOCS_RELEVANT.test(path.basename(file.fsPath)))) {
          docs.refresh();
        }
      }),
    ),
    vscode.workspace.onDidRenameFiles(({ files }) => {
      const names = files.flatMap(({ oldUri, newUri }) => [oldUri, newUri]);
      if (names.some((file) => DOCS_RELEVANT.test(path.basename(file.fsPath)))) {
        docs.refresh();
      }
    }),
    vscode.commands.registerCommand('browsedown.stopAll', async () => {
      const count = sessions.size;
      sessions.clear();
      await server.close();
      // Notifications resolve only when dismissed: never await them in a command.
      void vscode.window.showInformationMessage(
        count === 0 ? 'No previews were open.' : 'All Browsedown previews are stopped.',
      );
    }),
  );
  return api;
}
