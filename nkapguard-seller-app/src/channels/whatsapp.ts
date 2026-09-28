import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SendResult {
  providerId: string;
}

export interface TemplateMessage {
  name: string;
  language: string;
  params: string[];
  /** Parameter for the template's first URL button, e.g. the copy-code button of a sign-in template. */
  buttonParams?: string[];
}

/** Outbound WhatsApp. `from` is the seller's Cloud API phone number id. */
export interface Channel {
  sendText(from: string, to: string, body: string): Promise<SendResult>;
  sendTemplate(from: string, to: string, t: TemplateMessage): Promise<SendResult>;
  /** A photo with the text as its caption. Only inside the 24-hour window, like text. */
  sendImage(from: string, to: string, imageUrl: string, caption: string): Promise<SendResult>;
}

export interface SentRecord {
  from: string;
  to: string;
  kind: 'text' | 'template' | 'image';
  body?: string;
  imageUrl?: string;
  template?: TemplateMessage;
}

/** Records messages instead of sending them. Used in tests, the simulator and DRY_RUN mode. */
export class DryRunChannel implements Channel {
  sent: SentRecord[] = [];
  private n = 0;
  constructor(private onSend?: (m: SentRecord) => void) {}
  private record(m: SentRecord) {
    this.sent.push(m);
    this.onSend?.(m);
    return { providerId: `dry-${++this.n}` };
  }
  async sendText(from: string, to: string, body: string) {
    return this.record({ from, to, kind: 'text', body });
  }
  async sendTemplate(from: string, to: string, template: TemplateMessage) {
    return this.record({ from, to, kind: 'template', template });
  }
  async sendImage(from: string, to: string, imageUrl: string, caption: string) {
    return this.record({ from, to, kind: 'image', body: caption, imageUrl });
  }
}

export function whatsappCloud(opts: { token: string; apiVersion: string; fetchFn?: typeof fetch }): Channel {
  const f = opts.fetchFn ?? fetch;
  async function post(from: string, payload: unknown): Promise<SendResult> {
    const res = await f(`https://graph.facebook.com/${opts.apiVersion}/${from}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string; code: number } };
    if (!res.ok || !json.messages?.[0]) {
      throw new Error(`WhatsApp send failed (${res.status}): ${json.error?.message ?? 'no message id returned'}`);
    }
    return { providerId: json.messages[0].id };
  }
  return {
    sendText: (from, to, body) =>
      post(from, { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: true } }),
    sendImage: (from, to, imageUrl, caption) =>
      post(from, { messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption: caption.slice(0, 1024) } }),
    sendTemplate: (from, to, t) =>
      post(from, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: t.name,
          language: { code: t.language },
          components: [
            { type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) },
            ...(t.buttonParams?.length
              ? [{ type: 'button', sub_type: 'url', index: '0', parameters: t.buttonParams.map((text) => ({ type: 'text', text })) }]
              : []),
          ],
        },
      }),
  };
}

export interface InboundText {
  phoneNumberId: string;
  from: string;
  name?: string;
  text: string;
  providerId: string;
  at: Date;
}

/** Pull customer text messages (and button taps) out of a Cloud API webhook payload. */
export function parseWebhook(body: unknown): InboundText[] {
  const out: InboundText[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: any }[] }[]) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneNumberId: string | undefined = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const names = new Map<string, string>(
        (v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name] as [string, string]),
      );
      for (const m of v.messages ?? []) {
        const text: string | undefined =
          m.type === 'text' ? m.text?.body
          : m.type === 'button' ? m.button?.text
          : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title)
          : undefined;
        if (!text) continue;
        out.push({
          phoneNumberId,
          from: m.from,
          name: names.get(m.from),
          text,
          providerId: m.id,
          at: new Date(Number(m.timestamp) * 1000),
        });
      }
    }
  }
  return out;
}

/** Meta signs webhook bodies with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
