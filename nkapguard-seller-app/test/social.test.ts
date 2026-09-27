import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DryRunSocial, parseMetaWebhook, type SocialInbound } from '../src/channels/meta.js';
import { encryptSecret } from '../src/crypto.js';
import { handleInbound, handleSocialInbound } from '../src/services/inbound.js';
import { T0, at, inbound, setup } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
let social: DryRunSocial;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

/** A bilingual Cameroon shop with a public WhatsApp number and connected Instagram and Messenger accounts. */
async function shop() {
  env = await setup({ language: 'fr+en' });
  social = new DryRunSocial();
  env.ctx.social = social;
  await env.db.query(`update sellers set slug = 'douala-hair', wa_display_phone = '237677000000' where id = $1`, [env.sellerId]);
  const connect = async (channel: 'instagram' | 'facebook', externalId: string) =>
    (await env.db.query<{ id: string }>(
      `insert into channel_accounts (seller_id, channel, external_id, name, token_enc) values ($1, $2, $3, $4, $5) returning id`,
      [env.sellerId, channel, externalId, channel === 'instagram' ? 'doualahair' : 'Douala Hair', encryptSecret(`token-${channel}`, env.ctx.config.appSecret)],
    ))[0].id;
  return { ig: await connect('instagram', 'ig-123'), fb: await connect('facebook', 'page-456') };
}

const dm = (channel: 'instagram' | 'facebook', from: string, text: string, when = T0): SocialInbound => ({
  channel, accountId: channel === 'instagram' ? 'ig-123' : 'page-456', from, text, providerId: `mid-${Math.random()}`, at: when,
});

