import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { parseWebhook, verifyMetaSignature } from './channels/whatsapp.js';
import { LANGS, MARKETS, RATE_GROUPS, ratesFor } from './domain/markets.js';
import { toMinor } from './domain/money.js';
import { whatsappWindowOpen } from './domain/windows.js';
import { PROVIDER_INFO } from './payments/providers.js';
import type { Ctx } from './services/context.js';
import { InputError } from './services/errors.js';
import { handleInbound } from './services/inbound.js';
import { dispatch } from './services/outbound.js';
import { baseRef, handlePayment, previewRestock, startRestock, tick } from './services/restock.js';
import { escapeHtml, page, pageText } from './pages.js';
import { formatMoney } from './domain/money.js';
import { normalizePhone } from './domain/phone.js';
import { productLabel } from './domain/copy.js';
import { getSeller, providerFor, publicSeller, resolveSellerInput, setPaymentProvider, type Seller } from './services/sellers.js';

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

  // ---- Payment webhooks: one URL per seller, checked with that seller's own secret ----
  app.post('/webhooks/payments/:sellerId', async (c) => {
    const seller = await getSeller(db, c.req.param('sellerId'));
    if (!seller) return c.text('Unknown seller.', 404);
    const raw = await c.req.text();
    const provider = providerFor(ctx, seller);
    const parsed = provider.parseWebhook(raw, (h) => c.req.header(h));
    if (!parsed.ok) return c.text('Bad signature.', 401);
    if (!parsed.event) return c.json({ ignored: true });
    const event = provider.confirm ? await provider.confirm(parsed.event) : parsed.event;
    if (!event) return c.json({ ignored: true, reason: 'The payment provider did not confirm this payment.' });
    const r = await handlePayment(ctx, event, clock());
    return c.json({ outcome: r.outcome });
  });

  // ---- Payment links customers tap. Checkout is created only now, and only if the offer still stands. ----
  const loadOffer = async (ref: string) =>
    (await db.query<{
      offer_id: string; status: string; expires_at: Date | null; closed_at: Date | null; price_minor: string;
      name: string; variant: string; wa_id: string; contact_name: string | null; seller_id: string;
    }>(
      `select o.id as offer_id, o.status, o.expires_at, r.closed_at, p.price_minor, p.name, p.variant, c.wa_id, c.name as contact_name, p.seller_id
         from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id
         join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
        where o.payment_ref = $1`,
      [baseRef(ref)],
    ))[0];

  app.get('/pay/:ref', async (c) => {
    const o = await loadOffer(c.req.param('ref'));
    if (!o) return c.html(page('en', pageText('en').ended, pageText('en').endedSold), 404);
    const seller = (await getSeller(db, o.seller_id))!;
    const t = pageText(seller.language);
    const now = clock();
    const live = (o.status === 'held' && o.expires_at && o.expires_at > now) || (o.status === 'notified' && !o.closed_at);
    if (!live) {
      const why = o.status === 'paid' ? t.endedPaid : o.status === 'expired' || o.status === 'held' ? t.endedHeld : t.endedSold;
      return c.html(page(seller.language, t.ended, why), 410);
    }
    try {
      const label = productLabel({ name: o.name, variant: o.variant }, seller.language);
      const { url } = await providerFor(ctx, seller).createLink({
        reference: `${c.req.param('ref')}.${now.getTime().toString(36)}`,
        amountMinor: Number(o.price_minor),
        currency: seller.currency,
        description: `${seller.name}: ${label}`,
        waId: o.wa_id,
        name: o.contact_name,
        metadata: { offer_id: o.offer_id, seller_id: seller.id },
      });
      return c.redirect(url, 302);
    } catch (err) {
      console.error(err);
      return c.html(page(seller.language, t.unavailable, t.tryAgain), 503);
    }
  });

  app.get('/paid', (c) => {
    const t = pageText(c.req.query('lang') ?? 'en');
    return c.html(page(c.req.query('lang') ?? 'en', t.thanks, t.thanksBody));
  });

  if (config.dryRun) {
    app.get('/pay/:ref/test', async (c) => {
      const o = await loadOffer(c.req.param('ref'));
      if (!o) return c.notFound();
      const seller = (await getSeller(db, o.seller_id))!;
      const t = pageText(seller.language);
      const label = productLabel({ name: o.name, variant: o.variant }, seller.language);
      const amount = formatMoney(Number(o.price_minor), seller.currency, seller.language, seller.country);
      return c.html(page(seller.language, t.testTitle, `${seller.name} · ${label} · ${amount}. ${t.testBody}`,
        `<form method="post"><button>${escapeHtml(t.testPay)} ${escapeHtml(amount)}</button></form>`));
    });
    app.post('/pay/:ref/test', async (c) => {
      const o = await loadOffer(c.req.param('ref'));
      if (!o) return c.notFound();
      const seller = (await getSeller(db, o.seller_id))!;
      const r = await handlePayment(ctx, { reference: c.req.param('ref'), amountMinor: Number(o.price_minor) }, clock());
      const t = pageText(seller.language);
      return c.html(page(seller.language, r.outcome === 'paid' ? t.testDone : t.ended, r.outcome === 'paid' ? t.thanksBody : t.endedSold));
    });
  }

  // ---- Seller API ----
  const admin = async (c: Context, next: Next) => {
    const allowOpen = config.dryRun && !config.adminToken;
    if (!allowOpen && c.req.header('authorization') !== `Bearer ${config.adminToken}`) {
      return c.json({ error: 'Send the admin token as "Authorization: Bearer <token>".' }, 401);
    }
    await next();
  };
  app.use('/api/*', admin);

  const sellerOr404 = async (id: string) => {
    const s = await getSeller(db, id);
    if (!s) throw new InputError('No shop with that id.');
    return s;
  };

  app.get('/api/markets', (c) =>
    c.json({
      countries: Object.entries(MARKETS).map(([code, m]) => ({ code, ...m, rates: ratesFor(code) })),
      languages: LANGS,
      providers: PROVIDER_INFO,
      rateGroups: RATE_GROUPS,
    }),
  );

  app.get('/api/sellers', async (c) => c.json((await db.query<Seller>('select * from sellers order by created_at')).map(publicSeller)));

  app.post('/api/sellers', async (c) => {
    const b = await c.req.json<{ name: string; waPhoneNumberId: string; country: string; currency?: string; language?: string; timezone?: string }>();
    if (!b.waPhoneNumberId?.trim()) throw new InputError('Add the WhatsApp phone number id from Meta.');
    const v = resolveSellerInput(b);
    const [row] = await db.query<Seller>(
      'insert into sellers (name, wa_phone_number_id, country, currency, language, timezone) values ($1, $2, $3, $4, $5, $6) returning *',
      [v.name, b.waPhoneNumberId.trim(), v.country, v.currency, v.language, v.timezone],
    );
    return c.json(publicSeller(row), 201);
  });

  app.patch('/api/sellers/:id', async (c) => {
    const current = await sellerOr404(c.req.param('id'));
    const v = resolveSellerInput(await c.req.json(), current);
    const [row] = await db.query<Seller>(
      'update sellers set name = $2, country = $3, currency = $4, language = $5, timezone = $6 where id = $1 returning *',
      [current.id, v.name, v.country, v.currency, v.language, v.timezone],
    );
    return c.json(publicSeller(row));
  });

  app.put('/api/sellers/:id/payments', async (c) => {
    const s = await sellerOr404(c.req.param('id'));
    await setPaymentProvider(ctx, s.id, await c.req.json());
    return c.json({ ...publicSeller((await getSeller(db, s.id))!), webhookUrl: `${config.publicUrl.replace(/\/$/, '')}/webhooks/payments/${s.id}` });
  });

  app.post('/api/products', async (c) => {
    const b = await c.req.json<{ sellerId: string; name: string; variant?: string; aliases?: string[]; price: number; stock?: number }>();
    if (!b.sellerId || !b.name?.trim() || !(b.price >= 0)) throw new InputError('sellerId, name and price are required');
    const s = await sellerOr404(b.sellerId);
    const [row] = await db.query(
      'insert into products (seller_id, name, variant, aliases, price_minor, stock) values ($1, $2, $3, $4, $5, $6) returning *',
      [s.id, b.name.trim(), (b.variant ?? '').trim(), b.aliases ?? [], toMinor(b.price, s.currency), b.stock ?? 0],
    );
    return c.json(row, 201);
  });

  app.get('/api/products', async (c) => {
    const rows = await db.query(
      `select p.*, (select count(*)::int from interests i join consents k on k.id = i.consent_id and k.revoked_at is null
                     where i.product_id = p.id and i.status = 'waiting') as waiting
         from products p where ($1::uuid is null or p.seller_id = $1) order by waiting desc, p.name, p.variant`,
      [c.req.query('sellerId') ?? null],
    );
    return c.json(rows);
  });

  app.get('/api/products/:id', async (c) => {
    const [product] = await db.query(
      `select p.*, (select count(*)::int from interests i join consents k on k.id = i.consent_id and k.revoked_at is null
                     where i.product_id = p.id and i.status = 'waiting') as waiting
         from products p where p.id = $1`,
      [c.req.param('id')],
    );
    if (!product) return c.json({ error: 'No product with that id.' }, 404);
    const restocks = await db.query(
      `select r.*, count(o.*) filter (where o.status = 'paid')::int as sold, count(o.*)::int as messaged
         from restocks r left join offers o on o.restock_id = r.id
        where r.product_id = $1 group by r.id order by r.created_at desc limit 10`,
      [c.req.param('id')],
    );
    return c.json({ product, restocks });
  });

  app.patch('/api/products/:id', async (c) => {
    const b = await c.req.json<{ stock?: number; price?: number; aliases?: string[]; name?: string; variant?: string }>();
    if (b.stock !== undefined && !(Number.isInteger(b.stock) && b.stock >= 0)) throw new InputError('stock must be a whole number, 0 or more');
    if (b.price !== undefined && !(b.price >= 0)) throw new InputError('price must be 0 or more');
    const [owner] = await db.query<{ currency: string }>(
      'select s.currency from products p join sellers s on s.id = p.seller_id where p.id = $1',
      [c.req.param('id')],
    );
    if (!owner) return c.json({ error: 'No product with that id.' }, 404);
    const [row] = await db.query(
      `update products set stock = coalesce($2, stock), price_minor = coalesce($3, price_minor), aliases = coalesce($4, aliases),
              name = coalesce($5, name), variant = coalesce($6, variant)
        where id = $1 returning *`,
      [c.req.param('id'), b.stock ?? null, b.price === undefined ? null : toMinor(b.price, owner.currency), b.aliases ?? null, b.name ?? null, b.variant ?? null],
    );
    return c.json(row);
  });

  app.get('/api/products/:id/waitlist', async (c) => {
    const rows = await db.query(
      `select row_number() over (order by i.created_at, i.seq)::int as position, c.name, c.wa_id, i.created_at as joined_at, k.quote as consent_quote
         from interests i join contacts c on c.id = i.contact_id join consents k on k.id = i.consent_id
        where i.product_id = $1 and i.status = 'waiting' and k.revoked_at is null
        order by i.created_at, i.seq`,
      [c.req.param('id')],
    );
    return c.json(rows);
  });

  app.post('/api/products/:id/restocks/preview', async (c) => {
    const b = await c.req.json<{ units: number; mode: 'hold' | 'race'; holdMinutes?: number; perUnit?: number }>();
    return c.json(await previewRestock(ctx, { productId: c.req.param('id'), ...b }, clock()));
  });

  app.post('/api/products/:id/restocks', async (c) => {
    const b = await c.req.json<{ units: number; mode: 'hold' | 'race'; holdMinutes?: number; perUnit?: number }>();
    return c.json(await startRestock(ctx, { productId: c.req.param('id'), ...b }, clock()), 201);
  });

  app.get('/api/restocks/:id', async (c) => {
    const [restock] = await db.query('select * from restocks where id = $1', [c.req.param('id')]);
    if (!restock) return c.json({ error: 'No restock with that id.' }, 404);
    const offers = await db.query(
      `select o.status, o.sent_at, o.expires_at, o.paid_at, o.refund_due, o.payment_url, o.payment_ref, c.name, c.wa_id
         from offers o join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
        where o.restock_id = $1 order by o.sent_at, i.created_at, i.seq`,
      [c.req.param('id')],
    );
    return c.json({ restock, offers });
  });

  app.get('/api/chats', async (c) => {
    const now = clock();
    const rows = await db.query<{ last_inbound_at: Date | null }>(
      `select c.id, c.name, c.wa_id, c.channel, c.last_inbound_at, m.body as last_body, m.direction as last_direction, m.created_at as last_at,
              (select count(*)::int from messages x where x.contact_id = c.id and x.direction = 'in'
                 and x.created_at > coalesce(c.seller_read_at, 'epoch'::timestamptz)) as unread,
              coalesce((select array_agg(trim(p.name || ' ' || p.variant) order by i.created_at, i.seq)
                          from interests i join products p on p.id = i.product_id
                         where i.contact_id = c.id and i.status = 'waiting'), '{}') as waiting_for,
              (c.awaiting_consent_product_id is not null) as awaiting_consent
         from contacts c
         left join lateral (select body, direction, created_at from messages where contact_id = c.id order by created_at desc, seq desc limit 1) m on true
        where ($1::uuid is null or c.seller_id = $1)
        order by m.created_at desc nulls last`,
      [c.req.query('sellerId') ?? null],
    );
    return c.json(rows.map((r) => ({ ...r, window_open: whatsappWindowOpen(r.last_inbound_at, now) })));
  });

  app.get('/api/chats/:id', async (c) => {
    const [contact] = await db.query<{ last_inbound_at: Date | null }>('select * from contacts where id = $1', [c.req.param('id')]);
    if (!contact) return c.json({ error: 'No chat with that id.' }, 404);
    const messages = await db.query(
      'select direction, kind, template, category, body, cost_usd_micros, created_at from messages where contact_id = $1 order by created_at, seq',
      [c.req.param('id')],
    );
    const waitingFor = await db.query(
      `select p.id, p.name, p.variant, i.created_at,
              (select count(*)::int from interests o where o.product_id = i.product_id and o.status = 'waiting'
                 and (o.created_at, o.seq) <= (i.created_at, i.seq)) as position
         from interests i join products p on p.id = i.product_id where i.contact_id = $1 and i.status = 'waiting'`,
      [c.req.param('id')],
    );
    const consents = await db.query('select purpose, quote, granted_at, revoked_at from consents where contact_id = $1 order by granted_at desc', [c.req.param('id')]);
    await db.query('update contacts set seller_read_at = $2 where id = $1', [c.req.param('id'), clock()]);
    return c.json({ contact: { ...contact, window_open: whatsappWindowOpen(contact.last_inbound_at, clock()) }, messages, waitingFor, consents });
  });

  app.post('/api/chats/:id/reply', async (c) => {
    const { body } = await c.req.json<{ body: string }>();
    if (!body?.trim()) throw new InputError('Type a message first.');
    if (body.length > 4096) throw new InputError('WhatsApp messages can be at most 4096 characters.');
    const [row] = await db.query<{ id: string; seller_id: string; wa_id: string; last_inbound_at: Date | null; wa_phone_number_id: string; country: string; language: string }>(
      'select c.*, s.wa_phone_number_id, s.country, s.language from contacts c join sellers s on s.id = c.seller_id where c.id = $1',
      [c.req.param('id')],
    );
    if (!row) return c.json({ error: 'No chat with that id.' }, 404);
    const now = clock();
    if (!whatsappWindowOpen(row.last_inbound_at, now)) {
      return c.json({ error: "It's been more than 24 hours since they last messaged, so WhatsApp only allows approved templates. Wait for them to message you." }, 409);
    }
    const [r] = await dispatch(ctx, [{
      kind: 'text', body: body.trim(), sellerId: row.seller_id, from: row.wa_phone_number_id, contactId: row.id, to: row.wa_id,
      lastInboundAt: row.last_inbound_at, country: row.country, language: row.language,
    }], now);
    if (r.status !== 'sent') return c.json({ error: `WhatsApp didn't accept the message: ${r.error ?? r.status}` }, 502);
    await db.query('update contacts set seller_read_at = $2 where id = $1', [row.id, now]);
    return c.json(r, 201);
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

  app.get('/api/insights', async (c) => {
    const sellerId = c.req.query('sellerId') ?? null;
    const monthStart = new Date(clock());
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [sales] = await db.query(
      `select count(*)::int as orders, coalesce(sum(p.price_minor), 0)::bigint as revenue_minor
         from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id
        where o.status = 'paid' and o.paid_at >= $2 and ($1::uuid is null or p.seller_id = $1)`,
      [sellerId, monthStart],
    );
    const [spend] = await db.query(
      `select count(*)::int as messages, coalesce(sum(cost_usd_micros), 0)::bigint as cost_usd_micros
         from messages where direction = 'out' and created_at >= $2 and ($1::uuid is null or seller_id = $1)`,
      [sellerId, monthStart],
    );
    const demand = await db.query(
      `select p.id, p.name, p.variant, p.stock,
              (select count(*)::int from interests i join consents k on k.id = i.consent_id and k.revoked_at is null
                where i.product_id = p.id and i.status = 'waiting') as waiting,
              (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where o.status = 'paid') / count(*))::int end
                 from offers o join restocks r on r.id = o.restock_id where r.product_id = p.id) as bought_pct
         from products p where ($1::uuid is null or p.seller_id = $1) order by waiting desc, p.name`,
      [sellerId],
    );
    const refunds = await db.query(
      `select c.name, c.wa_id, p.name as product, p.variant, p.price_minor, o.payment_ref
         from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id
         join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
        where o.refund_due and ($1::uuid is null or p.seller_id = $1)`,
      [sellerId],
    );
    const num = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
    return c.json({ monthStart, sales: num(sales), spend: num(spend), demand, refunds });
  });

  app.post('/api/tick', async (c) => c.json({ sent: (await tick(ctx, clock())).length }));

  // ---- Test mode helpers: pretend to be a customer, or pretend a customer paid ----
  if (config.dryRun) {
    app.post('/dev/inbound', async (c) => {
      const b = await c.req.json<{ sellerId: string; from: string; name?: string; text: string }>();
      const seller = await getSeller(db, b.sellerId);
      if (!seller) return c.json({ error: 'No seller with that id.' }, 404);
      if (!b.from || !b.text) throw new InputError('from and text are required');
      const from = normalizePhone(b.from, seller.country);
      if (!from) throw new InputError(`That doesn't look like a valid phone number for ${seller.country}.`);
      const r = await handleInbound(ctx, { phoneNumberId: seller.wa_phone_number_id, from, name: b.name, text: b.text, providerId: `dev-${Date.now()}`, at: clock() });
      return c.json({ action: r.action });
    });

    app.post('/dev/pay/:ref', async (c) => {
      const [o] = await db.query<{ price_minor: string }>(
        `select p.price_minor from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id where o.payment_ref = $1`,
        [c.req.param('ref')],
      );
      if (!o) return c.json({ error: 'No offer with that payment reference.' }, 404);
      const r = await handlePayment(ctx, { reference: c.req.param('ref'), amountMinor: Number(o.price_minor) }, clock());
      return c.json({ outcome: r.outcome });
    });
  }

  // ---- Seller web app ----
  const webRoot = relative(process.cwd(), fileURLToPath(new URL('../web', import.meta.url))) || '.';
  app.get('/', (c) => c.redirect('/app/'));
  app.get('/app', (c) => c.redirect('/app/'));
  app.use('/app/*', serveStatic({ root: webRoot, rewriteRequestPath: (p) => p.replace(/^\/app/, '') }));
  app.get('/app/*', serveStatic({ path: `${webRoot}/index.html` }));

  return app;
}
