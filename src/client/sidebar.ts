// The only script on a preview page. It adds comfort, never content: with
// JavaScript off, the tree (native <details>) and the outline links still work.
//
// - Opens and closes the file tree and the outline, and remembers that for the
//   preview session (sessionStorage, cleared when the tab closes).
// - Remembers open folders and the chosen theme.
// - Highlights the outline entry for the section being read.
// - Starts the sandboxed Mermaid renderer on pages with diagrams (diagrams.ts).
//
// Documents are sanitized, but a page could still shadow `document.<name>`: an
// `<img name="querySelectorAll">` replaces that method on the document object.
// So the script reads `document.documentElement` once, in <head> before any
// content exists, and works through that element and `window` from then on.
// (The sanitizer also prefixes `name` attributes.)
//
// Loaded in <head> without `defer`, so remembered state applies before the first
// paint; everything else waits for DOMContentLoaded.

import { startDiagrams, type DiagramTheme, type Diagrams } from './diagrams';

type Panel = 'tree' | 'outline';
const PANELS: readonly Panel[] = ['tree', 'outline'];

const root = document.documentElement;
// Taken from the prototype, which page content can't shadow, unlike the document object.
const createOnDocument: unknown = Reflect.get(Document.prototype, 'createElement');
function createElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  if (typeof createOnDocument !== 'function') {
    throw new TypeError('createElement is unavailable');
  }
  return Reflect.apply(createOnDocument, document, [tag]) as HTMLElementTagNameMap[K];
}

// Lookups go through the <html> element, captured above before any content
// exists: unlike the document object, an ordinary element can't be shadowed by
// named children, and it contains the whole page.
function queryAll<E extends Element = Element>(selector: string): E[] {
  return [...root.querySelectorAll<E>(selector)];
}
const stateKey = root.getAttribute('data-bd-state') ?? 'browsedown';

/** Below this width the panels float over the page instead of sitting beside it. */
const narrow = (panel: Panel): boolean =>
  window.matchMedia(panel === 'tree' ? '(max-width: 767px)' : '(max-width: 1279px)').matches;

function load(key: string): string | null {
  try {
    return window.sessionStorage.getItem(`${stateKey}:${key}`);
  } catch {
    return null; // Storage blocked (private mode, policies): fall back to defaults.
  }
}

function save(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(`${stateKey}:${key}`, value);
  } catch {
    // Nothing to do: state is a convenience.
  }
}

