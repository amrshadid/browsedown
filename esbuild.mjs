// Builds everything the extension ships into `dist/`:
//
// - `dist/extension.js`: the extension host bundle (CommonJS, `vscode` external).
// - `dist/assets/sidebar.js`: the tiny browser script for the page sidebar (IIFE,
//   so it never defines globals).
// - `dist/assets/*.css`: GitHub's Markdown styles, the highlight.js themes, and the
//   page chrome (`src/client/page.css`).
//
// A production build fails if the extension bundle exceeds its size budget.
import * as esbuild from 'esbuild';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** The minified extension bundle must stay at or below 700 KB: activation stays fast. */
const EXTENSION_BUDGET_BYTES = 700 * 1024;

const require = createRequire(import.meta.url);
const assetsDir = 'dist/assets';

/** @type {import('esbuild').BuildOptions} */
const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const client = {
  entryPoints: ['src/client/sidebar.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: `${assetsDir}/sidebar.js`,
  sourcemap: false,
  minify: production,
  logLevel: 'info',
};

/** Applies to the page when the reader picked no theme: follow the system. */
const SYSTEM = 'html:not([data-bd-theme])';
const FORCED = (theme) => `html[data-bd-theme="${theme}"]`;

/**
 * github-markdown-css defines its colours as two variable blocks inside
 * `prefers-color-scheme` media queries. Re-emit them so the page can follow the
 * system (default) or be forced light or dark by the theme switch. Fails the build
 * if a future version changes that structure, instead of silently losing a theme.
 */
function themeMarkdownCss(css) {
  const blocks = {};
  const rest = css.replace(
    /@media \(prefers-color-scheme: (dark|light)\) \{\s*\.markdown-body, \[data-theme="\1"\] \{([^}]*)\}\s*\}/g,
    (_, theme, body) => {
      blocks[theme] = body;
      return '';
    },
  );
  if (blocks.light === undefined || blocks.dark === undefined) {
    throw new Error('github-markdown-css: theme blocks not found; check the upstream structure.');
  }
  const vars = (selector, theme) => `${selector} .markdown-body {${blocks[theme]}}`;
  return [
    '/* github-markdown-css (MIT, sindresorhus), re-themed for the system/light/dark switch. */',
    rest,
    `@media (prefers-color-scheme: light) {\n${vars(SYSTEM, 'light')}\n}`,
    `@media (prefers-color-scheme: dark) {\n${vars(SYSTEM, 'dark')}\n}`,
    vars(FORCED('light'), 'light'),
    vars(FORCED('dark'), 'dark'),
    '',
  ].join('\n');
}

/** Prefixes every selector of a plain rule list (no at-rules) with `scope`. */
function scopeRules(css, scope) {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (plain.includes('@')) {
    throw new Error('scopeRules(): at-rules are not supported.');
  }
  return plain.replace(
    /([^{}]+)\{/g,
    (_, selectors) =>
      `${selectors
        .split(',')
        .map((selector) => `${scope} ${selector.trim()}`)
        .join(', ')} {`,
  );
}

/**
 * Copies the stylesheets: GitHub's Markdown styles and the highlight.js github /
 * github-dark themes, each able to follow the system or be forced by the reader's
 * theme choice, plus our page chrome.
 */
async function copyCss() {
  await mkdir(assetsDir, { recursive: true });
  const markdownCss = await readFile(
    require.resolve('github-markdown-css/github-markdown.css'),
    'utf8',
  );
  await writeFile(path.join(assetsDir, 'github-markdown.css'), themeMarkdownCss(markdownCss));

  const light = await readFile(require.resolve('highlight.js/styles/github.css'), 'utf8');
  const dark = await readFile(require.resolve('highlight.js/styles/github-dark.css'), 'utf8');
  const highlight = [
    '/* highlight.js "github" and "github-dark" themes (BSD-3-Clause), for the theme switch. */',
    `@media (prefers-color-scheme: light) {\n${scopeRules(light, SYSTEM)}\n}`,
    `@media (prefers-color-scheme: dark) {\n${scopeRules(dark, SYSTEM)}\n}`,
    scopeRules(light, FORCED('light')),
    scopeRules(dark, FORCED('dark')),
    '',
  ].join('\n');
  await writeFile(path.join(assetsDir, 'highlight.css'), highlight);

  // The page chrome (header, tree, outline): ours, written for the CSP's style-src 'self'.
  await writeFile(path.join(assetsDir, 'page.css'), await readFile('src/client/page.css'));
}

async function checkBudget() {
  const { size } = await stat(extension.outfile ?? '');
  const kb = (size / 1024).toFixed(1);
  if (size > EXTENSION_BUDGET_BYTES) {
    console.error(
      `dist/extension.js is ${kb} KB, over the ${EXTENSION_BUDGET_BYTES / 1024} KB budget.`,
    );
    process.exit(1);
  }
  console.log(`dist/extension.js: ${kb} KB (budget ${EXTENSION_BUDGET_BYTES / 1024} KB)`);
}

await copyCss();
if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(client)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(client)]);
  if (production) {
    await checkBudget();
  }
}