describe('Instagram and Messenger DMs', () => {
  it('answers in the customer language and moves restock alerts to WhatsApp', async () => {
    await shop();
    const r = await handleSocialInbound(env.ctx, dm('instagram', 'igsid-1', 'Bonjour, vous avez le claw clip ponytail brown ?'));
    expect(r.action).toBe('offered');
    const [sent] = social.sent;
    expect(sent).toMatchObject({ channel: 'instagram', account: 'ig-123', to: { userId: 'igsid-1' } });
    expect(sent.text).toMatch(/^Bonjour cher client ! Le modèle 12" Claw Clip Ponytail brown est momentanément en rupture de stock\. Nos alertes de retour passent par WhatsApp/);
    const link = sent.text.match(/https:\/\/wa\.me\/237677000000\?text=\S+/)![0];
    const prefilled = decodeURIComponent(link.split('?text=')[1]);
    expect(prefilled).toBe(`Bonjour, prévenez-moi quand le modèle 12" Claw Clip Ponytail brown revient, s'il vous plaît.`);

    // The customer sends that message on WhatsApp: they join the waitlist in one step, and
    // their own words are the consent record.
    const wa = await handleInbound(env.ctx, inbound('237677555111', prefilled, at(2), 'Nadège'));
    expect(wa.action).toBe('joined');
    expect(env.channel.sent.at(-1)?.body).toMatch(/^C'est noté ! Vous êtes n°1 /);
    const [consent] = await env.db.query<{ quote: string; channel: string }>('select quote, channel from consents');
    expect(consent).toEqual({ quote: prefilled, channel: 'whatsapp' });

    // Instagram and WhatsApp are separate chats, each on its own channel.
    const chats = await env.db.query<{ channel: string; wa_id: string }>('select channel, wa_id from contacts order by created_at');
    expect(chats).toEqual([{ channel: 'instagram', wa_id: 'igsid-1' }, { channel: 'whatsapp', wa_id: '237677555111' }]);
  });

  it('gives the price on Messenger, in English for an English message', async () => {
    await shop();
    const r = await handleSocialInbound(env.ctx, dm('facebook', 'psid-9', 'Hi, do you have the jet black claw clip ponytail?'));
    expect(r.action).toBe('in_stock');
    expect(social.sent[0]).toMatchObject({ channel: 'facebook', account: 'page-456', to: { userId: 'psid-9' } });
    expect(social.sent[0].text).toMatch(/^Hi there, yes, we have the jet black 12" Claw Clip Ponytail in stock at FCFA 15,000\./);
    const [msg] = await env.db.query<{ channel: string; direction: string; cost_usd_micros: number }>(`select channel, direction, cost_usd_micros from messages where direction = 'out'`);
    expect(msg).toEqual({ channel: 'facebook', direction: 'out', cost_usd_micros: 0 });
  });

  it('says sold out without a link when the shop has no public WhatsApp number', async () => {
    await shop();
    await env.db.query('update sellers set wa_display_phone = null');
    const r = await handleSocialInbound(env.ctx, dm('instagram', 'igsid-2', 'is the wine satin bonnet available?'));
    expect(r.action).toBe('sold_out');
    expect(social.sent[0].text).toBe('Hi there, the wine Satin Bonnet is sold out at the moment.');
  });

  it('stays silent for a paused channel and for accounts no shop connected', async () => {
    const { ig } = await shop();
    await env.db.query('update channel_accounts set enabled = false where id = $1', [ig]);
    expect((await handleSocialInbound(env.ctx, dm('instagram', 'igsid-3', 'vous avez le bonnet ?'))).action).toBe('ignored');
    expect((await handleSocialInbound(env.ctx, { ...dm('instagram', 'igsid-3', 'hello?'), accountId: 'someone-else' })).action).toBe('unknown_seller');
    expect(social.sent).toHaveLength(0);
    expect(await env.db.query('select 1 from messages')).toHaveLength(0);
  });

  it('never sends after the 24-hour window, and never uses templates there', async () => {
    await shop();
    await handleSocialInbound(env.ctx, dm('instagram', 'igsid-4', 'ok'));
    const { call } = client(() => at(25 * 60));
    const [chat] = await env.db.query<{ id: string }>(`select id from contacts where channel = 'instagram'`);
    const late = await call('POST', `/api/chats/${chat.id}/reply`, { body: 'Still interested?' });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/Instagram doesn't allow a reply/);
    const { call: soon } = client(() => at(10));
    expect((await soon('POST', `/api/chats/${chat.id}/reply`, { body: 'Yes, we deliver in Douala.' })).status).toBe(201);
    expect(social.sent.at(-1)).toMatchObject({ channel: 'instagram', to: { userId: 'igsid-4' }, text: 'Yes, we deliver in Douala.' });
  });
});

describe('comments on posts', () => {
  const comment = (from: string, text: string, when = T0, postId = 'post-1'): SocialInbound => ({
    ...dm('instagram', from, text, when), username: 'amaka_styles', comment: { id: `c-${Math.random()}`, postId },
  });

  it('answers a price question privately with the shop page, once per person per post per day', async () => {
    await shop();
    const r = await handleSocialInbound(env.ctx, comment('igsid-5', 'Prix ?'));
    expect(r.action).toBe('shop_link');
    expect(social.sent[0].to).toHaveProperty('commentId');
    expect(social.sent[0].text).toContain('/shop.html?s=douala-hair');
    expect(social.sent[0].text).toMatch(/^Bonjour amaka_styles, merci pour votre commentaire/);

    expect((await handleSocialInbound(env.ctx, comment('igsid-5', 'combien ?', at(30)))).action).toBe('ignored');
    expect((await handleSocialInbound(env.ctx, comment('igsid-5', 'combien ?', at(30), 'post-2'))).action).toBe('shop_link');
    expect((await handleSocialInbound(env.ctx, comment('igsid-6', 'Trop beau 😍'))).action).toBe('ignored');
    expect(social.sent).toHaveLength(2);
  });

  it('answers about a named product, and can be switched off', async () => {
    const { ig } = await shop();
    const r = await handleSocialInbound(env.ctx, comment('igsid-7', 'the jet black claw clip ponytail is available?'));
    expect(r.action).toBe('in_stock');
    await env.db.query('update channel_accounts set comment_replies = false where id = $1', [ig]);
    expect((await handleSocialInbound(env.ctx, comment('igsid-8', 'prix ?'))).action).toBe('ignored');
  });
});

describe('Meta webhook', () => {
  it('reads Instagram DMs and comments and Page messages, skipping the shop echoes', () => {
    const ig = parseMetaWebhook({
      object: 'instagram',
      entry: [{
        id: 'ig-123', time: 1790000000,
        messaging: [
          { sender: { id: 'igsid-1' }, recipient: { id: 'ig-123' }, timestamp: 1790000000000, message: { mid: 'm1', text: 'dispo ?' } },
          { sender: { id: 'ig-123' }, recipient: { id: 'igsid-1' }, timestamp: 1790000001000, message: { mid: 'm2', text: 'oui', is_echo: true } },
        ],
        changes: [{ field: 'comments', value: { id: 'c1', text: 'prix?', from: { id: 'igsid-2', username: 'nadege' }, media: { id: 'p1' } } }],
      }],
    });
    expect(ig).toEqual([
      expect.objectContaining({ channel: 'instagram', accountId: 'ig-123', from: 'igsid-1', text: 'dispo ?', providerId: 'm1' }),
      expect.objectContaining({ channel: 'instagram', from: 'igsid-2', username: 'nadege', comment: { id: 'c1', postId: 'p1' } }),
    ]);
    const page = parseMetaWebhook({
      object: 'page',
      entry: [{ id: 'page-456', messaging: [{ sender: { id: 'psid-1' }, recipient: { id: 'page-456' }, timestamp: 1, message: { mid: 'x', text: 'hello' } }] }],
    });
    expect(page[0]).toMatchObject({ channel: 'facebook', accountId: 'page-456', from: 'psid-1' });
    expect(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
  });

  it('accepts only signed events once an app secret is set', async () => {
    await shop();
    env.ctx.config.meta.appSecret = 'meta-secret';
    const app = createApp(env.ctx);
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'ig-123', messaging: [{ sender: { id: 'igsid-9' }, recipient: { id: 'ig-123' }, timestamp: T0.getTime(), message: { mid: 'z', text: 'vous avez le bonnet satin ?' } }] }],
    });
    expect((await app.request('/webhooks/meta', { method: 'POST', body })).status).toBe(401);
    const sig = 'sha256=' + createHmac('sha256', 'meta-secret').update(body).digest('hex');
    const ok = await app.request('/webhooks/meta', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } });
    expect(await ok.json()).toEqual({ handled: [{ channel: 'instagram', action: 'offered' }] });
  });
});

