import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { parseWebhook, verifyMetaSignature } from './channels/whatsapp.js';
import { parsePaystackEvent, verifyPaystackSignature } from './payments/paystack.js';
import type { Ctx } from './services/context.js';
import { handleInbound } from './services/inbound.js';
import { InputError, handlePayment, startRestock, tick } from './services/restock.js';

export function createApp(ctx: Ctx, clock: () => Date = () => new Date()) {
  const app = new Hono();
  const { config, db } = ctx;

  app.onError((err, c) => {
    if (err instanceof InputError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on our side.' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true, dryRun: config.dryRun }));

  // ---- WhatsApp Cloud API webhook ----
  app.get('/webhooks/whatsapp', (c) => {
    const q = c.req.query();
    if (q['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && q['hub.verify_token'] === config.whatsapp.verifyToken) {
      return c.text(q['hub.challenge'] ?? '');
    }
    return c.text('Verification token does not match.', 403);
  });

  app.post('/webhooks/whatsapp', async (c) => {
    const raw = await c.req.text();
    if (!config.dryRun && !verifyMetaSignature(raw, c.req.header('x-hub-signature-256'), config.whatsapp.appSecret)) {
      return c.text('Bad signature.', 401);
    }
    const results = [];
    for (const msg of parseWebhook(JSON.parse(raw))) {
      const r = await handleInbound(ctx, msg);
      results.push({ from: msg.from, action: r.action, replies: r.sent.map((s) => s.status) });
    }
    return c.json({ handled: results });
  });

  // ---- Paystack webhook ----
  app.post('/webhooks/paystack', async (c) => {
    const raw = await c.req.text();
    if (!config.dryRun && !verifyPaystackSignature(raw, c.req.header('x-paystack-signature'), config.paystack.secretKey)) {
      return c.text('Bad signature.', 401);
    }
    const event = parsePaystackEvent(JSON.parse(raw));
    if (!event) return c.json({ ignored: true });
    const r = await handlePayment(ctx, event, clock());
    return c.json({ outcome: r.outcome });
  });

  // ---- Seller API ----
  const admin = async (c: Context, next: Next) => {
    const allowOpen = config.dryRun && !config.adminToken;
    if (!allowOpen && c.req.header('authorization') !== `Bearer ${config.adminToken}`) {
      return c.json({ error: 'Send the admin token as "Authorization: Bearer <token>".' }, 401);
    }
    await next();
  };
  app.use('/api/*', admin);

  app.post('/api/sellers', async (c) => {
    const b = await c.req.json<{ name: string; waPhoneNumberId: string }>();
    if (!b.name || !b.waPhoneNumberId) throw new InputError('name and waPhoneNumberId are required');
    const [row] = await db.query('insert into sellers (name, wa_phone_number_id) values ($1, $2) returning *', [b.name, b.waPhoneNumberId]);
    return c.json(row, 201);
  });

  app.post('/api/products', async (c) => {
    const b = await c.req.json<{ sellerId: string; name: string; variant?: string; aliases?: string[]; priceNaira: number; stock?: number }>();
    if (!b.sellerId || !b.name || !(b.priceNaira >= 0)) throw new InputError('sellerId, name and priceNaira are required');
    const [row] = await db.query(
      'insert into products (seller_id, name, variant, aliases, price_kobo, stock) values ($1, $2, $3, $4, $5, $6) returning *',
      [b.sellerId, b.name, b.variant ?? '', b.aliases ?? [], Math.round(b.priceNaira * 100), b.stock ?? 0],
    );
    return c.json(row, 201);
  });

  app.get('/api/products', async (c) => {
    const sellerId = c.req.query('sellerId');
    const rows = await db.query(
      `select p.*, (select count(*)::int from interests i where i.product_id = p.id and i.status = 'waiting') as waiting
         from products p where ($1::uuid is null or p.seller_id = $1) order by waiting desc, p.name`,
      [sellerId ?? null],
    );
    return c.json(rows);
  });

  app.get('/api/products/:id/waitlist', async (c) => {
    const rows = await db.query(
      `select row_number() over (order by i.created_at, i.id)::int as position, c.name, c.wa_id, i.created_at as joined_at, k.quote as consent_quote
         from interests i join contacts c on c.id = i.contact_id join consents k on k.id = i.consent_id
        where i.product_id = $1 and i.status = 'waiting' and k.revoked_at is null
        order by i.created_at, i.id`,
      [c.req.param('id')],
    );
    return c.json(rows);
  });

  app.post('/api/products/:id/restocks', async (c) => {
    const b = await c.req.json<{ units: number; mode: 'hold' | 'race'; holdMinutes?: number; perUnit?: number }>();
    const r = await startRestock(ctx, { productId: c.req.param('id'), ...b }, clock());
    return c.json(r, 201);
  });

  app.get('/api/restocks/:id', async (c) => {
    const [restock] = await db.query('select * from restocks where id = $1', [c.req.param('id')]);
    if (!restock) return c.json({ error: 'No restock with that id.' }, 404);
    const offers = await db.query(
      `select o.status, o.sent_at, o.expires_at, o.paid_at, o.refund_due, o.payment_url, c.name, c.wa_id
         from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
        where o.restock_id = $1 order by o.sent_at, i.created_at`,
      [c.req.param('id')],
    );
    return c.json({ restock, offers });
  });

  app.get('/api/consents', async (c) => {
    const rows = await db.query(
      `select k.purpose, k.channel, k.quote, k.granted_at, k.revoked_at, c.name, c.wa_id, p.name as product, p.variant
         from consents k join contacts c on c.id = k.contact_id left join products p on p.id = k.product_id
        where ($1::uuid is null or k.seller_id = $1) order by k.granted_at desc`,
      [c.req.query('sellerId') ?? null],
    );
    return c.json(rows);
  });

  app.get('/api/spend', async (c) => {
    const rows = await db.query(
      `select coalesce(category, 'none') as category, count(*)::int as messages, sum(cost_kobo)::int as cost_kobo
         from messages where direction = 'out' and ($1::uuid is null or seller_id = $1) group by 1 order by 1`,
      [c.req.query('sellerId') ?? null],
    );
    return c.json(rows);
  });

  app.post('/api/tick', async (c) => c.json({ sent: (await tick(ctx, clock())).length }));

  // ---- Dry-run helpers: pretend a customer paid a link ----
  if (config.dryRun) {
    app.post('/dev/pay/:ref', async (c) => {
      const [o] = await db.query<{ price_kobo: number }>(
        `select p.price_kobo from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id where o.payment_ref = $1`,
        [c.req.param('ref')],
      );
      if (!o) return c.json({ error: 'No offer with that payment reference.' }, 404);
      const r = await handlePayment(ctx, { reference: c.req.param('ref'), amountKobo: o.price_kobo }, clock());
      return c.json({ outcome: r.outcome });
    });
  }

  return app;
}
