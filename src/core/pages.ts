/**
 * The HTML page: a GitHub-style header with breadcrumbs, the file tree (folder
 * mode), the document in a framed box, and an outline of its headings.
 *
 * The strict CSP shapes the markup: no inline styles or scripts (all styling is in
 * `page.css`, the only script is the nonced sidebar client), and everything taken
 * from the disk (names, paths, heading text) is escaped. Only `bodyHtml` goes in as
 * is, because it comes out of the sanitizer. Folders are native `<details>`, so
 * the tree works without JavaScript.
 */
import { escapeHtml } from './html';
import { ancestorFolders, type TreeNode } from './tree';

/** One heading for the outline. Matches `render()`'s `Heading`. */
export interface OutlineEntry {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly id: string;
  readonly text: string;
}

/** Everything a page needs. All strings are raw; the template escapes them. */
export interface PageOptions {
  /** Name of the opened folder (or the file's folder), shown first in the breadcrumbs. */
  readonly scopeName: string;
  /** Scope-relative path of the shown file, e.g. `docs/setup.md`. */
  readonly currentPath: string;
  /** Sanitized HTML from `render()`. Inserted without escaping. */
  readonly bodyHtml: string;
  readonly headings: readonly OutlineEntry[];
  /** The session's tree from {@link renderTreeList}; `undefined` in file mode (no sidebar). */
  readonly treeHtml: string | undefined;
  /** The URL of the shown file, as the tree links to it, so the tree can mark it. */
  readonly currentHref: string;
  /** URL of the entry page, linked from the first breadcrumb. */
  readonly homeHref: string;
  /** URL prefix of the bundled assets, e.g. `/__assets`. */
  readonly assetBase: string;
  /** Per-response CSP nonce for the sidebar script. */
  readonly nonce: string;
  /** Key under which the client remembers panel state, unique per session. */
  readonly stateKey: string;
  /** Optional label after the file name, e.g. `source` for YAML. */
  readonly label?: string;
  /** Shown instead of the file name, for generated pages (the index, a dead link). */
  readonly title?: string;
}

/** Characters a CSP nonce may contain (base64 and base64url). */
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Headings that are part of the page machinery, not the author's outline. */
const HIDDEN_HEADINGS = new Set(['footnote-label']);

/** Renders a full HTML document. Pure: the same options give the same string. */
export function renderPage(options: PageOptions): string {
  if (!NONCE.test(options.nonce)) {
    throw new Error('renderPage(): invalid nonce');
  }
  const fileName = options.title ?? options.currentPath.split('/').pop() ?? options.currentPath;
  const outline = options.headings.filter((h) => !HIDDEN_HEADINGS.has(h.id));
  const hasTree = options.treeHtml !== undefined && options.treeHtml !== '';
  const hasOutline = outline.length > 0;
  const asset = (name: string): string => escapeHtml(`${options.assetBase}/${name}`);
  const label =
    options.label === undefined
      ? ''
      : ` <span class="bd-label">${escapeHtml(options.label)}</span>`;

  return `<!doctype html>
<html lang="en" data-bd-state="${escapeHtml(options.stateKey)}"${hasTree ? ' data-bd-has-tree' : ''}${hasOutline ? ' data-bd-has-outline' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(fileName)} · ${escapeHtml(options.scopeName)}</title>
<link rel="stylesheet" href="${asset('github-markdown.css')}">
<link rel="stylesheet" href="${asset('highlight.css')}">
<link rel="stylesheet" href="${asset('page.css')}">
<script nonce="${options.nonce}" src="${asset('sidebar.js')}"></script>
</head>
<body>
<a class="bd-skip" href="#bd-content">Skip to content</a>
<header class="bd-header">
${hasTree ? toggleButton('tree', 'file tree', ICON.sidebar) : ''}
<nav class="bd-crumbs" aria-label="Breadcrumbs">${breadcrumbs(options, fileName)}</nav>
${THEME_BUTTON}
${hasOutline ? toggleButton('outline', 'outline', ICON.outline) : ''}
</header>
<div class="bd-layout">
${hasTree ? treePanel(options) : ''}
<main class="bd-main" id="bd-content">
<div class="bd-file">
<div class="bd-file-head">${ICON.file}<span class="bd-file-name">${escapeHtml(fileName)}</span>${label}</div>
<article class="markdown-body">
${options.bodyHtml}
</article>
</div>
</main>
${hasOutline ? outlinePanel(outline) : ''}
</div>
</body>
</html>
`;
}

