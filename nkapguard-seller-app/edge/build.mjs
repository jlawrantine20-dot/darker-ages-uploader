// Builds two versions of the Supabase function bundle:
//   dist/index.js   imports its libraries with npm:/node: specifiers (deploy as a local file)
//   dist/remote.js  has no imports at all; the deployed entry file loads the libraries and
//                   passes them in via globalThis.__nkg.deps, because Deno forbids npm:
//                   imports inside modules fetched from a URL.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const version = (n) => JSON.parse(readFileSync(new URL(`../node_modules/${n}/package.json`, import.meta.url))).version;
const pins = { hono: `npm:hono@${version('hono')}`, 'hono/cors': `npm:hono@${version('hono')}/cors`, 'libphonenumber-js': `npm:libphonenumber-js@${version('libphonenumber-js')}` };
const base = { entryPoints: [new URL('./index.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', target: 'es2022', minifyWhitespace: true, legalComments: 'none', logLevel: 'warning' };

await build({
  ...base,
  outfile: new URL('./dist/index.js', import.meta.url).pathname,
  plugins: [{ name: 'pin', setup(b) { b.onResolve({ filter: /^(hono|hono\/cors|libphonenumber-js)$/ }, (a) => ({ path: pins[a.path], external: true })); b.onResolve({ filter: /^(npm|node):/ }, (a) => ({ path: a.path, external: true })); } }],
});

const INJECTED = /^(hono|hono\/cors|libphonenumber-js|npm:postgres@[\d.]+|node:buffer|node:crypto)$/;
await build({
  ...base,
  outfile: new URL('./dist/remote.js', import.meta.url).pathname,
  plugins: [{ name: 'inject', setup(b) {
    b.onResolve({ filter: INJECTED }, (a) => ({ path: a.path, namespace: 'inject' }));
    b.onLoad({ filter: /.*/, namespace: 'inject' }, (a) => ({ contents: `module.exports = globalThis.__nkg.deps[${JSON.stringify(a.path)}];`, loader: 'js' }));
  } }],
});
console.log('pins:', JSON.stringify(pins));
