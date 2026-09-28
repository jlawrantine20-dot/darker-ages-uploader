import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Channel } from '../channels/whatsapp.js';
import type { SocialChannel, SocialSender } from '../channels/meta.js';
import type { makeProvider } from '../payments/providers.js';

export interface Ctx {
  db: Db;
  channel: Channel;
  /** Instagram and Messenger; defaults to Meta's Graph API, or a recorder in test mode. */
  social?: SocialSender;
  config: Config;
  /** Swappable in tests; defaults to the global fetch. Used for Meta sign-in calls. */
  fetch?: typeof fetch;
  /** Swappable in tests; defaults to the real providers. */
  providerFactory?: typeof makeProvider;
}

export interface Recipient {
  sellerId: string;
  /** WhatsApp: the seller's Cloud API phone number id. Instagram/Messenger: the channel_accounts row id. */
  from: string;
  contactId: string;
  /** The customer's id on the channel: a WhatsApp number, or an Instagram/Page-scoped id. */
  to: string;
  /** Defaults to WhatsApp. */
  channel?: 'whatsapp' | SocialChannel;
  /** Instagram/Messenger: answer this comment with a private reply instead of a chat message. */
  commentId?: string;
  lastInboundAt: Date | null;
  /** Seller's country and language decide the fee estimate and template language. */
  country: string;
  language: string;
}

export type TemplateKey = 'hold' | 'race' | 'soldOut' | 'paid' | 'refund' | 'priceDrop';

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
      /** A product photo sent with the text (as its caption on WhatsApp). Inside the window only. */
      imageUrl?: string;
      /** Sent instead when the 24h window has closed. Without one, the message is skipped. */
      fallback?: TemplatePart;
    })
  | (Recipient & { kind: 'template' } & TemplatePart);

export interface DispatchResult {
  to: string;
  status: 'sent' | 'window_closed' | 'failed';
  body: string;
  costUsdMicros: number;
  error?: string;
}
