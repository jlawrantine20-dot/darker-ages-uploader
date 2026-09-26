import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { DryRunChannel, whatsappCloud } from './channels/whatsapp.js';
import { loadConfig } from './config.js';
import { embeddedDb, migrate, postgresDb } from './db.js';
import { dryRunPayments, paystack } from './payments/paystack.js';
import { tick } from './services/restock.js';

const config = loadConfig();
const db = config.databaseUrl ? await postgresDb(config.databaseUrl) : await embeddedDb(config.dataDir ?? './.data');
await migrate(db);

const channel = config.dryRun
  ? new DryRunChannel((m) => console.log(`[dry-run] to ${m.to}: ${m.body ?? `${m.template?.name} ${JSON.stringify(m.template?.params)}`}`))
  : whatsappCloud({ token: config.whatsapp.token, apiVersion: config.whatsapp.apiVersion });
const payments = config.dryRun
  ? dryRunPayments(config.publicUrl)
  : paystack({ secretKey: config.paystack.secretKey, callbackUrl: config.paystack.callbackUrl });

const ctx = { db, channel, payments, config };
serve({ fetch: createApp(ctx).fetch, port: config.port }, ({ port }) => {
  console.log(`Oja listening on :${port}${config.dryRun ? ' (dry run: nothing is sent)' : ''}`);
});

// Expire holds and pass units down the line once a minute.
setInterval(() => {
  tick(ctx, new Date()).catch((err) => console.error('tick failed', err));
}, 60_000);
