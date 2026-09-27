/**
 * NKAPGUARD Seller App on Supabase Edge Functions (Deno). Bundled by `npm run build:edge`
 * into edge/dist/index.js, which is what gets deployed as the `seller-app` function.
 *
 * Data lives in its own `seller_app` schema, so it never touches other tables in the project.
 * Supabase provides SUPABASE_URL, SUPABASE_DB_URL and SUPABASE_SERVICE_ROLE_KEY automatically.
 */
// @ts-nocheck: Deno runtime globals and npm: specifiers
import postgres from 'npm:postgres@3.4.9';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

// Node globals the shared code relies on; Deno only exposes them to npm packages.
globalThis.Buffer ??= Buffer;
globalThis.process ??= { env: {} };
import { Hono } from 'hono';
import { createApp } from '../src/app.ts';
import { DryRunChannel, whatsappCloud } from '../src/channels/whatsapp.ts';
import { loadConfig } from '../src/config.ts';
import { tick } from '../src/services/restock.ts';

const FUNCTION = 'seller-app';
const env = Deno.env.toObject();
// Defaults the deployed entry file can supply (e.g. APP_URL); real environment variables win.
const defaults = globalThis.__nkg?.defaults ?? {};
const config = loadConfig({
  ...defaults,
  ...env,
  DRY_RUN: env.DRY_RUN ?? 'true',
  PUBLIC_URL: env.PUBLIC_URL ?? `${env.SUPABASE_URL}/functions/v1/${FUNCTION}`,
  // Payment keys are encrypted with APP_SECRET; without one set, derive a stable key from the
  // service role key, which is never stored in the database.
  APP_SECRET: env.APP_SECRET ?? createHash('sha256').update(`nkapguard-seller-app:${env.SUPABASE_SERVICE_ROLE_KEY}`).digest('hex'),
  // A public deployment is never open to callers without credentials, even in test mode.
  OPEN_TEST_MODE: 'false',
});

const sql = postgres(env.SUPABASE_DB_URL, {
  prepare: false,
  max: 3,
  connection: { search_path: 'seller_app' },
  types: { bigint: { to: 20, from: [20], parse: (v: string) => Number(v), serialize: (v: unknown) => String(v) } },
});
const wrap = (s) => ({ query: async (text: string, params: unknown[] = []) => [...(await s.unsafe(text, params))] });
const db = {
  ...wrap(sql),
  tx: (fn) => sql.begin((t) => fn(wrap(t))),
  exec: async (text: string) => { await sql.unsafe(text); },
  close: () => sql.end(),
};

const channel = config.dryRun
  ? new DryRunChannel((m) => console.log(`[test mode] to ${m.to}: ${m.body ?? `${m.template?.name} ${JSON.stringify(m.template?.params)}`}`))
  : whatsappCloud({ token: config.whatsapp.token, apiVersion: config.whatsapp.apiVersion });
const ctx = { db, channel, config };

const root = new Hono();
root.route(`/${FUNCTION}`, createApp(ctx));

// Edge functions have no timer, so expired holds are passed on at most once a minute when
// requests come in. An external cron hitting POST /api/tick with the admin token keeps it exact.
let lastTick = 0;
Deno.serve((req: Request) => {
  if (Date.now() - lastTick > 60_000) {
    lastTick = Date.now();
    const run = tick(ctx, new Date()).catch((err) => console.error('tick failed', err));
    // @ts-ignore EdgeRuntime is provided by Supabase
    globalThis.EdgeRuntime?.waitUntil?.(run);
  }
  return root.fetch(req);
});
