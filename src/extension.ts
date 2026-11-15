import * as vscode from 'vscode';

import { isSupportedEnvironment, UNSUPPORTED_ENVIRONMENT_MESSAGE } from './core';

/**
 * Composition root (ADR 0001): wires adapters to the core and registers the
 * commands. Every disposable goes into `context.subscriptions`, so VS Code
 * releases it on deactivate.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('browsedown.openInBrowser', () => {
      const env = {
        remoteName: vscode.env.remoteName,
        isWeb: vscode.env.uiKind === vscode.UIKind.Web,
      };
      if (!isSupportedEnvironment(env)) {
        void vscode.window.showInformationMessage(UNSUPPORTED_ENVIRONMENT_MESSAGE);
      }
      // The preview server and sessions are wired in once they exist.
    }),
    vscode.commands.registerCommand('browsedown.stopAll', () => {
      // Nothing runs yet.
    }),
  );
}

/** Nothing to do: everything is disposed through `context.subscriptions`. */
export function deactivate(): void {
  // Intentionally empty.
}