function client(now: () => Date) {
  const app = createApp(env.ctx, now);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  return { call };
}

describe('connecting channels', () => {
  /** A fake Meta that answers the sign-in calls and records them. */
  function fakeMeta(pages = [{ id: 'page-1', name: 'Douala Hair', access_token: 'page-token-1' }]) {
    const calls: string[] = [];
    env.ctx.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://api.instagram.com/oauth/access_token')) return json({ data: [{ access_token: 'short-ig', user_id: 'app-scoped' }] });
      if (url.startsWith('https://graph.instagram.com/access_token')) return json({ access_token: 'long-ig', expires_in: 5_184_000 });
      if (url.includes('graph.instagram.com') && url.includes('/me?')) return json({ user_id: 'ig-777', username: 'doualahair', name: 'Douala Hair' });
      if (url.includes('/subscribed_apps')) return json({ success: true });
      if (url.includes('graph.facebook.com') && url.includes('/oauth/access_token')) return json({ access_token: url.includes('fb_exchange_token') ? 'long-user' : 'short-user' });
      if (url.includes('/me/accounts')) return json({ data: pages });
      return new Response(JSON.stringify({ error: { message: `unexpected ${url}` } }), { status: 400 });
    }) as typeof fetch;
    env.ctx.config.meta = { appId: 'meta-app', appSecret: 'meta-secret', igAppId: 'ig-app', igAppSecret: 'ig-secret', graphVersion: 'v23.0' };
    env.ctx.config.appUrl = 'https://seller.example';
    return calls;
  }
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

  it('connects Instagram with a long-lived token stored encrypted', async () => {
    env = await setup();
    const calls = fakeMeta();
    const { call, app } = clientWithApp(() => T0);
    expect((await call('GET', `/api/channels?sellerId=${env.sellerId}`)).body).toEqual({ accounts: [], available: { instagram: true, facebook: true } });
    const { url } = (await call('POST', '/api/channels/instagram/connect', { sellerId: env.sellerId })).body;
    expect(url).toMatch(/^https:\/\/www\.instagram\.com\/oauth\/authorize\?client_id=ig-app&redirect_uri=.+%2Foauth%2Finstagram&response_type=code&scope=instagram_business_basic%2Cinstagram_business_manage_messages%2Cinstagram_business_manage_comments&state=/);

    const back = await app.request(`/oauth/instagram?code=abc&state=${encodeURIComponent(stateOf(url))}`);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('https://seller.example/?connected=instagram#/settings');
    expect(calls).toContain('POST https://graph.instagram.com/v23.0/me/subscribed_apps');
    const [row] = await env.db.query<{ external_id: string; username: string; token_enc: string; token_expires_at: Date }>('select * from channel_accounts');
    expect(row).toMatchObject({ external_id: 'ig-777', username: 'doualahair' });
    expect(row.token_enc).not.toContain('long-ig');
    expect(row.token_expires_at.getTime()).toBeGreaterThan(Date.now() + 50 * 24 * 3600_000);

    // A tampered link is refused.
    const [body, mac] = stateOf(url).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), s: 'someone-elses-shop' })).toString('base64url');
    const bad = await app.request(`/oauth/instagram?code=abc&state=${encodeURIComponent(`${forged}.${mac}`)}`);
    expect(bad.headers.get('location')).toMatch(/channel_error=This\+sign-in\+link\+is\+not\+valid/);
  });

  it('asks which Page to use when the Facebook account has several', async () => {
    env = await setup();
    const calls = fakeMeta([{ id: 'page-1', name: 'Douala Hair', access_token: 't1' }, { id: 'page-2', name: 'Yaoundé Wigs', access_token: 't2' }]);
    const { call, app } = clientWithApp(() => T0);
    const { url } = (await call('POST', '/api/channels/facebook/connect', { sellerId: env.sellerId })).body;
    const back = await app.request(`/oauth/facebook?code=abc&state=${encodeURIComponent(stateOf(url))}`);
    const pending = new URL(back.headers.get('location')!).searchParams.get('pick_page')!;
    const choices = (await call('GET', `/api/channels/pending/${pending}?sellerId=${env.sellerId}`)).body;
    expect(choices).toEqual([{ id: 'page-1', name: 'Douala Hair' }, { id: 'page-2', name: 'Yaoundé Wigs' }]);
    expect((await call('POST', `/api/channels/pending/${pending}`, { sellerId: env.sellerId, pageId: 'page-2' })).status).toBe(200);
    expect(calls).toContain('POST https://graph.facebook.com/v23.0/page-2/subscribed_apps');
    const accounts = (await call('GET', `/api/channels?sellerId=${env.sellerId}`)).body.accounts;
    expect(accounts).toMatchObject([{ channel: 'facebook', name: 'Yaoundé Wigs', enabled: true, comment_replies: true }]);
    expect(JSON.stringify(accounts)).not.toMatch(/token_enc|t2/);

    // Pause, then disconnect.
    expect((await call('PATCH', `/api/channels/${accounts[0].id}`, { enabled: false })).body).toMatchObject({ enabled: false });
    expect((await call('DELETE', `/api/channels/${accounts[0].id}`)).status).toBe(200);
    expect((await call('GET', `/api/channels?sellerId=${env.sellerId}`)).body.accounts).toEqual([]);
  });

  it("won't connect an account that another shop already uses", async () => {
    env = await setup();
    fakeMeta();
    const [other] = await env.db.query<{ id: string }>(
      `insert into sellers (name, wa_phone_number_id, country, currency, language, timezone) values ('Other', 'pn-o', 'CM', 'XAF', 'fr', 'Africa/Douala') returning id`,
    );
    await env.db.query(`insert into channel_accounts (seller_id, channel, external_id, token_enc) values ($1, 'instagram', 'ig-777', 'x')`, [other.id]);
    const { call, app } = clientWithApp(() => T0);
    const { url } = (await call('POST', '/api/channels/instagram/connect', { sellerId: env.sellerId })).body;
    const back = await app.request(`/oauth/instagram?code=abc&state=${encodeURIComponent(stateOf(url))}`);
    expect(back.headers.get('location')).toMatch(/already\+connected\+to\+another\+shop/);
  });

  it('says a channel is not set up when the server has no app id for it', async () => {
    env = await setup();
    const { call } = clientWithApp(() => T0);
    expect((await call('GET', `/api/channels?sellerId=${env.sellerId}`)).body.available).toEqual({ instagram: false, facebook: false });
    expect((await call('POST', '/api/channels/instagram/connect', { sellerId: env.sellerId })).body.error).toMatch(/isn't set up on the server/);
  });
});

function clientWithApp(now: () => Date) {
  const app = createApp(env.ctx, now);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  return { call, app };
}
