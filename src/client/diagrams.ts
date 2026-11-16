// Mermaid diagrams on the page (ADR 0007).
//
// The renderer marks each diagram as `<figure class="bd-mermaid">` with its source
// as code, which is what the reader sees without JavaScript or when drawing fails.
// While a diagram is drawn, the code stays visible with a "Drawing diagram…" note;
// once drawn, Preview and Code buttons switch between the image and the source.
// One hidden `<iframe sandbox="allow-scripts">` draws them: it runs in an opaque
// origin with no network. Its answers are untrusted, so the page checks their
// shape and shows each SVG only as an `<img>` with a data: URL: an SVG image
// can't run script or load anything. The SVG never enters the page's DOM.

export type DiagramTheme = 'default' | 'dark';

/** Creates an element without going through the document object, which a page could shadow. */
export type CreateElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
) => HTMLElementTagNameMap[K];

export interface DiagramTools {
  /** The `<html>` element, captured before any content existed. */
  readonly root: HTMLElement;
  readonly createElement: CreateElement;
  /** The Mermaid theme that matches the page right now. */
  readonly theme: () => DiagramTheme;
}

export interface Diagrams {
  /** Draws every diagram again, e.g. after the theme changed. */
  readonly refresh: () => void;
}

type View = 'preview' | 'code';

interface Entry {
  readonly figure: Element;
  readonly pre: Element;
  readonly source: string;
  /** "Drawing diagram…", or why it couldn't be drawn. Removed once drawn. */
  readonly status: HTMLElement;
  image?: HTMLImageElement;
  failed?: boolean;
}

/** How long to wait for the renderer before telling the reader it isn't coming. */
const RENDER_TIMEOUT_MS = 15_000;

interface Drawn {
  readonly id: number;
  readonly svg: string;
  readonly title: string;
  readonly description: string;
}

interface Failed {
  readonly id: number;
  readonly error: string;
}

/** Generous for big diagrams; anything larger is not a diagram we asked for. */
const MAX_SVG = 10 * 1024 * 1024;
const MAX_TEXT = 1000;

function field(data: object, key: string): unknown {
  return Reflect.get(data, key);
}

function asDrawn(data: unknown): Drawn | undefined {
  if (typeof data !== 'object' || data === null || field(data, 'ok') !== true) {
    return undefined;
  }
  const id = field(data, 'id');
  const svg = field(data, 'svg');
  const title = field(data, 'title');
  const description = field(data, 'description');
  return typeof id === 'number' &&
    typeof svg === 'string' &&
    svg.length <= MAX_SVG &&
    typeof title === 'string' &&
    typeof description === 'string'
    ? { id, svg, title: title.slice(0, MAX_TEXT), description: description.slice(0, MAX_TEXT) }
    : undefined;
}

function asFailed(data: unknown): Failed | undefined {
  if (typeof data !== 'object' || data === null || field(data, 'ok') !== false) {
    return undefined;
  }
  const id = field(data, 'id');
  const error = field(data, 'error');
  return typeof id === 'number' && typeof error === 'string'
    ? { id, error: error.slice(0, MAX_TEXT) }
    : undefined;
}

