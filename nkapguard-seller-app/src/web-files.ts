import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

/** Serve the seller app from ./web under /app, for the Node server. */
export function nodeWebFiles() {
  const webRoot = relative(process.cwd(), fileURLToPath(new URL('../web', import.meta.url))) || '.';
  return {
    assets: serveStatic({ root: webRoot, rewriteRequestPath: (p) => p.replace(/^\/app/, '') }),
    index: serveStatic({ path: `${webRoot}/index.html` }),
  };
}
