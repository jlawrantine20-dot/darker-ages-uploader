import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { nodeWebFiles } from './web-files.js';
import { DryRunChannel, whatsappCloud } from './channels/whatsapp.js';
import { loadConfig } from './config.js';
import { embeddedDb, migrate, postgresDb } from './db.js';
import { tick } from './services/restock.js';

const config = loadConfig();
const db = config.databaseUrl ? await postgresDb(config.databaseUrl) : await embeddedDb(config.dataDir ?? './.data');
await migrate(db);

const channel = config.dryRun
  ? new DryRunChannel((m) => console.log(`[test mode] to ${m.to}: ${m.body ?? `${m.template?.name} (${m.template?.language}) ${JSON.stringify(m.template?.params)}`}`))
  : whatsappCloud({ token: config.whatsapp.token, apiVersion: config.whatsapp.apiVersion });

const ctx = { db, channel, config };
const webFiles = nodeWebFiles();
serve({ fetch: createApp(ctx, () => new Date(), { webFiles }).fetch, port: config.port }, ({ port }) => {
  console.log(`NKAPGUARD listening on :${port}${config.dryRun ? ' (test mode: nothing is sent, payments are simulated)' : ''}`);
});

// Expire holds and pass units down the line once a minute.
setInterval(() => {
  tick(ctx, new Date()).catch((err) => console.error('tick failed', err));
}, 60_000);