function toggleButton(panel: 'tree' | 'outline', name: string, icon: string): string {
  return `<button type="button" class="bd-icon-button bd-toggle-${panel}" data-bd-toggle="${panel}" aria-controls="bd-${panel}" aria-expanded="true" aria-label="Toggle ${name}" title="Toggle ${name}">${icon}</button>`;
}

function breadcrumbs(options: PageOptions, fileName: string): string {
  const folders = options.title === undefined ? options.currentPath.split('/').slice(0, -1) : [];
  const parts = [
    `<a class="bd-crumb-root" href="${escapeHtml(options.homeHref)}">${escapeHtml(options.scopeName)}</a>`,
    ...folders.map((folder) => `<span>${escapeHtml(folder)}</span>`),
    `<span class="bd-crumb-current" aria-current="page">${escapeHtml(fileName)}</span>`,
  ];
  return parts.join('<span class="bd-crumb-sep" aria-hidden="true">/</span>');
}

function panelHead(panel: 'tree' | 'outline', title: string): string {
  return `<div class="bd-panel-head"><h2 class="bd-panel-title">${title}</h2><button type="button" class="bd-icon-button" data-bd-close="${panel}" aria-controls="bd-${panel}" aria-label="Close ${title.toLowerCase()}" title="Close">${ICON.close}</button></div>`;
}

function treePanel(options: PageOptions): string {
  const tree = markTree(options.treeHtml ?? '', options.currentHref, options.currentPath);
  return `<aside class="bd-panel bd-tree" id="bd-tree" data-bd-panel="tree" aria-label="Files">
${panelHead('tree', 'Files')}
<div class="bd-panel-body">${tree}</div>
</aside>`;
}

/**
 * The tree's markup, built once per discovery and reused for every page: a large
 * folder has thousands of rows. Icons are empty spans painted by CSS, to keep each
 * row small. `hrefFor` must return already-encoded URLs.
 */
export function renderTreeList(
  tree: readonly TreeNode[],
  hrefFor: (path: string) => string,
): string {
  const list = (nodes: readonly TreeNode[], depth: number): string => {
    const items = nodes.map((node) => {
      const name = `<span>${escapeHtml(node.name)}</span>`;
      if (node.kind === 'folder') {
        return `<li><details data-bd-folder="${escapeHtml(node.path)}"><summary class="bd-row" data-depth="${depth}"><span class="bd-i-chevron"></span><span class="bd-i-folder"></span>${name}</summary>${list(node.children, depth + 1)}</details></li>`;
      }
      return `<li><a class="bd-row" data-depth="${depth}" href="${escapeHtml(hrefFor(node.path))}"><span class="bd-i-file"></span>${name}</a></li>`;
    });
    return `<ul class="bd-tree-list">${items.join('')}</ul>`;
  };
  return tree.length === 0 ? '' : list(tree, 0);
}

/**
 * Marks the shown file and opens its folders in a tree from {@link renderTreeList}.
 * Every `href` and folder path in that markup is unique, so an exact attribute
 * match (closing quote included) finds exactly the right row.
 */
export function markTree(treeHtml: string, currentHref: string, currentPath: string): string {
  let html = treeHtml.replace(
    `href="${escapeHtml(currentHref)}"`,
    `href="${escapeHtml(currentHref)}" aria-current="page"`,
  );
  for (const folder of ancestorFolders(currentPath)) {
    const attribute = `data-bd-folder="${escapeHtml(folder)}"`;
    html = html.replace(attribute, `${attribute} open`);
  }
  return html;
}

