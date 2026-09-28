import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { handleInbound } from '../src/services/inbound.js';
import { T0, inbound, setup, wa } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await env?.db.close();
  env = undefined as unknown as typeof env;
});

// The start of a real JPEG file, followed by filler bytes.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(200, 7)]);
const dataUrl = (b: Buffer, type = 'image/jpeg') => `data:${type};base64,${b.toString('base64')}`;

describe('Product photos', () => {
  it('stores a photo, serves it for good, shows it on the shop page and sends it with the answer', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => T0);
    const post = (path: string, body: object) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const up = await (await post(`/api/products/${env.black}/photo`, { dataUrl: dataUrl(jpeg) })).json();
    expect(up.url).toBe(`https://nkapguard.test/photos/${env.black}?v=${T0.getTime()}`);

    const served = await app.request(`/photos/${env.black}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await served.arrayBuffer()).equals(jpeg)).toBe(true);

    await env.db.query(`update sellers set slug = 'douala-hair'`);
    const shop = await (await app.request('/shop/douala-hair')).json();
    expect(shop.products.find((p: { variant: string }) => p.variant === 'Jet black').photo).toBe(up.url);

    await handleInbound(env.ctx, inbound(wa(1), 'do you have the jet black claw clip ponytail?', T0));
    const sent = env.channel.sent.at(-1)!;
    expect(sent).toMatchObject({ kind: 'image', imageUrl: up.url });
    expect(sent.body).toContain('yes, we have the jet black');
    // The seller's chat shows the photo too.
    const [msg] = await env.db.query<{ image_url: string }>(`select image_url from messages where direction = 'out'`);
    expect(msg.image_url).toBe(up.url);
  });

  it('refuses files that are not photos, whatever they claim to be', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => T0);
    const res = await app.request(`/api/products/${env.black}/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': 'fr' },
      body: JSON.stringify({ dataUrl: dataUrl(Buffer.from('<script>alert(1)</script>')) }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ce fichier n'est pas une photo. Utilisez une image JPEG, PNG ou WebP.");
  });

  it('removes a photo; the answer goes back to text only', async () => {
    env = await setup();
    const app = createApp(env.ctx, () => T0);
    await app.request(`/api/products/${env.black}/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: dataUrl(jpeg) }) });
    await app.request(`/api/products/${env.black}/photo`, { method: 'DELETE' });
    expect((await app.request(`/photos/${env.black}`)).status).toBe(404);
    await handleInbound(env.ctx, inbound(wa(2), 'do you have the jet black claw clip ponytail?', T0));
    expect(env.channel.sent.at(-1)?.kind).toBe('text');
  });
});