/** Starts the renderer when the page has diagrams; `undefined` otherwise. */
export function startDiagrams(tools: DiagramTools): Diagrams | undefined {
  const { root, createElement } = tools;
  const frameUrl = root.getAttribute('data-bd-diagrams');
  const body = root.querySelector('body');
  if (frameUrl === null || body === null) {
    return undefined;
  }
  const entries: Entry[] = [];
  for (const figure of root.querySelectorAll('article.markdown-body figure.bd-mermaid')) {
    const pre = figure.querySelector('pre');
    if (pre !== null) {
      const status = createElement('p');
      status.className = 'bd-mermaid-status';
      status.setAttribute('role', 'status');
      status.textContent = 'Drawing diagram…';
      figure.append(status);
      figure.setAttribute('data-bd-diagram', 'loading');
      entries.push({ figure, pre, source: pre.textContent, status });
    }
  }
  if (entries.length === 0) {
    return undefined;
  }

  const frame = createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Diagram renderer';
  frame.className = 'bd-mermaid-frame';
  frame.src = frameUrl;

  /** Request id → entry. Ids grow, so answers to an older round are ignored. */
  const pending = new Map<number, Entry>();
  let nextId = 1;
  let ready = false;

  const drawAll = (): void => {
    const target = frame.contentWindow;
    if (!ready || target === null) {
      return;
    }
    pending.clear();
    const theme = tools.theme();
    for (const entry of entries) {
      const id = nextId++;
      pending.set(id, entry);
      // The frame is opaque-origin, so it can't be named as a target origin.
      target.postMessage({ type: 'render', id, source: entry.source, theme }, '*');
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || frame.contentWindow === null) {
      return;
    }
    const data: unknown = event.data;
    if (typeof data === 'object' && data !== null && field(data, 'type') === 'ready') {
      ready = true;
      drawAll();
      return;
    }
    const drawn = asDrawn(data);
    const failed = drawn === undefined ? asFailed(data) : undefined;
    const id = drawn?.id ?? failed?.id;
    const entry = id === undefined ? undefined : pending.get(id);
    if (id === undefined || entry === undefined) {
      return;
    }
    pending.delete(id);
    if (drawn !== undefined) {
      show(entry, drawn, createElement);
    } else if (failed !== undefined) {
      fail(entry, failed.error);
    }
  });

  body.append(frame);
  // A renderer that never answers (it failed to load) must not leave "Drawing…" forever.
  window.setTimeout(() => {
    for (const entry of entries) {
      fail(entry, 'the diagram renderer did not respond.');
    }
  }, RENDER_TIMEOUT_MS);
  return { refresh: drawAll };
}

/**
 * Shows a drawn diagram as an image, with Preview and Code buttons that switch
 * between it and its source. A re-draw (new theme) only replaces the image.
 */
function show(entry: Entry, drawn: Drawn, createElement: CreateElement): void {
  let image = entry.image;
  if (image === undefined) {
    image = createElement('img');
    image.className = 'bd-mermaid-image';
    image.decoding = 'async';
    entry.image = image;
    entry.status.remove();
    entry.figure.prepend(viewButtons(entry, createElement), image);
    setView(entry, 'preview');
  }
  const alt = [drawn.title, drawn.description].filter((text) => text !== '').join(': ');
  image.alt = alt === '' ? 'Diagram' : alt;
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`;
  entry.figure.setAttribute('data-bd-diagram', 'drawn');
}

function viewButtons(entry: Entry, createElement: CreateElement): HTMLElement {
  const group = createElement('div');
  group.className = 'bd-mermaid-views';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Diagram view');
  for (const [view, label] of [
    ['preview', 'Preview'],
    ['code', 'Code'],
  ] as const) {
    const button = createElement('button');
    button.type = 'button';
    button.className = 'bd-mermaid-view';
    button.textContent = label;
    button.setAttribute('data-bd-view', view);
    button.addEventListener('click', () => {
      setView(entry, view);
    });
    group.append(button);
  }
  return group;
}

/** CSS shows the image or the code from the figure's `data-bd-view`. */
function setView(entry: Entry, view: View): void {
  entry.figure.setAttribute('data-bd-view', view);
  for (const button of entry.figure.querySelectorAll('.bd-mermaid-view')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-bd-view') === view));
  }
}

/**
 * A diagram that can't be drawn keeps its source, and the note says why. One that
 * was drawn before (a re-draw for a new theme failed) keeps its last image.
 */
function fail(entry: Entry, error: string): void {
  if (entry.image !== undefined || entry.failed === true) {
    return;
  }
  entry.failed = true;
  entry.status.className = 'bd-mermaid-status bd-mermaid-error';
  entry.status.textContent = `This diagram couldn't be drawn: ${error}`;
  entry.figure.setAttribute('data-bd-diagram', 'failed');
}
