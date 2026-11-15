// Builds everything the extension ships into `dist/`:
//
// - `dist/extension.js`: the extension host bundle (CommonJS, `vscode` external).
// - `dist/assets/sidebar.js`: the tiny browser script for the page sidebar (IIFE,
//   so it never defines globals).
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(client)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(client)]);
}
