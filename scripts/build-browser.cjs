#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = path.resolve(root, process.argv[2] || 'src/browser.ts');
const shim = path.join(root, 'src', 'browserNodeShims.ts');
const outdir = path.resolve(root, process.argv[3] || 'dist/browser');

const nodeShimPlugin = {
  name: 'node-browser-shims',
  setup(build) {
    // The browser entry has its own Web Streams parser, so the readable-stream based StreamParser is not needed there.
    build.onResolve({ filter: /^readable-stream$/ }, () => ({ path: shim }));
  },
};

async function build() {
  fs.mkdirSync(outdir, { recursive: true });
  const common = {
    entryPoints: [entry],
    bundle: true,
    minify: true,
    platform: 'browser',
    target: ['es2020'],
    sourcemap: false,
    legalComments: 'none',
    plugins: [nodeShimPlugin],
    logLevel: 'info',
  };

  await Promise.all([
    esbuild.build({
      ...common,
      format: 'esm',
      outfile: path.join(outdir, 'index.mjs'),
    }),
    esbuild.build({
      ...common,
      format: 'iife',
      globalName: 'RDFParserTS',
      outfile: path.join(outdir, 'index.global.js'),
    }),
  ]);

  // Bundle the declarations of the browser entry with tsup, so they cannot drift from src/browser.ts.
  const tsup = spawnSync('npx', ['tsup', '--entry.index', path.relative(root, entry), '--dts-only', '--format', 'cjs,esm', '--out-dir', path.relative(root, outdir)], { cwd: root, stdio: 'inherit' });
  if (tsup.status !== 0) throw new Error('Generating browser declarations failed');
}

build().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
