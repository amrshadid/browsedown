import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { createPreview, PreviewError } from './adapters/command';
import { discoverDocs } from './adapters/discovery';
import { DocsView, type DocsItem, type DocsRoot } from './adapters/docsView';
import { HiddenPaths } from './adapters/hidden';
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
  // What the reader hid in Browsedown (ADR 0009): not listed and not served.
  const hidden = new HiddenPaths(context.workspaceState);
  const isHidden = (real: string): boolean => hidden.isHidden(real);
  const server = new PreviewServer({
    sessions,
    assetsDir: context.asAbsolutePath('dist/assets'),
    log,
    isHidden,
    // Reloading a folder's entry page rebuilds its tree, the way it was first found.
    rediscover: async (session) => {
      applyDiscovery(
        session,
        await discoverDocs(session.scopeRoot, {
          trusted: vscode.workspace.isTrusted,
          includeIgnored: session.includeIgnored === true,
          isHidden,
        }),
      );
    },
  });
  const previewDeps = { sessions, server, log, isHidden };
  const docs = new DocsView({ sessions, server, log, state: context.workspaceState, hidden });
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
    createPreview: (target) => createPreview(previewDeps, target),
    docsFiles: async () => (await firstRoot()).result.files,
    docsPreview: async (doc) => docs.previewUrl(await firstRoot(), doc),
    // A file in a workspace folder opens in that folder's "all docs" preview, with the
    // tree, like a click in the Docs view; anything else opens on its own.
    editorPreview: async (file) => {
      const found = file.scheme === 'file' ? await docs.locate(file.fsPath) : undefined;
      return found === undefined
        ? createPreview(previewDeps, file)
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

  /**
   * Opening something hidden is an explicit choice against an earlier one: ask.
   * Resolves true when it isn't hidden, or the reader chose to unhide it.
   */
  const allowHidden = async (target: vscode.Uri): Promise<boolean> => {
    const real = target.scheme === 'file' ? await realpath(target.fsPath).catch(() => '') : '';
    const covering = real === '' ? [] : hidden.covering(real);
    if (covering.length === 0) {
      return true;
    }
    const choice = await vscode.window.showInformationMessage(
      `"${path.basename(real)}" is hidden in Browsedown, so it isn't shown or served.`,
      'Unhide and Open',
    );
    if (choice !== 'Unhide and Open') {
      return false;
    }
    await hidden.unhide(covering);
    return true;
  };

  /** Real paths of the targets of a hide or unhide command, from the Explorer, the Docs view or the editor. */
  const targetsOf = async (
    item: DocsItem | vscode.Uri | undefined,
    selected: readonly vscode.Uri[] | undefined,
  ): Promise<string[]> => {
    let paths: string[] = [];
    if (selected !== undefined && selected.length > 0) {
      paths = selected.filter((uri) => uri.scheme === 'file').map((uri) => uri.fsPath);
    } else if (item instanceof vscode.Uri) {
      paths = item.scheme === 'file' ? [item.fsPath] : [];
    } else if (item?.kind === 'folder' || item?.kind === 'doc') {
      paths = [path.join(item.root.realRoot, ...item.node.path.split('/'))];
    } else if (item?.kind === 'hidden') {
      paths = [item.real];
    } else if (item === undefined) {
      const active = vscode.window.activeTextEditor?.document.uri;
      paths = active?.scheme === 'file' ? [active.fsPath] : [];
    }
    // A path that no longer exists (unhiding a deleted folder) is used as stored.
    return Promise.all(paths.map((p) => realpath(p).catch(() => p)));
  };

  /** Keeps open previews in step: hidden files leave their trees now, unhidden ones on reload. */
  const onHiddenChanged = (): void => {
    for (const session of sessions.all()) {
      if (session.mode !== 'folder' || session.files === undefined) {
        continue;
      }
      const files = session.files.filter(
        (file) => !hidden.isHidden(path.join(session.scopeRoot, ...file.split('/'))),
      );
      applyDiscovery(session, {
        files,
        discovery: session.discovery ?? 'walk',
        truncated: session.truncated,
      });
      session.fresh = false; // The next load of its entry page rediscovers: unhidden files return.
    }
    docs.refresh();
  };

  /** "Open all": the item's workspace folder, the only one, or one the reader picks. */
  const pickRoot = async (item?: DocsItem): Promise<DocsRoot | undefined> => {
    if (item?.kind === 'workspace' || item?.kind === 'folder' || item?.kind === 'doc') {
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
        if (await allowHidden(target)) {
          await openInBrowser(() => api.createPreview(target));
        }
      },
    ),
    docs,
    docsTree,
    hidden.onDidChange(onHiddenChanged),
    vscode.commands.registerCommand('browsedown.openEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target !== undefined && (await allowHidden(target))) {
        await openInBrowser(() => api.editorPreview(target));
      }
    }),
    vscode.commands.registerCommand(
      'browsedown.hide',
      async (item?: DocsItem | vscode.Uri, selected?: vscode.Uri[]) => {
        const targets = await targetsOf(item, selected);
        const roots = await Promise.all(
          (vscode.workspace.workspaceFolders ?? []).map((folder) =>
            realpath(folder.uri.fsPath).catch(() => folder.uri.fsPath),
          ),
        );
        const allowed = targets.filter((target) => !roots.includes(target));
        if (allowed.length < targets.length) {
          void vscode.window.showInformationMessage(
            "A workspace folder can't be hidden in Browsedown. Hide the folders inside it instead.",
          );
        }
        if (allowed.length > 0) {
          await hidden.hide(allowed);
          vscode.window.setStatusBarMessage(
            allowed.length === 1
              ? `Hidden in Browsedown: ${path.basename(allowed[0] ?? '')}`
              : `Hidden in Browsedown: ${String(allowed.length)} items`,
            4000,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      'browsedown.unhide',
      async (item?: DocsItem | vscode.Uri, selected?: vscode.Uri[]) => {
        let targets = item === undefined ? [] : await targetsOf(item, selected);
        if (targets.length === 0) {
          const picked = await vscode.window.showQuickPick(
            hidden.list().map((real) => ({ label: path.basename(real), description: real, real })),
            {
              canPickMany: true,
              placeHolder:
                hidden.list().length === 0
                  ? 'Nothing is hidden in Browsedown.'
                  : 'Which hidden folders or files should Browsedown show again?',
            },
          );
          targets = (picked ?? []).map((entry) => entry.real);
        }
        await hidden.unhide(targets);
      },
    ),
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
