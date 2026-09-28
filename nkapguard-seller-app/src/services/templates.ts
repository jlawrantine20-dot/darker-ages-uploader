/**
 * Submits the app's WhatsApp templates to Meta, so nobody has to type 16 of them into the
 * dashboard by hand. The bodies come from `templateBody`, the same source the app sends
 * from, and templates Meta already has (by name and language) are left alone.
 */
import { slots, templateBody, templateFor, type Facts, type Fmt } from '../domain/copy.js';
import { CODE_TTL_MS } from './auth.js';
import type { Ctx } from './context.js';

type Key = 'hold' | 'race' | 'soldOut' | 'paid' | 'refund';
const KEYS: Key[] = ['hold', 'race', 'soldOut', 'paid', 'refund'];
const CATEGORY: Record<Key, 'MARKETING' | 'UTILITY'> = { hold: 'MARKETING', race: 'MARKETING', soldOut: 'UTILITY', paid: 'UTILITY', refund: 'UTILITY' };

// Meta asks for a sample value for every {{n}}; reviewers read the template with these filled in.
const SAMPLE: Facts = {
  name: 'Aïcha Mbarga',
  product: { name: 'Claw Clip Ponytail', variant: 'Marron / Brown' },
  priceMinor: 15000,
  units: 3,
  waiting: 5,
  told: 5,
  until: new Date('2026-10-01T11:00:00Z'),
  url: 'https://seller.nkapguard.com/pay.html?r=AB12CD',
};
const SAMPLE_FMT: Fmt = { currency: 'XAF', country: 'CM', timezone: 'Africa/Douala' };

export interface TemplateSpec {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: unknown[];
}

/** Every template the app can send: each message in English, French and the bilingual set, plus the sign-in code. */
export function templateSpecs(ctx: Ctx): TemplateSpec[] {
  const { templates } = ctx.config.whatsapp;
  const specs: TemplateSpec[] = [];
  for (const key of KEYS) {
    for (const lang of ['en', 'fr', 'fr+en']) {
      const { name, language } = templateFor(templates[key], lang);
      specs.push({
        name,
        language,
        category: CATEGORY[key],
        components: [{ type: 'BODY', text: templateBody(lang, key), example: { body_text: [slots(lang, key, SAMPLE, SAMPLE_FMT)] } }],
      });
    }
  }
  const { loginTemplate, loginTemplateLanguage } = ctx.config.platform;
  specs.push({
    name: loginTemplate,
    language: loginTemplateLanguage,
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: CODE_TTL_MS / 60_000 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ],
  });
  return specs;
}

export interface TemplateStatus {
  name: string;
  language: string;
  status: string;
  error?: string;
}

async function graph(ctx: Ctx, path: string, init?: RequestInit) {
  const { token, apiVersion } = ctx.config.whatsapp;
  const res = await (ctx.fetch ?? fetch)(`https://graph.facebook.com/${apiVersion}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = (await res.json()) as { error?: { message: string; error_user_msg?: string } } & Record<string, unknown>;
  if (!res.ok) throw new Error(json.error?.error_user_msg ?? json.error?.message ?? `Meta returned ${res.status}`);
  return json;
}

/** What Meta has on file for this WhatsApp Business Account: approved, pending, rejected. */
export async function listTemplates(ctx: Ctx, wabaId: string): Promise<TemplateStatus[]> {
  const out: TemplateStatus[] = [];
  let path: string | null = `${wabaId}/message_templates?fields=name,language,status,rejected_reason&limit=100`;
  while (path) {
    const page = (await graph(ctx, path)) as { data: { name: string; language: string; status: string; rejected_reason?: string }[]; paging?: { next?: string } };
    for (const t of page.data) out.push({ name: t.name, language: t.language, status: t.status, ...(t.rejected_reason && t.rejected_reason !== 'NONE' ? { error: t.rejected_reason } : {}) });
    const next = page.paging?.next;
    path = next ? next.slice(next.indexOf(wabaId)) : null;
  }
  return out;
}

/** Submits every template Meta doesn't have yet; returns the state of all of them. */
export async function submitTemplates(ctx: Ctx, wabaId: string): Promise<TemplateStatus[]> {
  const existing = await listTemplates(ctx, wabaId);
  const has = (s: TemplateSpec) => existing.find((t) => t.name === s.name && t.language === s.language);
  const results: TemplateStatus[] = [];
  for (const spec of templateSpecs(ctx)) {
    const found = has(spec);
    if (found) {
      results.push(found);
      continue;
    }
    try {
      const r = (await graph(ctx, `${wabaId}/message_templates`, { method: 'POST', body: JSON.stringify(spec) })) as { status?: string };
      results.push({ name: spec.name, language: spec.language, status: r.status ?? 'PENDING' });
    } catch (err) {
      results.push({ name: spec.name, language: spec.language, status: 'NOT_SUBMITTED', error: (err as Error).message });
    }
  }
  return results;
}
