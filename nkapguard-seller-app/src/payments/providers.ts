import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Provider } from '../domain/markets.js';
import { toMajor, toMinor } from '../domain/money.js';

export interface LinkRequest {
  reference: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Customer's WhatsApp id, digits only. */
  waId: string;
  name?: string | null;
  metadata: Record<string, string>;
  /** Language of the thank-you page the customer returns to: en, fr or fr+en. */
  language?: string;
}

export interface PaymentEvent {
  reference: string;
  amountMinor: number;
  currency?: string;
  /** The provider's own transaction id, used to double-check the payment with its API. */
  providerTxId?: string;
}

/** ok=false means the signature did not check out; event=null means a genuine event we don't act on. */
export type WebhookResult = { ok: false } | { ok: true; event: PaymentEvent | null };

/** Money always goes to the seller's own account; NKAPGUARD only creates links and reads results. */
export interface PaymentProvider {
  name: Provider;
  createLink(r: LinkRequest): Promise<{ url: string }>;
  parseWebhook(rawBody: string, header: (name: string) => string | undefined): WebhookResult;
  /**
   * Ask the provider's API whether the payment really succeeded before trusting a webhook.
   * Returns the verified event, or null if the provider does not confirm it.
   */
  confirm?(event: PaymentEvent): Promise<PaymentEvent | null>;
}

export interface ProviderOptions {
  secretKey: string;
  webhookSecret?: string;
  publicUrl: string;
  /** Some providers require an email; WhatsApp buyers often have none, so they get <waId>@this domain. */
  emailDomain: string;
  fetchFn?: typeof fetch;
}

/** Where the customer lands after paying: the thank-you page, in their language. */
const paidUrl = (o: ProviderOptions, r: LinkRequest) =>
  `${o.publicUrl.replace(/\/$/, '')}/paid${r.language ? `?lang=${encodeURIComponent(r.language)}` : ''}`;

const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const json = (raw: string): any => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Test mode: links point back at this server and nothing is charged. */
export function testProvider(publicUrl: string): PaymentProvider {
  return {
    name: 'test',
    createLink: async (r) => ({ url: `${publicUrl.replace(/\/$/, '')}/pay/${r.reference}/test` }),
    parseWebhook: (raw) => {
      const b = json(raw);
      return { ok: true, event: b?.reference ? { reference: b.reference, amountMinor: Number(b.amountMinor) } : null };
    },
  };
}

/** Paystack: Nigeria, Ghana, South Africa, Kenya, Côte d'Ivoire, Egypt. Amounts in subunits. */
export function paystack(o: ProviderOptions): PaymentProvider {
  const f = o.fetchFn ?? fetch;
  return {
    name: 'paystack',
    async createLink(r) {
      const res = await f('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${r.waId}@${o.emailDomain}`, amount: r.amountMinor, currency: r.currency, reference: r.reference, metadata: r.metadata }),
      });
      const b = (await res.json()) as { status: boolean; message: string; data?: { authorization_url: string } };
      if (!res.ok || !b.status || !b.data) throw new Error(`Paystack could not create a payment link: ${b.message}`);
      return { url: b.data.authorization_url };
    },
    parseWebhook(raw, header) {
      const sig = header('x-paystack-signature');
      const expected = createHmac('sha512', o.secretKey).update(raw, 'utf8').digest();
      if (!sig || !safeEqual(Buffer.from(sig, 'hex'), expected)) return { ok: false };
      const b = json(raw);
      if (b?.event !== 'charge.success' || b.data?.status !== 'success') return { ok: true, event: null };
      return { ok: true, event: { reference: b.data.reference, amountMinor: Number(b.data.amount), currency: b.data.currency } };
    },
  };
}

/** Flutterwave checkout options per currency, so buyers see the mobile money they actually use. */
export const FLUTTERWAVE_OPTIONS: Record<string, string> = {
  XAF: 'mobilemoneyfranco,card',
  XOF: 'mobilemoneyfranco,card',
  GHS: 'mobilemoneyghana,card',
  KES: 'mpesa,card',
  UGX: 'mobilemoneyuganda,card',
  RWF: 'mobilemoneyrwanda,card',
  TZS: 'mobilemoneytanzania,card',
  ZMW: 'mobilemoneyzambia,card',
  NGN: 'card,banktransfer,ussd',
};

