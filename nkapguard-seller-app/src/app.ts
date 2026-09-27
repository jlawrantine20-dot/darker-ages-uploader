import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { parseWebhook, verifyMetaSignature } from './channels/whatsapp.js';
import { LANGS, MARKETS, RATE_GROUPS, ratesFor } from './domain/markets.js';
import { toMajor, toMinor } from './domain/money.js';
import { whatsappWindowOpen } from './domain/windows.js';
import { PROVIDER_INFO } from './payments/providers.js';
import type { Ctx } from './services/context.js';
import { InputError } from './services/errors.js';
import { handleInbound } from './services/inbound.js';
import { dispatch } from './services/outbound.js';
import { baseRef, handlePayment, previewRestock, startRestock, tick } from './services/restock.js';
import { escapeHtml, page, pageText } from './pages.js';
import { normalizePhone, phoneCountry } from './domain/phone.js';
import { productLabel } from './domain/copy.js';
import { AuthError, ForbiddenError, addMember, logout, removeMember, requireRole, shopOf, startLogin, verifyLogin, viewerFor, type Role, type Viewer } from './services/auth.js';
import { getSeller, money, providerFor, publicSeller, resolveSellerInput, setPaymentProvider, uniqueSlug, type Seller, type SellerInput } from './services/sellers.js';

export interface AppOptions {
  /** Serves the seller app's files under /app when the API and the app share one host (the Node server). */
  webFiles?: { assets: MiddlewareHandler; index: MiddlewareHandler };
}

