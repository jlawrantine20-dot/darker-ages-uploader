/**
 * Product photos. The seller app shrinks each photo before upload (about 1024 px, ~100 KB),
 * so they're stored in the database and served from /photos/<product id>. Links carry the
 * photo's version, so browsers and Meta can cache them for good.
 */
import { Buffer } from 'node:buffer';
import type { Ctx } from './context.js';
import { InputError } from './errors.js';

const MAX_BYTES = 1_500_000;
const TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** The public link to a product's photo, or null when it has none. */
export function photoUrl(ctx: Ctx, p: { id: string; photo_version?: number | string | null }): string | null {
  return p.photo_version ? `${ctx.config.publicUrl.replace(/\/$/, '')}/photos/${p.id}?v=${p.photo_version}` : null;
}

/** Save a photo sent as a data URL ("data:image/jpeg;base64,…"). */
export async function savePhoto(ctx: Ctx, productId: string, dataUrl: string, now: Date): Promise<string> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) throw new InputError('photo_invalid');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_BYTES) throw new InputError('photo_too_big');
  // Trust the bytes, not the label.
  if (!TYPES[m[1]](data)) throw new InputError('photo_invalid');
  await ctx.db.query(
    `insert into product_photos (product_id, content_type, data, updated_at) values ($1, $2, $3, $4)
     on conflict (product_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at`,
    [productId, m[1], data, now],
  );
  const [p] = await ctx.db.query<{ id: string; photo_version: string }>('update products set photo_version = $2 where id = $1 returning id, photo_version', [productId, now.getTime()]);
  return photoUrl(ctx, p)!;
}

export async function deletePhoto(ctx: Ctx, productId: string) {
  await ctx.db.query('delete from product_photos where product_id = $1', [productId]);
  await ctx.db.query('update products set photo_version = null where id = $1', [productId]);
}

export async function loadPhoto(ctx: Ctx, productId: string): Promise<{ type: string; data: Uint8Array<ArrayBuffer> } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
  const [row] = await ctx.db.query<{ content_type: string; data: Uint8Array }>('select content_type, data from product_photos where product_id = $1', [productId]);
  return row ? { type: row.content_type, data: new Uint8Array(row.data) } : null;
}