/**
 * Flutterwave: most of Africa, including MTN and Orange Money in Cameroon and other XAF/XOF
 * countries. Amounts are sent in major units. Webhooks carry the "secret hash" set in the
 * Flutterwave dashboard in the verif-hash header; because that is a fixed shared secret,
 * every webhook is also confirmed with Flutterwave's verify endpoint before it counts.
 */
export function flutterwave(o: ProviderOptions): PaymentProvider {
  const f = o.fetchFn ?? fetch;
  const api = async (path: string, init?: RequestInit) => {
    const res = await f(`https://api.flutterwave.com/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${o.secretKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    return { res, body: (await res.json()) as { status: string; message: string; data?: any } };
  };
  return {
    name: 'flutterwave',
    async createLink(r) {
      const { res, body: b } = await api('/payments', {
        method: 'POST',
        body: JSON.stringify({
          tx_ref: r.reference,
          amount: toMajor(r.amountMinor, r.currency),
          currency: r.currency,
          redirect_url: paidUrl(o, r),
          payment_options: FLUTTERWAVE_OPTIONS[r.currency] ?? 'card',
          customer: { email: `${r.waId}@${o.emailDomain}`, phonenumber: r.waId, name: r.name ?? undefined },
          customizations: { title: r.description },
          meta: r.metadata,
        }),
      });
      if (!res.ok || b.status !== 'success' || !b.data?.link) throw new Error(`Flutterwave could not create a payment link: ${b.message}`);
      return { url: b.data.link };
    },
    parseWebhook(raw, header) {
      const given = header('verif-hash');
      if (!given || !o.webhookSecret || !safeEqual(Buffer.from(given), Buffer.from(o.webhookSecret))) return { ok: false };
      const b = json(raw);
      const d = b?.data;
      if (b?.event !== 'charge.completed' || d?.status !== 'successful') return { ok: true, event: null };
      return {
        ok: true,
        event: { reference: d.tx_ref, amountMinor: toMinor(Number(d.amount), d.currency), currency: d.currency, providerTxId: d.id == null ? undefined : String(d.id) },
      };
    },
    async confirm(event) {
      if (!event.providerTxId) return null;
      const { res, body: b } = await api(`/transactions/${encodeURIComponent(event.providerTxId)}/verify`);
      const d = b.data;
      if (!res.ok || b.status !== 'success' || d?.status !== 'successful' || d.tx_ref !== event.reference) return null;
      // Trust Flutterwave's own figures over the webhook body.
      return { reference: d.tx_ref, amountMinor: toMinor(Number(d.amount), d.currency), currency: d.currency, providerTxId: String(d.id) };
    },
  };
}

/** Look up a payment by our reference; used by the sandbox check script. */
export async function flutterwaveByReference(secretKey: string, txRef: string, fetchFn: typeof fetch = fetch) {
  const res = await fetchFn(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  return (await res.json()) as { status: string; message: string; data?: { status: string; amount: number; currency: string; id: number } };
}

/** Stripe Checkout: cards and wallets in 40+ countries. Amounts in the smallest unit (XAF and XOF have none). */
export function stripe(o: ProviderOptions): PaymentProvider {
  const f = o.fetchFn ?? fetch;
  return {
    name: 'stripe',
    async createLink(r) {
      const form = new URLSearchParams({
        mode: 'payment',
        client_reference_id: r.reference,
        success_url: paidUrl(o, r),
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': r.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(r.amountMinor),
        'line_items[0][price_data][product_data][name]': r.description,
        'metadata[reference]': r.reference,
      });
      for (const [k, v] of Object.entries(r.metadata)) form.set(`metadata[${k}]`, v);
      const res = await f('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const b = (await res.json()) as { url?: string; error?: { message: string } };
      if (!res.ok || !b.url) throw new Error(`Stripe could not create a payment link: ${b.error?.message ?? res.status}`);
      return { url: b.url };
    },
    parseWebhook(raw, header) {
      // Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">
      const parts = Object.fromEntries((header('stripe-signature') ?? '').split(',').map((kv) => kv.split('=') as [string, string]));
      if (!parts.t || !parts.v1 || !o.webhookSecret) return { ok: false };
      const expected = createHmac('sha256', o.webhookSecret).update(`${parts.t}.${raw}`, 'utf8').digest();
      if (!safeEqual(Buffer.from(parts.v1, 'hex'), expected)) return { ok: false };
      if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return { ok: false };
      const b = json(raw);
      const s = b?.data?.object;
      if (b?.type !== 'checkout.session.completed' || s?.payment_status !== 'paid') return { ok: true, event: null };
      return { ok: true, event: { reference: s.client_reference_id, amountMinor: Number(s.amount_total), currency: String(s.currency).toUpperCase() } };
    },
  };
}

/**
 * Notch Pay: MTN Mobile Money and Orange Money in Cameroon, no customer email needed.
 * Payments are created with the public key; webhooks are signed with the webhook hash
 * (x-notch-signature = HMAC-SHA256 hex of the raw body). Checkout links expire after
 * 3 hours, which is why NKAPGUARD creates them only when the customer taps the link.
 */
export function notchpay(o: ProviderOptions): PaymentProvider {
  const f = o.fetchFn ?? fetch;
  return {
    name: 'notchpay',
    async createLink(r) {
      const res = await f('https://api.notchpay.co/payments', {
        method: 'POST',
        headers: { Authorization: o.secretKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          amount: toMajor(r.amountMinor, r.currency),
          currency: r.currency,
          phone: '+' + r.waId,
          reference: r.reference,
          description: r.description,
          callback: paidUrl(o, r),
        }),
      });
      const b = (await res.json()) as { authorization_url?: string; message?: string };
      if (!res.ok || !b.authorization_url) throw new Error(`Notch Pay could not create a payment link: ${b.message ?? res.status}`);
      return { url: b.authorization_url };
    },
    parseWebhook(raw, header) {
      const sig = header('x-notch-signature');
      if (!sig || !o.webhookSecret) return { ok: false };
      const expected = createHmac('sha256', o.webhookSecret).update(raw, 'utf8').digest();
      if (!safeEqual(Buffer.from(sig, 'hex'), expected)) return { ok: false };
      const b = json(raw);
      const d = b?.data;
      if (b?.event !== 'payment.complete' || d?.status !== 'complete') return { ok: true, event: null };
      // Notch Pay's docs differ on which field echoes our reference; accept either.
      const reference = d.merchant_reference ?? d.reference;
      return { ok: true, event: { reference, amountMinor: toMinor(Number(d.amount), d.currency ?? 'XAF'), currency: d.currency } };
    },
  };
}

export function makeProvider(name: Provider, o: ProviderOptions): PaymentProvider {
  switch (name) {
    case 'test':
      return testProvider(o.publicUrl);
    case 'paystack':
      return paystack(o);
    case 'flutterwave':
      return flutterwave(o);
    case 'stripe':
      return stripe(o);
    case 'notchpay':
      return notchpay(o);
    default:
      throw new Error(`${name} payments are not available yet.`);
  }
}

/** What each provider needs from the seller, for the settings screen. */
export const PROVIDER_INFO: Record<Provider, { label: string; needsWebhookSecret: boolean; secretHint: string; webhookHint?: string }> = {
  test: { label: 'Test payments (nothing is charged)', needsWebhookSecret: false, secretHint: '' },
  paystack: { label: 'Paystack (Nigeria, Ghana, Kenya, South Africa, Côte d’Ivoire)', needsWebhookSecret: false, secretHint: 'Secret key (sk_live_…) from Settings › API Keys & Webhooks' },
  flutterwave: {
    label: 'Flutterwave (cards, MTN MoMo, Orange Money, M-Pesa)',
    needsWebhookSecret: true,
    secretHint: 'Secret key (FLWSECK-…) from Settings › API keys',
    webhookHint: 'The "Secret hash" you set under Settings › Webhooks',
  },
  stripe: { label: 'Stripe (cards, worldwide)', needsWebhookSecret: true, secretHint: 'Secret key (sk_live_…)', webhookHint: 'Webhook signing secret (whsec_…)' },
  notchpay: { label: 'Notch Pay (MTN MoMo and Orange Money, Cameroon)', needsWebhookSecret: true, secretHint: 'Public key (pk.…) from Settings › Developer', webhookHint: 'Webhook hash from Settings › Webhooks' },
};
