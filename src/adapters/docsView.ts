/**
 * The Docs view in Browsedown's Activity Bar container (ADR 0008): every Markdown
 * file of each workspace folder, found the way a folder preview finds them, with
 * an optional "Show ignored folders" mode.
 *
 * - Open all: a folder preview of the workspace folder whose tree is exactly this
 *   list. Clicking a doc opens it inside that same preview, with the tree.
 * - One preview session per workspace folder and mode, fed from this view's own
 *   scan and reused while it exists, so clicking around doesn't pile up sessions.
 * - Light footprint: it scans only when VS Code asks for its items (the view is
 *   visible), after Refresh, or after files change through VS Code. No watcher.
 *
 * https://code.visualstudio.com/api/extension-guides/tree-view
 */
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  applyDiscovery,
  buildTree,
  entryUrl,
  fileUrl,
  type DiscoveryResult,
  type Session,
  type SessionStore,
  type TreeFile,
  type TreeFolder,
  type TreeNode,
} from '../core';
import { canonicalPath } from './gitIgnore';
import { folderSession } from './command';
import { isStrictlyInside } from './scopedFile';
import { discoverDocs } from './discovery';
import type { HiddenPaths } from './hidden';
import type { PreviewServer } from './server';

/** One scanned workspace folder. */
export interface DocsRoot {
  readonly folder: vscode.WorkspaceFolder;
  /** Real path of the workspace folder: the scope of its previews. */
  readonly realRoot: string;
  readonly result: DiscoveryResult;
  readonly tree: readonly TreeNode[];
}

export type DocsItem =
  | { readonly kind: 'workspace'; readonly root: DocsRoot }
  | { readonly kind: 'folder'; readonly root: DocsRoot; readonly node: TreeFolder }
  | { readonly kind: 'doc'; readonly root: DocsRoot; readonly node: TreeFile }
  /** The "Hidden" section: what the reader hid in Browsedown (ADR 0009). */
  | { readonly kind: 'hiddenGroup' }
  | { readonly kind: 'hidden'; readonly real: string };

export interface DocsDeps {
  readonly sessions: SessionStore;
  readonly server: PreviewServer;
  readonly log: (message: string) => void;
  /** `workspaceState`: remembers the toggle per workspace, nothing in the repository. */
  readonly state: vscode.Memento;
  /** What the reader hid in Browsedown: left out of the list, shown in its own section. */
  readonly hidden: HiddenPaths;
}

const SHOW_IGNORED_KEY = 'browsedown.showIgnored';

