// Builds everything the extension ships into `dist/`:
//
// - `dist/extension.js`: the extension host bundle (CommonJS, `vscode` external).
// - `dist/assets/sidebar.js`: the tiny browser script for the page sidebar (IIFE,
//   so it never defines globals).
// - `dist/assets/*.css`: GitHub's Markdown styles and the highlight.js themes.
//
// A production build fails if the extension bundle exceeds the budget in ADR 0004.
import * as esbuild from 'esbuild';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** ADR 0004: the minified extension bundle must stay at or below 700 KB. */
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

/**
 * Copies the stylesheets. github-markdown-css already switches between light and
 * dark with `prefers-color-scheme`; the highlight.js themes are two separate files,
 * so they are wrapped in the matching media queries and joined into one.
 */
async function copyCss() {
  await mkdir(assetsDir, { recursive: true });
  const markdownCss = await readFile(require.resolve('github-markdown-css/github-markdown.css'));
  await writeFile(path.join(assetsDir, 'github-markdown.css'), markdownCss);

  const light = await readFile(require.resolve('highlight.js/styles/github.css'), 'utf8');
  const dark = await readFile(require.resolve('highlight.js/styles/github-dark.css'), 'utf8');
  const highlight = [
    '/* highlight.js "github" and "github-dark" themes (BSD-3-Clause), following the system. */',
    `@media (prefers-color-scheme: light) {\n${light}\n}`,
    `@media (prefers-color-scheme: dark) {\n${dark}\n}`,
    '',
  ].join('\n');
  await writeFile(path.join(assetsDir, 'highlight.css'), highlight);
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
