import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Q } from '../db.js';
import { normalizePhone } from '../domain/phone.js';
import type { Ctx } from './context.js';
import { InputError } from './errors.js';

export const CODE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
/** Codes one phone number can request per hour. */
export const MAX_CODES_PER_HOUR = 5;
/** Wrong guesses allowed per code. */
export const MAX_ATTEMPTS = 5;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export class AuthError extends Error {}

/** Who is calling the API: the operator (admin token) or a signed-in person. */
export type Viewer = { kind: 'admin' } | { kind: 'user'; userId: string };

export type Role = 'owner' | 'staff';

function phoneOrThrow(phone: string, country: string): string {
  const waId = normalizePhone(phone ?? '', country ?? '');
  if (!waId) throw new InputError('Enter your WhatsApp number, with the country code if it is not a local number.');
  return waId;
}

/**
 * Send a one-time sign-in code to a WhatsApp number. In test mode nothing is sent and the
 * code is returned so the app can show it.
 */
export async function startLogin(ctx: Ctx, phone: string, country: string, now: Date): Promise<{ waId: string; devCode?: string }> {
  const waId = phoneOrThrow(phone, country);
  const [{ n }] = await ctx.db.query<{ n: number }>(
    'select count(*)::int as n from login_codes where wa_id = $1 and created_at > $2',
    [waId, new Date(now.getTime() - 60 * 60_000)],
  );
  if (n >= MAX_CODES_PER_HOUR) throw new AuthError('Too many codes requested for this number. Try again in an hour.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(
    'insert into login_codes (wa_id, code_hash, created_at, expires_at) values ($1, $2, $3, $4)',
    [waId, sha256(`${waId}:${code}`), now, new Date(now.getTime() + CODE_TTL_MS)],
  );
  if (ctx.config.dryRun) return { waId, devCode: code };
  const { phoneNumberId, loginTemplate, loginTemplateLanguage } = ctx.config.platform;
  await ctx.channel.sendTemplate(phoneNumberId, waId, { name: loginTemplate, language: loginTemplateLanguage, params: [code], buttonParams: [code] });
  return { waId };
}

/** Check a code and open a session. Returns the session token, which is shown only once. */
export async function verifyLogin(ctx: Ctx, phone: string, country: string, code: string, now: Date) {
  const waId = phoneOrThrow(phone, country);
  // Failures return instead of throwing inside the transaction, so a wrong guess is
  // committed to the attempts counter rather than rolled back with the error.
  const result = await ctx.db.tx(async (q) => {
    const [row] = await q.query<{ id: string; code_hash: string; attempts: number; expires_at: Date; used_at: Date | null }>(
      'select * from login_codes where wa_id = $1 order by created_at desc limit 1 for update',
      [waId],
    );
    if (!row || row.used_at || row.expires_at <= now || row.attempts >= MAX_ATTEMPTS) return null;
    const given = Buffer.from(sha256(`${waId}:${String(code ?? '').trim()}`));
    if (!timingSafeEqual(given, Buffer.from(row.code_hash))) {
      await q.query('update login_codes set attempts = attempts + 1 where id = $1', [row.id]);
      return null;
    }
    await q.query('update login_codes set used_at = $2 where id = $1', [row.id, now]);
    const [user] = await q.query<{ id: string; wa_id: string; name: string | null }>(
      `insert into users (wa_id) values ($1) on conflict (wa_id) do update set wa_id = excluded.wa_id returning id, wa_id, name`,
      [waId],
    );
    const token = randomBytes(32).toString('base64url');
    await q.query('insert into sessions (token_hash, user_id, created_at, expires_at) values ($1, $2, $3, $4)', [
      sha256(token), user.id, now, new Date(now.getTime() + SESSION_TTL_MS),
    ]);
    return { token, user };
  });
  if (!result) throw new AuthError('That code is wrong or has expired. Request a new one.');
  return result;
}

/** Resolve an Authorization header to a viewer, or null if it is not valid. */
export async function viewerFor(ctx: Ctx, header: string | undefined, now: Date): Promise<Viewer | null> {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const admin = ctx.config.adminToken;
  if (admin && token.length === admin.length && timingSafeEqual(Buffer.from(token), Buffer.from(admin))) return { kind: 'admin' };
  const [s] = await ctx.db.query<{ user_id: string }>(
    'select user_id from sessions where token_hash = $1 and revoked_at is null and expires_at > $2',
    [sha256(token), now],
  );
  return s ? { kind: 'user', userId: s.user_id } : null;
}

export async function logout(ctx: Ctx, header: string | undefined, now: Date) {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) await ctx.db.query('update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null', [sha256(token), now]);
}

/** The viewer's role in a shop, or null if they have no access. The operator counts as owner. */
export async function roleIn(q: Q, viewer: Viewer, sellerId: string): Promise<Role | null> {
  if (viewer.kind === 'admin') return 'owner';
  const [m] = await q.query<{ role: Role }>('select role from shop_members where seller_id = $1 and user_id = $2', [sellerId, viewer.userId]);
  return m?.role ?? null;
}

export class ForbiddenError extends Error {}

/**
 * Throw unless the viewer may act in this shop. Missing shops and shops the viewer is not
 * part of look the same, so ids of other sellers' data reveal nothing.
 */
export async function requireRole(q: Q, viewer: Viewer, sellerId: string | null | undefined, need: Role = 'staff'): Promise<Role> {
  const role = sellerId ? await roleIn(q, viewer, sellerId) : null;
  if (!role) throw new ForbiddenError('Not found.');
  if (need === 'owner' && role !== 'owner') throw new ForbiddenError('Only the shop owner can do this.');
  return role;
}

/** Which shop a product, restock or chat belongs to. */
export async function shopOf(q: Q, kind: 'product' | 'restock' | 'chat', id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sql = {
    product: 'select seller_id from products where id = $1',
    restock: 'select p.seller_id from restocks r join products p on p.id = r.product_id where r.id = $1',
    chat: 'select seller_id from contacts where id = $1',
  }[kind];
  return (await q.query<{ seller_id: string }>(sql, [id]))[0]?.seller_id ?? null;
}

export async function addMember(q: Q, sellerId: string, phone: string, country: string, role: Role) {
  if (role !== 'owner' && role !== 'staff') throw new InputError("role must be 'owner' or 'staff'");
  const waId = phoneOrThrow(phone, country);
  const [user] = await q.query<{ id: string }>(
    `insert into users (wa_id) values ($1) on conflict (wa_id) do update set wa_id = excluded.wa_id returning id`,
    [waId],
  );
  await q.query(
    `insert into shop_members (seller_id, user_id, role) values ($1, $2, $3) on conflict (seller_id, user_id) do update set role = excluded.role`,
    [sellerId, user.id, role],
  );
  return { userId: user.id, waId };
}

export async function removeMember(q: Q, sellerId: string, userId: string) {
  const owners = await q.query<{ user_id: string }>(`select user_id from shop_members where seller_id = $1 and role = 'owner'`, [sellerId]);
  if (owners.length === 1 && owners[0].user_id === userId) throw new InputError('A shop needs at least one owner. Make someone else owner first.');
  await q.query('delete from shop_members where seller_id = $1 and user_id = $2', [sellerId, userId]);
}