export class DocsView implements vscode.TreeDataProvider<DocsItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<DocsItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private scan: Promise<readonly DocsRoot[]> | undefined;
  /** Sidebar sessions by real root and mode, by token: a stopped server drops them. */
  private readonly tokens = new Map<string, string>();
  private view: vscode.TreeView<DocsItem> | undefined;

  constructor(private readonly deps: DocsDeps) {}

  /** Whether the list includes the Markdown that git ignores. */
  get showIgnored(): boolean {
    return this.deps.state.get<boolean>(SHOW_IGNORED_KEY, false);
  }

  async setShowIgnored(show: boolean): Promise<void> {
    await this.deps.state.update(SHOW_IGNORED_KEY, show);
    await vscode.commands.executeCommand('setContext', SHOW_IGNORED_KEY, show);
    this.refresh();
  }

  /** Called once the view exists, to show notes such as a truncated walk. */
  attach(view: vscode.TreeView<DocsItem>): void {
    this.view = view;
    void vscode.commands.executeCommand('setContext', SHOW_IGNORED_KEY, this.showIgnored);
  }

  /** Forgets the last scan. VS Code asks again only if the view is visible. */
  refresh(): void {
    this.scan = undefined;
    this.changed.fire(undefined);
  }

  /** The scanned workspace folders, scanning first if needed. */
  roots(): Promise<readonly DocsRoot[]> {
    this.scan ??= this.scanAll();
    return this.scan;
  }

  async getChildren(item?: DocsItem): Promise<DocsItem[]> {
    if (item === undefined) {
      const roots = await this.roots();
      const only = roots.length === 1 ? roots[0] : undefined;
      const top: DocsItem[] =
        only === undefined
          ? roots.map((root) => ({ kind: 'workspace', root }))
          : itemsFor(only, only.tree);
      return this.deps.hidden.list().length > 0 ? [...top, { kind: 'hiddenGroup' }] : top;
    }
    switch (item.kind) {
      case 'hiddenGroup':
        return this.deps.hidden.list().map((real) => ({ kind: 'hidden', real }));
      case 'hidden':
        return [];
      case 'workspace':
        return itemsFor(item.root, item.root.tree);
      case 'folder':
        return itemsFor(item.root, item.node.children);
      case 'doc':
        return [];
    }
  }

  getTreeItem(item: DocsItem): vscode.TreeItem {
    switch (item.kind) {
      case 'hiddenGroup': {
        const tree = new vscode.TreeItem('Hidden', vscode.TreeItemCollapsibleState.Collapsed);
        tree.iconPath = new vscode.ThemeIcon('eye-closed');
        tree.description = String(this.deps.hidden.list().length);
        tree.tooltip = 'Hidden in Browsedown: not listed and not served.';
        tree.contextValue = 'browsedown.hiddenGroup';
        return tree;
      }
      case 'hidden': {
        const tree = new vscode.TreeItem(
          vscode.Uri.file(item.real),
          vscode.TreeItemCollapsibleState.None,
        );
        tree.label = this.displayPath(item.real);
        tree.tooltip = `${item.real}\nHidden in Browsedown: not listed and not served.`;
        tree.contextValue = 'browsedown.hidden';
        return tree;
      }
      case 'workspace': {
        const tree = new vscode.TreeItem(
          item.root.folder.name,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        tree.iconPath = new vscode.ThemeIcon('root-folder');
        tree.description = docCount(item.root.result.files.length);
        tree.contextValue = 'browsedown.workspace';
        return tree;
      }
      case 'folder': {
        const tree = new vscode.TreeItem(
          vscode.Uri.file(path.join(item.root.realRoot, ...item.node.path.split('/'))),
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        tree.label = item.node.name;
        tree.contextValue = 'browsedown.folder';
        return tree;
      }
      case 'doc': {
        const uri = vscode.Uri.file(path.join(item.root.realRoot, ...item.node.path.split('/')));
        const tree = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.None);
        tree.label = item.node.name;
        tree.tooltip = item.node.path;
        tree.contextValue = 'browsedown.doc';
        tree.command = {
          command: 'browsedown.openDoc',
          title: 'Open in Browser',
          arguments: [item],
        };
        return tree;
      }
    }
  }

  /**
   * The workspace folder that holds `file` and the file's path inside it, or
   * `undefined` when the file is outside every workspace folder.
   */
  async locate(file: string): Promise<{ root: DocsRoot; doc: string } | undefined> {
    const real = await realpath(file);
    for (const root of await this.roots()) {
      if (isStrictlyInside(root.realRoot, real, process.platform)) {
        const doc = canonicalPath(path.relative(root.realRoot, real).split(path.sep).join('/'));
        return { root, doc };
      }
    }
    return undefined;
  }

  /** The URL of the "all docs" preview of `root`, starting at `doc` or at its entry page. */
  async previewUrl(root: DocsRoot, doc?: string): Promise<string> {
    const session = await this.sessionFor(root);
    await this.deps.server.start();
    return this.deps.server.url(
      doc === undefined ? entryUrl(session.token) : fileUrl(session.token, doc),
    );
  }

  dispose(): void {
    this.changed.dispose();
  }

  /** A hidden path, relative to its workspace folder when it is inside one. */
  private displayPath(real: string): string {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const relative = path.relative(folder.uri.fsPath, real);
      if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        const shown = relative.split(path.sep).join('/');
        return (vscode.workspace.workspaceFolders?.length ?? 0) > 1
          ? `${folder.name}/${shown}`
          : shown;
      }
    }
    return real;
  }

  private async scanAll(): Promise<readonly DocsRoot[]> {
    const includeIgnored = this.showIgnored;
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
      (folder) => folder.uri.scheme === 'file',
    );
    const roots: DocsRoot[] = [];
    for (const folder of folders) {
      try {
        const realRoot = await realpath(folder.uri.fsPath);
        const result = await discoverDocs(realRoot, {
          trusted: vscode.workspace.isTrusted,
          includeIgnored,
          isHidden: (real) => this.deps.hidden.isHidden(real),
        });
        const root = { folder, realRoot, result, tree: buildTree(result.files) };
        roots.push(root);
        // An open preview of this folder shows the new list on its next page.
        const session = this.existingSession(root, includeIgnored);
        if (session !== undefined) {
          applyDiscovery(session, result);
        }
      } catch {
        this.deps.log('A workspace folder could not be listed.');
      }
    }
    const total = roots.reduce((sum, root) => sum + root.result.files.length, 0);
    this.deps.log(`Listed ${String(total)} Markdown files in the Docs view.`);
    if (this.view !== undefined) {
      this.view.message = roots.some((root) => root.result.truncated)
        ? 'A folder is very large, so the list stops after the first 20,000 entries.'
        : ''; // Not `undefined`: exactOptionalPropertyTypes (VS Code clears on '').
    }
    return roots;
  }

  private key(root: DocsRoot, includeIgnored: boolean): string {
    return `${includeIgnored ? 'all' : 'tracked'}:${root.realRoot}`;
  }

  private existingSession(root: DocsRoot, includeIgnored: boolean): Session | undefined {
    const token = this.tokens.get(this.key(root, includeIgnored));
    return token === undefined ? undefined : this.deps.sessions.find(token);
  }

  private async sessionFor(root: DocsRoot): Promise<Session> {
    const includeIgnored = this.showIgnored;
    const existing = this.existingSession(root, includeIgnored);
    if (existing !== undefined) {
      return existing;
    }
    const session: Session = { ...(await folderSession(root.realRoot)), includeIgnored };
    applyDiscovery(session, root.result);
    this.deps.sessions.add(session);
    this.tokens.set(this.key(root, includeIgnored), session.token);
    this.deps.log('Opened a docs preview.');
    return session;
  }
}

function itemsFor(root: DocsRoot, nodes: readonly TreeNode[]): DocsItem[] {
  return nodes.map((node) =>
    node.kind === 'folder' ? { kind: 'folder', root, node } : { kind: 'doc', root, node },
  );
}

function docCount(count: number): string {
  return count === 1 ? '1 doc' : `${String(count)} docs`;
}
