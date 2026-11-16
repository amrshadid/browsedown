/**
 * Markdown → sanitized, GitHub-style HTML. The plugin order matters:
 *
 * 1. Parse Markdown with GitHub's extensions (tables, task lists, footnotes,
 *    autolinks) and `> [!NOTE]` alerts.
 * 2. Turn raw HTML in the document into real nodes (`rehype-raw`), so the
 *    sanitizer and the link rewriter can see every `<a>` and `<img>`.
 * 3. Sanitize before anything adds trusted markup: scripts, event handlers and
 *    `javascript:` URLs are removed from the document.
 * 4. Then add heading ids (github-slugger: duplicates get `-1`, `-2`, as on GitHub),
 *    mark Mermaid diagrams, and add highlighting classes, which the sanitizer would
 *    otherwise strip.
 * 5. Rewrite local URLs last, on the sanitized tree.
 *
 * https://github.com/rehypejs/rehype-sanitize#example-headings-dom-clobbering
 * https://github.com/remarkjs/remark-rehype#example-supporting-html-in-markdown-properly
 */
import type { Element, Root } from 'hast';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/** A heading with the id `rehype-slug` gave it. */
export interface Heading {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly id: string;
  readonly text: string;
}

/** Per-document inputs to {@link render}. */
export interface RenderContext {
  /**
   * Maps a local URL (not `#fragment`, not absolute) to the URL to emit. Where a
   * link may point is decided by the caller (`core/links.ts`), not the renderer.
   */
  readonly rewriteUrl: (url: string) => string;
}

/** The rendered document. */
export interface RenderResult {
  /** Sanitized HTML for the inside of `<article class="markdown-body">`. */
  readonly html: string;
  readonly headings: readonly Heading[];
  /**
   * True when the document has a Mermaid diagram. Only then does the page start
   * the sandboxed diagram renderer (ADR 0007).
   */
  readonly hasMermaid: boolean;
}

/**
 * GitHub's defaults plus what alerts need: the alert classes on `div` and `p`, and
 * the octicon `svg`/`path` the alert plugin emits.
 *
 * Ids stay unprefixed, so `#install` matches the heading id. `name` attributes
 * are prefixed: `<img name="querySelectorAll">` would otherwise replace
 * `document.querySelectorAll` for the page script (DOM clobbering). Ids can't do
 * that to `document` on their own.
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^markdown-alert(-[a-z]+)?$/]],
    p: [...(defaultSchema.attributes?.p ?? []), ['className', 'markdown-alert-title']],
    svg: ['viewBox', 'width', 'height', ['ariaHidden', 'true'], ['className', /^octicon/]],
    path: ['d'],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'svg', 'path'],
  clobber: ['name'],
};

/** An absolute URL with a scheme (`https:`, `mailto:`, …) or protocol-relative (`//host`). */
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

const STATE_KEY = 'browsedown';

/** Mutable per-call state, passed to the shared processor through `file.data`. */
interface RenderState {
  readonly ctx: RenderContext;
  readonly headings: Heading[];
  hasMermaid: boolean;
}

function isRenderState(value: unknown): value is RenderState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ctx' in value &&
    'headings' in value &&
    Array.isArray(value.headings)
  );
}

function stateOf(file: { data: Record<string, unknown> }): RenderState {
  const state = file.data[STATE_KEY];
  if (!isRenderState(state)) {
    throw new Error('render(): missing render state');
  }
  return state;
}

/**
 * Wraps each Mermaid code block, a fence or raw `<pre><code class="language-mermaid">`,
 * in `<figure class="bd-mermaid">`. The source stays as plain code: without
 * JavaScript, or if drawing fails, the reader still sees it. The page script hands
 * the source to the sandboxed renderer and shows the result as an image.
 * Runs after the sanitizer, so the figure is ours, not the document's.
 */
function rehypeMermaid() {
  return (tree: Root, file: { data: Record<string, unknown> }): void => {
    const state = stateOf(file);
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || parent === undefined || index === undefined) {
        return;
      }
      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      );
      const classes = code?.properties.className;
      if (!Array.isArray(classes) || !classes.includes('language-mermaid')) {
        return;
      }
      state.hasMermaid = true;
      parent.children[index] = {
        type: 'element',
        tagName: 'figure',
        properties: { className: ['bd-mermaid'] },
        children: [node],
      };
      return 'skip';
    });
  };
}

/** Rewrites local `href`/`src`, blocks remote images, and collects headings. */
function rehypeLinksAndHeadings() {
  return (tree: Root, file: { data: Record<string, unknown> }): void => {
    const state = stateOf(file);
    visit(tree, 'element', (node: Element) => {
      const depth = headingDepth(node.tagName);
      if (depth !== undefined && typeof node.properties.id === 'string') {
        state.headings.push({ depth, id: node.properties.id, text: textOf(node) });
      }
      for (const kind of ['href', 'src'] as const) {
        const value = node.properties[kind];
        if (typeof value !== 'string') {
          continue;
        }
        if (ABSOLUTE_URL.test(value)) {
          if (kind === 'href') {
            node.properties.rel = ['noopener', 'noreferrer'];
            node.properties.target = '_blank';
          } else if (node.tagName === 'img') {
            blockRemoteImage(node, value);
          }
          continue;
        }
        if (value.startsWith('#')) {
          continue;
        }
        node.properties[kind] = state.ctx.rewriteUrl(value);
      }
    });
  };
}

/**
 * Previews make no network requests, so a remote image (badges included) becomes
 * a labelled placeholder with its alt text. The CSP would block it anyway; this
 * makes the reason visible.
 */
function blockRemoteImage(node: Element, url: string): void {
  const alt = typeof node.properties.alt === 'string' ? node.properties.alt : '';
  node.tagName = 'span';
  node.properties = { className: ['bd-remote-image'], title: `Remote image not loaded: ${url}` };
  node.children = [{ type: 'text', value: alt === '' ? 'Remote image' : alt }];
}

function headingDepth(tagName: string): Heading['depth'] | undefined {
  switch (tagName) {
    case 'h1':
      return 1;
    case 'h2':
      return 2;
    case 'h3':
      return 3;
    case 'h4':
      return 4;
    case 'h5':
      return 5;
    case 'h6':
      return 6;
    default:
      return undefined;
  }
}

function textOf(node: Element): string {
  let text = '';
  visit(node, 'text', (child) => {
    text += child.value;
  });
  return text;
}

/** Built once: attaching the plugins (lowlight registers its languages) is the slow part. */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkAlert)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  .use(rehypeSlug)
  .use(rehypeMermaid)
  // Mermaid source is shown as is: highlighting would only add noise to it.
  .use(rehypeHighlight, { detect: false, plainText: ['mermaid'] })
  .use(rehypeLinksAndHeadings)
  .use(rehypeStringify)
  .freeze();

/**
 * Renders Markdown to sanitized HTML. Pure: the same source and context give
 * the same result, and nothing is read from disk or the network.
 */
export function render(source: string, ctx: RenderContext): RenderResult {
  const state: RenderState = { ctx, headings: [], hasMermaid: false };
  const file = processor.processSync({ value: source, data: { [STATE_KEY]: state } });
  return { html: String(file), headings: state.headings, hasMermaid: state.hasMermaid };
}
