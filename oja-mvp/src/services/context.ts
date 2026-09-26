import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Channel } from '../channels/whatsapp.js';
import type { Payments } from '../payments/paystack.js';

export interface Ctx {
  db: Db;
  channel: Channel;
  payments: Payments;
  config: Config;
}

export interface Recipient {
  sellerId: string;
  /** Seller's WhatsApp Cloud API phone number id. */
  from: string;
  contactId: string;
  /** Customer's WhatsApp id. */
  to: string;
  lastInboundAt: Date | null;
}

export type TemplateKey = 'hold' | 'race' | 'soldOut' | 'paid' | 'refund';

export interface TemplatePart {
  template: TemplateKey;
  category: 'utility' | 'marketing';
  params: string[];
  /** What the customer will read, for logs and the seller's inbox. */
  preview: string;
}

export type Outbound =
  | (Recipient & {
      kind: 'text';
      body: string;
      /** Sent instead when the 24h window has closed. Without one, the message is skipped. */
      fallback?: TemplatePart;
    })
  | (Recipient & { kind: 'template' } & TemplatePart);

export interface DispatchResult {
  to: string;
  status: 'sent' | 'window_closed' | 'failed';
  body: string;
  costKobo: number;
  error?: string;
}