export function createApp(ctx: Ctx, clock: () => Date = () => new Date(), opts: AppOptions = {}) {
  const app = new Hono<{ Variables: { viewer: Viewer } }>();
  const { config, db } = ctx;

  app.onError((err, c) => {
    if (err instanceof InputError) return c.json({ error: err.message }, 400);
    if (err instanceof AuthError) return c.json({ error: err.message }, err.message.startsWith('Too many') ? 429 : 400);
    if (err instanceof ForbiddenError) return c.json({ error: err.message === 'Not found.' ? 'Not found.' : err.message }, err.message === 'Not found.' ? 404 : 403);
    console.error(err);
    return c.json({ error: 'Something went wrong on our side.' }, 500);
  });

  // The seller app may live on a different host from the API, so allow it to call in.
  app.use('*', cors({ origin: config.allowedOrigins.includes('*') ? '*' : config.allowedOrigins, allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }));

  app.get('/health', (c) => c.json({ ok: true, dryRun: config.dryRun }));

  /**
   * Show a customer a short page. When the seller app is hosted elsewhere (APP_URL), the page
   * is drawn there, because some API hosts (Supabase) refuse to serve HTML.
   */
  const customerPage = (c: Context, lang: string, title: string, body: string, status: 200 | 404 | 410 | 503 = 200, test?: { ref: string; pay: string }) => {
    if (config.appUrl) {
      const data = encodeURIComponent(JSON.stringify({ lang, title, body, status, test }));
      return c.redirect(`${config.appUrl.replace(/\/$/, '')}/pay.html#${data}`, 302);
    }
    const extra = test ? `<form method="post"><button>${escapeHtml(test.pay)}</button></form>` : '';
    return c.html(page(lang, title, body, extra), status);
  };

  /** Country defaults, languages and payment providers. Public: the sign-in screen needs the country list. */
  const marketsBody = () => ({
    countries: Object.entries(MARKETS).map(([code, m]) => ({ code, ...m, rates: ratesFor(code) })),
    languages: LANGS,
    providers: PROVIDER_INFO,
    rateGroups: RATE_GROUPS,
  });

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
    // Check Meta's signature whenever the app secret is set, test mode included, so a public
    // URL never accepts made-up messages. Without a secret (local test mode) it is skipped.
    const mustVerify = !config.dryRun || Boolean(config.whatsapp.appSecret);
    if (mustVerify && !verifyMetaSignature(raw, c.req.header('x-hub-signature-256'), config.whatsapp.appSecret)) {
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
      name: string; variant: string; wa_id: string; contact_name: string | null; seller_id: string; language: 'en' | 'fr' | null;
    }>(
      `select o.id as offer_id, o.status, o.expires_at, r.closed_at, p.price_minor, p.name, p.variant, c.wa_id, c.name as contact_name, p.seller_id, c.language
         from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id
         join interests i on i.id = o.interest_id join contacts c on c.id = i.contact_id
        where o.payment_ref = $1`,
      [baseRef(ref)],
    ))[0];

  app.get('/pay/:ref', async (c) => {
    const o = await loadOffer(c.req.param('ref'));
    if (!o) return customerPage(c, 'en', pageText('en').ended, pageText('en').endedSold, 404);
    const seller = (await getSeller(db, o.seller_id))!;
    // The customer's own language when known, as in chat.
    const lang = o.language ?? seller.language;
    const t = pageText(lang);
    const now = clock();
    const live = (o.status === 'held' && o.expires_at && o.expires_at > now) || (o.status === 'notified' && !o.closed_at);
    if (!live) {
      const why = o.status === 'paid' ? t.endedPaid : o.status === 'expired' || o.status === 'held' ? t.endedHeld : t.endedSold;
      return customerPage(c, lang, t.ended, why, 410);
    }
    try {
      const label = productLabel({ name: o.name, variant: o.variant }, lang);
      const { url } = await providerFor(ctx, seller).createLink({
        reference: `${c.req.param('ref')}.${now.getTime().toString(36)}`,
        amountMinor: Number(o.price_minor),
        currency: seller.currency,
        description: `${seller.name}: ${label}`,
        waId: o.wa_id,
        name: o.contact_name,
        metadata: { offer_id: o.offer_id, seller_id: seller.id },
        language: lang,
      });
      return c.redirect(url, 302);
    } catch (err) {
      console.error(err);
      return customerPage(c, lang, t.unavailable, t.tryAgain, 503);
    }
  });

  // Public shop page data: what the shop sells and whether it's available. No stock counts,
  // no customer data, nothing that needs a sign-in.
  app.get('/shop/:slug', async (c) => {
    const [seller] = await db.query<Seller>('select * from sellers where slug = $1', [c.req.param('slug').toLowerCase()]);
    if (!seller) return c.json({ error: 'No shop with that link.' }, 404);
    const products = await db.query<{ name: string; variant: string; price_minor: number; free: number }>(
      `select p.name, p.variant, p.price_minor,
              p.stock - coalesce((select count(*)::int from offers o join restocks r on r.id = o.restock_id
                                   where r.product_id = p.id and o.status = 'held'), 0) as free
         from products p where p.seller_id = $1 order by p.name, p.variant`,
      [seller.id],
    );
    return c.json({
      name: seller.name,
      country: seller.country,
      currency: seller.currency,
      language: seller.language,
      whatsapp: seller.wa_display_phone,
      products: products.map((p) => ({ name: p.name, variant: p.variant, priceMinor: Number(p.price_minor), available: Number(p.free) > 0 })),
    });
  });

  app.get('/paid', (c) => {
    const t = pageText(c.req.query('lang') ?? 'en');
    return customerPage(c, c.req.query('lang') ?? 'en', t.thanks, t.thanksBody);
  });

  if (config.dryRun) {
    app.get('/pay/:ref/test', async (c) => {
      const o = await loadOffer(c.req.param('ref'));
      if (!o) return c.notFound();
      const seller = (await getSeller(db, o.seller_id))!;
      const lang = o.language ?? seller.language;
      const t = pageText(lang);
      const label = productLabel({ name: o.name, variant: o.variant }, lang);
      const amount = money(seller, Number(o.price_minor));
      return customerPage(c, lang, t.testTitle, `${seller.name} · ${label} · ${amount}. ${t.testBody}`, 200, { ref: c.req.param('ref'), pay: `${t.testPay} ${amount}` });
    });
    app.post('/pay/:ref/test', async (c) => {
      const o = await loadOffer(c.req.param('ref'));
      if (!o) return c.notFound();
      const seller = (await getSeller(db, o.seller_id))!;
      const r = await handlePayment(ctx, { reference: c.req.param('ref'), amountMinor: Number(o.price_minor) }, clock());
      const t = pageText(seller.language);
      const title = r.outcome === 'paid' ? t.testDone : t.ended;
      const body = r.outcome === 'paid' ? t.thanksBody : t.endedSold;
      // The hosted seller app posts here with fetch and draws the result itself.
      if (c.req.header('accept')?.includes('application/json')) return c.json({ title, body });
      return c.html(page(seller.language, title, body));
    });
  }

  // ---- Sign in with a WhatsApp number and a one-time code ----
  app.post('/auth/start', async (c) => {
    const b = await c.req.json<{ phone: string; country: string }>();
    const r = await startLogin(ctx, b.phone, b.country, clock());
    return c.json({ sent: true, ...(r.devCode ? { devCode: r.devCode } : {}) });
  });
  app.post('/auth/verify', async (c) => {
    const b = await c.req.json<{ phone: string; country: string; code: string }>();
    const { token, user } = await verifyLogin(ctx, b.phone, b.country, b.code, clock());
    return c.json({ token, user });
  });
  app.post('/auth/logout', async (c) => {
    await logout(ctx, c.req.header('authorization'), clock());
    return c.json({ ok: true });
  });

  // ---- Seller API: signed-in sellers see only their own shops; the admin token sees all ----
  const resolveViewer = async (c: Context<{ Variables: { viewer: Viewer } }>, next: Next) => {
    const header = c.req.header('authorization');
    let viewer = await viewerFor(ctx, header, clock());
    // Test mode with no admin token configured stays open to callers that send no credentials.
    if (!viewer && !header && config.openTestMode && !config.adminToken) viewer = { kind: 'admin' };
    if (!viewer) return c.json({ error: 'Sign in again.' }, 401);
    c.set('viewer', viewer);
    await next();
  };
  app.use('/api/*', resolveViewer);
  // Test-mode helpers exist only in test mode; on a live server /dev/* is simply not found.
  if (config.dryRun) app.use('/dev/*', resolveViewer);

  type C = Context<{ Variables: { viewer: Viewer } }>;
  const guard = (c: C, sellerId: string | null | undefined, need: Role = 'staff') => requireRole(db, c.get('viewer'), sellerId, need);
  const guardOf = async (c: C, kind: 'product' | 'restock' | 'chat', id: string, need: Role = 'staff') => guard(c, await shopOf(db, kind, id), need);
  /** The ?sellerId of a list request, checked. The admin may leave it out to see everything. */
  const scoped = async (c: C) => {
    const id = c.req.query('sellerId') || null;
    if (c.get('viewer').kind === 'admin' && !id) return null;
    if (!id) throw new InputError('sellerId is required');
    await guard(c, id);
    return id;
  };

  const sellerOr404 = async (id: string) => {
    const s = await getSeller(db, id);
    if (!s) throw new InputError('No shop with that id.');
    return s;
  };

  app.get('/api/me', async (c) => {
    const v = c.get('viewer');
    if (v.kind === 'admin') return c.json({ admin: true, user: null });
    const [user] = await db.query<{ wa_id: string }>('select id, wa_id, name from users where id = $1', [v.userId]);
    // The country of their phone number is the best default for a new shop.
    return c.json({ admin: false, user: { ...user, country: phoneCountry(user.wa_id) } });
  });

  app.get('/api/sellers/:id/members', async (c) => {
    await guard(c, c.req.param('id'));
    return c.json(await db.query(
      `select u.id as user_id, u.wa_id, u.name, m.role, m.created_at from shop_members m join users u on u.id = m.user_id
        where m.seller_id = $1 order by m.role, m.created_at`,
      [c.req.param('id')],
    ));
  });

  app.post('/api/sellers/:id/members', async (c) => {
    await guard(c, c.req.param('id'), 'owner');
    const s = await sellerOr404(c.req.param('id'));
    const b = await c.req.json<{ phone: string; role: Role }>();
    return c.json(await addMember(db, s.id, b.phone, s.country, b.role ?? 'staff'), 201);
  });

  app.delete('/api/sellers/:id/members/:userId', async (c) => {
    await guard(c, c.req.param('id'), 'owner');
    await removeMember(db, c.req.param('id'), c.req.param('userId'));
    return c.json({ ok: true });
  });

  app.get('/markets', (c) => c.json(marketsBody()));
  app.get('/api/markets', (c) => c.json(marketsBody()));


  app.get('/api/sellers', async (c) => {
    const v = c.get('viewer');
    const rows = v.kind === 'admin'
      ? await db.query<Seller & { role: string }>(`select *, 'owner' as role from sellers order by created_at`)
      : await db.query<Seller & { role: string }>(
          'select s.*, m.role from sellers s join shop_members m on m.seller_id = s.id where m.user_id = $1 order by s.created_at',
          [v.userId],
        );
    return c.json(rows.map((r) => ({ ...publicSeller(r), role: r.role })));
  });

  app.post('/api/sellers', async (c) => {
    const b = await c.req.json<{ name: string; waPhoneNumberId: string; country: string; currency?: string; language?: string; timezone?: string }>();
    if (!b.waPhoneNumberId?.trim()) throw new InputError('Add the WhatsApp phone number id from Meta.');
    const v = resolveSellerInput(b);
    const viewer = c.get('viewer');
    const row = await db.tx(async (q) => {
      const [s] = await q.query<Seller>(
        `insert into sellers (name, wa_phone_number_id, country, currency, language, timezone, slug, wa_display_phone)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [v.name, b.waPhoneNumberId.trim(), v.country, v.currency, v.language, v.timezone, v.slug ?? (await uniqueSlug(q, v.name)), v.waDisplayPhone],
      );
      // Whoever creates a shop owns it.
      if (viewer.kind === 'user') await q.query(`insert into shop_members (seller_id, user_id, role) values ($1, $2, 'owner')`, [s.id, viewer.userId]);
      return s;
    });
    return c.json({ ...publicSeller(row), role: 'owner' }, 201);
  });

  app.patch('/api/sellers/:id', async (c) => {
    await guard(c, c.req.param('id'), 'owner');
    const current = await sellerOr404(c.req.param('id'));
    const b = await c.req.json<SellerInput & { rate?: number }>();
    const v = resolveSellerInput(b, current);
    const row = await db.tx(async (q) => {
      // Prices are stored in the currency's smallest unit, so a new currency needs the
      // prices converted too, or $25 (2500 cents) would turn into 2,500 FCFA.
      if (v.currency !== current.currency) {
        const [{ n }] = await q.query<{ n: number }>('select count(*)::int as n from products where seller_id = $1', [current.id]);
        const rate = Number(b.rate);
        if (n > 0 && !(rate > 0)) throw new InputError(`Enter how many ${v.currency} make 1 ${current.currency}, so your prices can be converted.`);
        if (n > 0) {
          const products = await q.query<{ id: string; price_minor: number }>('select id, price_minor from products where seller_id = $1', [current.id]);
          for (const p of products) {
            await q.query('update products set price_minor = $2 where id = $1', [p.id, toMinor(toMajor(p.price_minor, current.currency) * rate, v.currency)]);
          }
        }
      }
      if (v.slug && v.slug !== current.slug) {
        const [taken] = await q.query('select 1 from sellers where slug = $1 and id <> $2', [v.slug, current.id]);
        if (taken) throw new InputError(`The link "${v.slug}" is taken. Try another.`);
      }
      const [s] = await q.query<Seller>(
        `update sellers set name = $2, country = $3, currency = $4, language = $5, timezone = $6, slug = $7, wa_display_phone = $8
          where id = $1 returning *`,
        [current.id, v.name, v.country, v.currency, v.language, v.timezone, v.slug ?? (await uniqueSlug(q, v.name)), v.waDisplayPhone],
      );
      return s;
    });
    return c.json(publicSeller(row));
  });

  app.put('/api/sellers/:id/payments', async (c) => {
    await guard(c, c.req.param('id'), 'owner');
    const s = await sellerOr404(c.req.param('id'));
    await setPaymentProvider(ctx, s.id, await c.req.json());
    return c.json({ ...publicSeller((await getSeller(db, s.id))!), webhookUrl: `${config.publicUrl.replace(/\/$/, '')}/webhooks/payments/${s.id}` });
  });

  app.post('/api/products', async (c) => {
    const b = await c.req.json<{ sellerId: string; name: string; variant?: string; aliases?: string[]; price: number; stock?: number }>();
    if (!b.sellerId || !b.name?.trim() || !(b.price >= 0)) throw new InputError('sellerId, name and price are required');
    await guard(c, b.sellerId);
    const s = await sellerOr404(b.sellerId);
    const [row] = await db.query(
      'insert into products (seller_id, name, variant, aliases, price_minor, stock) values ($1, $2, $3, $4, $5, $6) returning *',
      [s.id, b.name.trim(), (b.variant ?? '').trim(), b.aliases ?? [], toMinor(b.price, s.currency), b.stock ?? 0],
    );
    return c.json(row, 201);
  });

  app.get('/api/products', async (c) => {
    const sellerId = await scoped(c);
    const rows = await db.query(
      `select p.*, (select count(*)::int from interests i join consents k on k.id = i.consent_id and k.revoked_at is null
                     where i.product_id = p.id and i.status = 'waiting') as waiting
         from products p where ($1::uuid is null or p.seller_id = $1) order by waiting desc, p.name, p.variant`,
      [sellerId],
    );
    return c.json(rows);
  });

  app.get('/api/products/:id', async (c) => {
    await guardOf(c, 'product', c.req.param('id'));
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
    await guardOf(c, 'product', c.req.param('id'));
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
    await guardOf(c, 'product', c.req.param('id'));
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
    await guardOf(c, 'product', c.req.param('id'));
    const b = await c.req.json<{ units: number; mode: 'hold' | 'race'; holdMinutes?: number; perUnit?: number }>();
    return c.json(await previewRestock(ctx, { productId: c.req.param('id'), ...b }, clock()));
  });

  app.post('/api/products/:id/restocks', async (c) => {
    await guardOf(c, 'product', c.req.param('id'));
    const b = await c.req.json<{ units: number; mode: 'hold' | 'race'; holdMinutes?: number; perUnit?: number }>();
    return c.json(await startRestock(ctx, { productId: c.req.param('id'), ...b }, clock()), 201);
  });

  app.get('/api/restocks/:id', async (c) => {
    await guardOf(c, 'restock', c.req.param('id'));
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
    const sellerId = await scoped(c);
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
      [sellerId],
    );
    return c.json(rows.map((r) => ({ ...r, window_open: whatsappWindowOpen(r.last_inbound_at, now) })));
  });

  app.get('/api/chats/:id', async (c) => {
    await guardOf(c, 'chat', c.req.param('id'));
    const [contact] = await db.query<{ last_inbound_at: Date | null }>('select * from contacts where id = $1', [c.req.param('id')]);
    if (!contact) return c.json({ error: 'No chat with that id.' }, 404);
    const messages = await db.query(
      'select direction, kind, template, category, body, cost_usd_micros, error, created_at from messages where contact_id = $1 order by created_at, seq',
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
    await guardOf(c, 'chat', c.req.param('id'));
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
    const sellerId = await scoped(c);
    const rows = await db.query(
      `select k.purpose, k.channel, k.quote, k.granted_at, k.revoked_at, c.name, c.wa_id, p.name as product, p.variant
         from consents k join contacts c on c.id = k.contact_id left join products p on p.id = k.product_id
        where ($1::uuid is null or k.seller_id = $1) order by k.granted_at desc`,
      [sellerId],
    );
    return c.json(rows);
  });

  app.get('/api/insights', async (c) => {
    const sellerId = await scoped(c);
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
         from messages where direction = 'out' and error is null and created_at >= $2 and ($1::uuid is null or seller_id = $1)`,
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

  // For a scheduler (Supabase pg_cron): a secret that can only pass expired holds down the
  // line, so the scheduler never holds the operator's admin token.
  app.post('/cron/tick', async (c) => {
    const given = Buffer.from(c.req.header('x-cron-secret') ?? '');
    const secret = Buffer.from(config.cronSecret);
    if (!secret.length || given.length !== secret.length || !timingSafeEqual(given, secret)) return c.json({ error: 'Not allowed.' }, 403);
    return c.json({ sent: (await tick(ctx, clock())).length });
  });

  app.post('/api/tick', async (c) => {
    if (c.get('viewer').kind !== 'admin' && !config.dryRun) return c.json({ error: 'Only the operator can run this.' }, 403);
    return c.json({ sent: (await tick(ctx, clock())).length });
  });

  // ---- Test mode helpers: pretend to be a customer, or pretend a customer paid ----
  if (config.dryRun) {
    app.post('/dev/inbound', async (c) => {
      const b = await c.req.json<{ sellerId: string; from: string; name?: string; text: string }>();
      await guard(c, b.sellerId);
      const seller = (await getSeller(db, b.sellerId))!;
      if (!b.from || !b.text) throw new InputError('from and text are required');
      const from = normalizePhone(b.from, seller.country);
      if (!from) throw new InputError(`That doesn't look like a valid phone number for ${seller.country}.`);
      const r = await handleInbound(ctx, { phoneNumberId: seller.wa_phone_number_id, from, name: b.name, text: b.text, providerId: `dev-${Date.now()}`, at: clock() });
      return c.json({ action: r.action });
    });

    app.post('/dev/pay/:ref', async (c) => {
      const [o] = await db.query<{ price_minor: string; seller_id: string }>(
        `select p.price_minor, p.seller_id from offers o join restocks r on r.id = o.restock_id join products p on p.id = r.product_id where o.payment_ref = $1`,
        [c.req.param('ref')],
      );
      if (!o) return c.json({ error: 'No offer with that payment reference.' }, 404);
      await guard(c, o.seller_id);
      const r = await handlePayment(ctx, { reference: c.req.param('ref'), amountMinor: Number(o.price_minor) }, clock());
      return c.json({ outcome: r.outcome });
    });
  }

  // ---- Seller web app, when served from the same host ----
  if (opts.webFiles) {
    app.get('/', (c) => c.redirect('/app/'));
    app.get('/app', (c) => c.redirect('/app/'));
    app.use('/app/*', opts.webFiles.assets);
    app.get('/app/*', opts.webFiles.index);
  }

  return app;
}
