/**
 * Meta messaging windows. WhatsApp allows free-form replies for 24 hours after the
 * customer's last message; after that only an approved template can be sent.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export function whatsappWindowOpen(lastInboundAt: Date | null | undefined, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < DAY_MS;
}

/** How long a "want an alert?" question stays answerable. */
export const CONSENT_PROMPT_TTL_MS = DAY_MS;
