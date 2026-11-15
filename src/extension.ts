import * as vscode from 'vscode';

import { createPreview, PreviewError } from './adapters/command';
import { discoverFolder } from './adapters/discovery';
import { errorCode, PreviewServer, tokensEqual } from './adapters/server';
import { applyDiscovery, SessionStore } from './core';

/** What `activate` returns; used by the integration tests, not a public contract. */
interface BrowsedownApi {
  /** Creates a preview session and returns its URL without opening a browser. */
  readonly createPreview: (target: vscode.Uri) => Promise<string>;
}

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
    // Reloading a folder's entry page rebuilds its tree.
    rediscover: async (session) => {
      applyDiscovery(
        session,
        await discoverFolder(session.scopeRoot, { trusted: vscode.workspace.isTrusted }),
      );
    },
  });
  const api: BrowsedownApi = {
    createPreview: (target) => createPreview({ sessions, server, log }, target),
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
        try {
          const url = await api.createPreview(target);
          await vscode.env.openExternal(vscode.Uri.parse(url, true));
        } catch (error) {
          const message =
            error instanceof PreviewError
              ? error.message
              : 'Browsedown could not open this preview. See the Browsedown output for details.';
          log(`A preview failed to open (${errorCode(error)}).`);
          void vscode.window.showErrorMessage(message);
        }
      },
    ),
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
