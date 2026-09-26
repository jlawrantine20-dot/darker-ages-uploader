import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentLinkRequest {
  reference: string;
  amountKobo: number;
  /** Paystack requires an email; WhatsApp buyers often have none, so callers pass a placeholder. */
  email: string;
  metadata: Record<string, string>;
}

/** Oja never holds money: links pay the seller's own Paystack account directly. */
export interface Payments {
  createLink(req: PaymentLinkRequest): Promise<{ url: string }>;
}

export function dryRunPayments(baseUrl: string): Payments {
  return { createLink: async (r) => ({ url: `${baseUrl.replace(/\/$/, '')}/pay/${r.reference}` }) };
}

export function paystack(opts: { secretKey: string; callbackUrl?: string; fetchFn?: typeof fetch }): Payments {
  const f = opts.fetchFn ?? fetch;
  return {
    async createLink(r) {
      const res = await f('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: r.email,
          amount: r.amountKobo,
          currency: 'NGN',
          reference: r.reference,
          metadata: r.metadata,
          ...(opts.callbackUrl ? { callback_url: opts.callbackUrl } : {}),
        }),
      });
      const json = (await res.json()) as { status: boolean; message: string; data?: { authorization_url: string } };
      if (!res.ok || !json.status || !json.data) throw new Error(`Paystack link failed: ${json.message}`);
      return { url: json.data.authorization_url };
    },
  };
}

/** Paystack signs webhooks with the secret key: x-paystack-signature = HMAC-SHA512 hex of the raw body. */
export function verifyPaystackSignature(rawBody: string, header: string | undefined, secretKey: string): boolean {
  if (!header || !secretKey) return false;
  const expected = createHmac('sha512', secretKey).update(rawBody, 'utf8').digest();
  const given = Buffer.from(header, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface PaymentEvent {
  reference: string;
  amountKobo: number;
}

export function parsePaystackEvent(body: unknown): PaymentEvent | null {
  const b = body as { event?: string; data?: { reference?: string; amount?: number; status?: string } };
  if (b?.event !== 'charge.success' || !b.data?.reference || b.data.status !== 'success') return null;
  return { reference: b.data.reference, amountKobo: Number(b.data.amount) };
}
