// The Mermaid renderer: runs inside the sandboxed frame at `/__mermaid` (ADR 0007),
// after Mermaid's own browser build, which defines the `mermaid` global.
//
// The frame is opaque-origin (sandbox without allow-same-origin) and its CSP allows
// no network, so whatever a diagram does, it stays in here. The page sends
// `{ type: 'render', id, source, theme }`; this script replies `{ id, ok, svg, … }`
// or `{ id, ok: false, error }`. The page shows the SVG only as an image.

type DiagramTheme = 'default' | 'dark';

interface MermaidApi {
  readonly initialize: (config: Record<string, unknown>) => void;
  readonly render: (id: string, source: string) => Promise<{ svg: string }>;
}

interface RenderRequest {
  readonly id: number;
  readonly source: string;
  readonly theme: DiagramTheme;
}

/** Mermaid's own limit on diagram text (`maxTextSize`). */
const MAX_SOURCE = 50_000;

/** GitHub's font stack, so diagrams match the page and are measured with the font they show in. */
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

/** Replies go to the page only: the frame's URL has the page's origin. */
const pageOrigin = new URL(window.location.href).origin;

function findMermaid(): MermaidApi | undefined {
  const value: unknown = Reflect.get(globalThis, 'mermaid');
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'initialize') === 'function' &&
    typeof Reflect.get(value, 'render') === 'function'
  ) {
    return value as MermaidApi;
  }
  return undefined;
}

function isRenderRequest(value: unknown): value is RenderRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type, id, source, theme } = value as Record<string, unknown>;
  return (
    type === 'render' &&
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    typeof source === 'string' &&
    (theme === 'default' || theme === 'dark')
  );
}

/**
 * Gives the SVG a fixed size from its viewBox (Mermaid emits `width="100%"` and an
 * inline max-width, which mean nothing in an `<img>`), and reads its accessible
 * title and description (`accTitle`, `accDescr`) for the image's alt text.
 */
function finish(svg: string): { svg: string; title: string; description: string } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg') {
    throw new Error('The renderer returned no SVG.');
  }
  const box = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const [, , width, height] = box;
  if (box.length === 4 && width !== undefined && height !== undefined && width > 0 && height > 0) {
    root.setAttribute('width', String(Math.ceil(width)));
    root.setAttribute('height', String(Math.ceil(height)));
    root.removeAttribute('style');
  }
  const text = (name: string): string =>
    [...root.children].find((child) => child.localName === name)?.textContent.trim() ?? '';
  return {
    svg: new XMLSerializer().serializeToString(root),
    title: text('title'),
    description: text('desc'),
  };
}

const mermaid = findMermaid();
let configured: DiagramTheme | undefined;
let counter = 0;
let queue = Promise.resolve();

/** Mermaid keeps global state, so diagrams are drawn one at a time. */
async function draw(request: RenderRequest): Promise<void> {
  if (mermaid === undefined) {
    throw new Error('The diagram library did not load.');
  }
  if (request.source.length > MAX_SOURCE) {
    throw new Error('This diagram is too large to draw.');
  }
  if (configured !== request.theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: request.theme,
      fontFamily: FONT,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    configured = request.theme;
  }
  counter += 1;
  const id = `bd-diagram-${counter}`;
  try {
    const { svg } = await mermaid.render(id, request.source);
    window.parent.postMessage({ id: request.id, ok: true, ...finish(svg) }, pageOrigin);
  } finally {
    // A failed render can leave its scratch element behind.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !isRenderRequest(event.data)) {
    return;
  }
  const request = event.data;
  queue = queue
    .then(() => draw(request))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      window.parent.postMessage(
        { id: request.id, ok: false, error: message.slice(0, 300) },
        pageOrigin,
      );
    });
});

window.parent.postMessage({ type: 'ready' }, pageOrigin);

export {};