function outlinePanel(outline: readonly OutlineEntry[]): string {
  const top = Math.min(...outline.map((h) => h.depth));
  const items = outline
    .map(
      (h) =>
        `<li><a class="bd-outline-link" data-depth="${h.depth - top}" href="#${escapeHtml(encodeURIComponent(h.id))}" data-bd-heading="${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`,
    )
    .join('');
  return `<aside class="bd-panel bd-outline" id="bd-outline" data-bd-panel="outline" aria-label="Outline">
${panelHead('outline', 'Outline')}
<nav class="bd-panel-body" aria-label="Headings on this page"><ul class="bd-outline-list">${items}</ul></nav>
</aside>`;
}

/** 16 px icons, drawn for this project. `currentColor`, hidden from screen readers. */
const svg = (body: string, cls: string): string =>
  `<svg class="bd-icon ${cls}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON = {
  file: svg(
    '<path d="M4 1.75h5.25L12.5 5v9.25H4z M9 1.75V5.25h3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>',
    'bd-icon-file',
  ),
  sidebar: svg(
    '<rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.25"/>',
    'bd-icon-sidebar',
  ),
  outline: svg(
    '<path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="3" cy="4" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="3" cy="12" r="1"/>',
    'bd-icon-outline',
  ),
  close: svg(
    '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    'bd-icon-close',
  ),
} as const;

/**
 * Cycles System → Light → Dark (GitHub's own themes). CSS shows the icon for the
 * current choice; the script updates the label. Hidden when JavaScript is off,
 * where the page simply follows the system.
 */
const THEME_BUTTON = `<button type="button" class="bd-icon-button bd-theme-button" data-bd-theme-toggle aria-label="Theme: system" title="Theme: system">${svg('<circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z"/>', 'bd-theme-icon bd-icon-theme-system')}${svg('<circle cx="8" cy="8" r="2.75" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M8 1v1.75M8 13.25V15M1 8h1.75M13.25 8H15M3.05 3.05l1.24 1.24M11.71 11.71l1.24 1.24M3.05 12.95l1.24-1.24M11.71 4.29l1.24-1.24" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>', 'bd-theme-icon bd-icon-theme-light')}${svg('<path d="M13.5 9.75A5.75 5.75 0 0 1 6.25 2.5a5.75 5.75 0 1 0 7.25 7.25z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>', 'bd-theme-icon bd-icon-theme-dark')}</button>`;

/** Body of the index page, shown when the opened folder has no README. `hrefFor` returns encoded URLs. */
export function renderIndexBody(
  tree: readonly TreeNode[],
  hrefFor: (path: string) => string,
  truncated: boolean,
): string {
  const list = (nodes: readonly TreeNode[]): string =>
    `<ul>${nodes
      .map((node) =>
        node.kind === 'folder'
          ? `<li><strong>${escapeHtml(node.name)}/</strong>${list(node.children)}</li>`
          : `<li><a href="${escapeHtml(hrefFor(node.path))}">${escapeHtml(node.name)}</a></li>`,
      )
      .join('')}</ul>`;
  const note = truncated
    ? '<div class="markdown-alert markdown-alert-warning"><p>This folder is very large, so the list stops after the first 20,000 entries.</p></div>'
    : '';
  const body = tree.length === 0 ? '<p>This folder has no Markdown files.</p>' : list(tree);
  return `<h1>Files</h1>\n${note}<p>There is no README in this folder. Pick a file:</p>\n${body}`;
}

/** Body of the page a dead link leads to: it says why, instead of a bare 404. */
export function renderMissingBody(
  ref: string,
  reason: 'outside' | 'missing',
  scopeName: string,
): string {
  const what =
    reason === 'outside'
      ? `It points outside <strong>${escapeHtml(scopeName)}</strong>, the folder you opened, so it isn't shown. Open a folder that contains both files to follow it.`
      : `It points to a file that doesn't exist in <strong>${escapeHtml(scopeName)}</strong>, or that isn't one Browsedown shows.`;
  return `<h1>This link isn't available</h1>\n<p><code>${escapeHtml(ref)}</code></p>\n<p>${what}</p>\n<p>Use your browser's Back button to return.</p>`;
}
