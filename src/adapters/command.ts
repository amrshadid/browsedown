/**
 * Turns a right-clicked folder or file into a preview session and returns its
 * URL. Opening the browser is the caller's job, so tests can create previews
 * without launching one.
 *
 * What a preview may serve:
 * - A folder: that folder.
 * - A Markdown or YAML file: its workspace folder, or its parent folder outside a
 *   workspace, so links to nearby files work. A symlinked file is scoped to the
 *   folder it really lives in.
 */
import { realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  applyDiscovery,
  entryUrl,
  isSupportedEnvironment,
  UNSUPPORTED_ENVIRONMENT_MESSAGE,
  type Session,
  type SessionStore,
} from '../core';
import { discoverFolder } from './discovery';
import { canonicalPath } from './gitIgnore';
import { isStrictlyInside } from './scopedFile';
import { newToken, type PreviewServer } from './server';

const PREVIEWABLE = /\.(md|markdown|ya?ml)$/i;

/** A message meant for the reader, shown as is. */
export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewError';
  }
}

export interface PreviewDeps {
  readonly sessions: SessionStore;
  readonly server: PreviewServer;
  readonly log: (message: string) => void;
  /** Real paths the reader hid in Browsedown: left out of the tree. */
  readonly isHidden?: (real: string) => boolean;
}

/** Creates a preview session for `target` and returns its absolute URL. */
export async function createPreview(deps: PreviewDeps, target: vscode.Uri): Promise<string> {
  const env = { remoteName: vscode.env.remoteName, isWeb: vscode.env.uiKind === vscode.UIKind.Web };
  if (!isSupportedEnvironment(env)) {
    throw new PreviewError(UNSUPPORTED_ENVIRONMENT_MESSAGE);
  }
  if (target.scheme !== 'file') {
    throw new PreviewError('Browsedown can only open files on this computer.');
  }
  const info = await stat(target.fsPath).catch(() => undefined);
  if (info === undefined) {
    throw new PreviewError('That folder or file no longer exists.');
  }

  const session = info.isDirectory()
    ? await folderSession(target.fsPath)
    : await fileSession(target);
  if (session.mode === 'folder') {
    applyDiscovery(
      session,
      await discoverFolder(session.scopeRoot, {
        trusted: vscode.workspace.isTrusted,
        ...(deps.isHidden === undefined ? {} : { isHidden: deps.isHidden }),
      }),
    );
    deps.log(
      `Opened a folder preview (${String(session.files?.length ?? 0)} Markdown files, ${session.discovery ?? 'walk'}).`,
    );
  } else {
    deps.log('Opened a file preview.');
  }
  deps.sessions.add(session);
  await deps.server.start();
  return deps.server.url(entryUrl(session.token));
}

/** A new folder session for `folder` (resolved to its real path), before discovery. */
export async function folderSession(folder: string): Promise<Session> {
  const root = await realpath(folder);
  return {
    token: newToken(),
    mode: 'folder',
    scopeRoot: root,
    scopeName: path.basename(root),
    entry: undefined,
    files: [],
    tree: [],
    treeHtml: undefined,
    discovery: undefined,
    truncated: false,
    fresh: false,
  };
}

async function fileSession(target: vscode.Uri): Promise<Session> {
  if (!PREVIEWABLE.test(target.fsPath)) {
    throw new PreviewError('Browsedown opens folders, Markdown files and YAML files.');
  }
  const file = await realpath(target.fsPath);
  const workspace = vscode.workspace.getWorkspaceFolder(target);
  let root = await realpath(workspace?.uri.fsPath ?? path.dirname(target.fsPath));
  if (!isStrictlyInside(root, file, process.platform)) {
    root = path.dirname(file); // A symlink out of the workspace: scope to the real file's folder.
  }
  const entry = canonicalPath(path.relative(root, file).split(path.sep).join('/'));
  return {
    token: newToken(),
    mode: 'file',
    scopeRoot: root,
    scopeName: path.basename(root),
    entry,
    files: undefined,
    tree: undefined,
    treeHtml: undefined,
    discovery: undefined,
    truncated: false,
    fresh: false,
  };
}
