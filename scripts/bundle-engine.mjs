#!/usr/bin/env node
/**
 * Bundles the clai CLI and everything it imports into one ESM file, plus the built dashboard,
 * for clai for Mac (apps/mac). The app runs it with its embedded Node:
 *   <out>/clai.mjs        the whole engine (`node clai.mjs snapshot --scan`, `... dashboard`)
 *   <out>/dashboard/      the dashboard SPA, found by dashboardDistDir() next to the bundle
 *   <out>/tokenizers/     ChatGPT-export token estimators, loaded only by `clai import`
 *
 * Usage: node scripts/bundle-engine.mjs [outDir]   (default apps/mac/build/engine)
 * Needs the dashboard built first (npm run build); the TypeScript sources are bundled directly.
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'apps/mac/build/engine'));
const version = JSON.parse(readFileSync(join(root, 'apps/cli/package.json'), 'utf8')).version;
const dashboard = join(root, 'apps/dashboard/dist');

if (!existsSync(join(dashboard, 'index.html'))) {
  console.error('The dashboard is not built. Run `npm run build` first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// gpt-tokenizer's encodings are 3.6 MB of JavaScript that only `clai import` of a ChatGPT export
// uses. They go into their own files, loaded on first use, so every other command (the menu bar
// refreshes on each log write) starts without parsing them.
const TOKENIZERS = ['o200k_base', 'cl100k_base'];
const lazyTokenizers = {
  name: 'lazy-gpt-tokenizer',
  setup(b) {
    b.onResolve({ filter: /^gpt-tokenizer\/encoding\/(o200k_base|cl100k_base)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'lazy-tokenizer' }));
    b.onResolve({ filter: /^\.\/tokenizers\// }, (args) => ({ path: args.path, external: true }));
    b.onLoad({ filter: /.*/, namespace: 'lazy-tokenizer' }, (args) => ({
      contents: `let impl;\nexport function countTokens(text) {\n  impl ??= require('./tokenizers/${args.path}.cjs');\n  return impl.countTokens(text);\n}\n`,
      loader: 'js',
    }));
  },
};
for (const name of TOKENIZERS) {
  await build({
    entryPoints: [join(root, 'node_modules/gpt-tokenizer/esm/encoding', `${name}.js`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22.13',
    outfile: join(out, 'tokenizers', `${name}.cjs`),
    legalComments: 'none',
    minify: true,
    logLevel: 'warning',
  });
}

await build({
  stdin: {
    contents: [
      "import { run } from './apps/cli/src/index.ts';",
      'run(process.argv).catch((err) => {',
      '  console.error(err instanceof Error ? err.message : String(err));',
      '  process.exit(1);',
      '});',
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'clai-engine.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.13',
  outfile: join(out, 'clai.mjs'),
  // Resolve @claii/* to their TypeScript sources (the same paths the whole-tree typecheck uses).
  tsconfig: join(root, 'tsconfig.check.json'),
  define: { __CLAI_VERSION__: JSON.stringify(version) },
  // CommonJS dependencies (commander, picocolors) call require() for Node builtins.
  banner: { js: "import { createRequire as __claiRequire } from 'node:module';\nconst require = __claiRequire(import.meta.url);" },
  plugins: [lazyTokenizers],
  legalComments: 'none',
  minify: true,
  logLevel: 'warning',
});

cpSync(dashboard, join(out, 'dashboard'), { recursive: true });

const kb = (p) => Math.round(statSync(p).size / 1024);
console.log(`engine ${version}: ${relative(root, join(out, 'clai.mjs'))} (${kb(join(out, 'clai.mjs'))} KB) + dashboard/`);