/** A stored list of strings; anything unreadable counts as empty. */
function loadList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(load(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function isOpen(panel: Panel): boolean {
  return root.getAttribute(`data-bd-${panel}`) !== 'closed';
}

function setOpen(panel: Panel, open: boolean, remember: boolean): void {
  root.setAttribute(`data-bd-${panel}`, open ? 'open' : 'closed');
  for (const button of queryAll(`[data-bd-toggle="${panel}"]`)) {
    button.setAttribute('aria-expanded', String(open));
  }
  // Floating panels are a temporary view, so only the wide layout is remembered.
  if (remember && !narrow(panel)) {
    save(panel, open ? 'open' : 'closed');
  }
}

// Theme: 'system' (no attribute: CSS follows prefers-color-scheme) or a forced
// 'light' / 'dark'. A reading preference, so it lives in localStorage.
type Theme = 'system' | 'light' | 'dark';
const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const THEME_KEY = 'browsedown:theme';
const THEME_NAMES: Readonly<Record<Theme, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

function loadTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme): void {
  if (theme === 'system') {
    root.removeAttribute('data-bd-theme');
  } else {
    root.setAttribute('data-bd-theme', theme);
  }
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'system';
  const label = `Theme: ${THEME_NAMES[theme]}. Switch to ${THEME_NAMES[next]}`;
  for (const button of queryAll('[data-bd-theme-toggle]')) {
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
}

function currentTheme(): Theme {
  const value = root.getAttribute('data-bd-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

/** The Mermaid theme that matches what the page shows now. */
function diagramTheme(): DiagramTheme {
  const theme = currentTheme();
  return theme === 'dark' || (theme === 'system' && systemDark.matches) ? 'dark' : 'default';
}

let diagrams: Diagrams | undefined;

// 1. Before first paint: restore the theme and each panel's state.
root.setAttribute('data-bd-js', '');
applyTheme(loadTheme());
for (const panel of PANELS) {
  const stored = narrow(panel) ? null : load(panel);
  // The tree starts open on wide screens; the outline always starts closed, so the
  // document gets the room. Both remember the reader's choice for the session.
  const fallback = panel === 'outline' || narrow(panel) ? 'closed' : 'open';
  root.setAttribute(`data-bd-${panel}`, stored ?? fallback);
}

// 2. After the document has loaded: wire everything up.
window.addEventListener('DOMContentLoaded', () => {
  for (const panel of PANELS) {
    setOpen(panel, isOpen(panel), false);
  }
  applyTheme(currentTheme()); // Now the button exists: set its label.
  diagrams = startDiagrams({ root, createElement, theme: diagramTheme });
  systemDark.addEventListener('change', () => {
    if (currentTheme() === 'system') {
      diagrams?.refresh();
    }
  });

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest('[data-bd-toggle]')?.getAttribute('data-bd-toggle');
    const close = target?.closest('[data-bd-close]')?.getAttribute('data-bd-close');
    if (target?.closest('[data-bd-theme-toggle]')) {
      const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length] ?? 'system';
      applyTheme(next);
      diagrams?.refresh();
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Not remembered; it still applies to this page.
      }
    } else if (toggle === 'tree' || toggle === 'outline') {
      setOpen(toggle, !isOpen(toggle), true);
    } else if (close === 'tree' || close === 'outline') {
      setOpen(close, false, true);
    } else if (target?.closest('.bd-outline-link') && narrow('outline')) {
      setOpen('outline', false, false); // Jumped to a heading: get the overlay out of the way.
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    for (const panel of PANELS) {
      if (narrow(panel) && isOpen(panel)) {
        setOpen(panel, false, false);
      }
    }
  });

  rememberFolders();
  revealCurrentFile();
  spyOnSections();
});

/** Keeps folders the reader opened or closed that way on the next page. */
function rememberFolders(): void {
  const open = new Set(loadList('folders'));
  const closed = new Set(loadList('folders-closed'));
  for (const details of queryAll<HTMLDetailsElement>('details[data-bd-folder]')) {
    const path = details.getAttribute('data-bd-folder') ?? '';
    // The page opens the current file's folders; the reader's choices win otherwise.
    if (open.has(path)) {
      details.open = true;
    } else if (closed.has(path) && !details.querySelector('[aria-current="page"]')) {
      details.open = false;
    }
    details.addEventListener('toggle', () => {
      (details.open ? open : closed).add(path);
      (details.open ? closed : open).delete(path);
      save('folders', JSON.stringify([...open]));
      save('folders-closed', JSON.stringify([...closed]));
    });
  }
}

function revealCurrentFile(): void {
  root
    .querySelector('[data-bd-panel="tree"] [aria-current="page"]')
    ?.scrollIntoView({ block: 'center' });
}

/** Marks the outline entry of the heading nearest the top of the viewport. */
function spyOnSections(): void {
  const links = queryAll<HTMLAnchorElement>('a[data-bd-heading]');
  const article = root.querySelector('article.markdown-body');
  if (links.length === 0 || article === null) {
    return;
  }
  // Headings by id, from inside the article only (never by global name).
  const headings = new Map<string, Element>();
  for (const heading of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    headings.set(heading.getAttribute('id') ?? '', heading);
  }
  const entries = links.flatMap((link) => {
    const heading = headings.get(link.getAttribute('data-bd-heading') ?? '');
    return heading === undefined ? [] : [{ link, heading }];
  });
  let active: HTMLAnchorElement | undefined;
  /**
   * A heading the reader chose (outline click, in-page link, Back/Forward to an
   * anchor). A short section near the end can't scroll to the top, so position
   * alone would point at a later heading; the choice wins until the reader
   * scrolls by hand.
   */
  let chosen: string | null = null;
  const choose = (id: string | null): void => {
    chosen = id !== null && entries.some((e) => e.heading.getAttribute('id') === id) ? id : null;
    update();
  };
  const fromHash = (): string | null => {
    if (location.hash.length < 2) {
      return null;
    }
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return null;
    }
  };

  const update = (): void => {
    const picked = entries.find((e) => e.heading.getAttribute('id') === chosen);
    if (picked !== undefined) {
      mark(picked.link);
      return;
    }
    const offset = 96; // Below the sticky header.
    let current = entries[0];
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top - offset <= 0) {
        current = entry;
      } else {
        break;
      }
    }
    // At the very bottom, the last sections may be too short to reach the top:
    // the reader is at the end, so the last heading is the honest answer.
    const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
    if (atBottom && window.scrollY > 0) {
      current = entries[entries.length - 1];
    }
    mark(current?.link);
  };
  const mark = (link: HTMLAnchorElement | undefined): void => {
    if (link !== active) {
      active?.removeAttribute('aria-current');
      active = link;
      active?.setAttribute('aria-current', 'location');
    }
  };

  // The reader chose a heading.
  for (const { link } of entries) {
    link.addEventListener('click', () => {
      choose(link.getAttribute('data-bd-heading'));
    });
  }
  window.addEventListener('hashchange', () => {
    choose(fromHash());
  });
  // The reader scrolls by hand: position decides again.
  const release = (): void => {
    if (chosen !== null) {
      chosen = null;
      update();
    }
  };
  window.addEventListener('wheel', release, { passive: true });
  window.addEventListener('touchmove', release, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      release();
    }
  });
  window.addEventListener('mousedown', (event) => {
    // Dragging the scrollbar, or clicking into the page; not a click on a heading link.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('a[data-bd-heading], .markdown-body a[href^="#"]') === null) {
      release();
    }
  });

  let scheduled = false;
  window.addEventListener(
    'scroll',
    () => {
      if (!scheduled) {
        scheduled = true;
        window.requestAnimationFrame(() => {
          scheduled = false;
          update();
        });
      }
    },
    { passive: true },
  );
  // Arriving with an anchor (a link from another page, Back/Forward, a shared URL).
  choose(fromHash());
}

export {};
