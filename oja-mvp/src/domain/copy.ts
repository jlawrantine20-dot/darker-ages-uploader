/**
 * Every customer-facing sentence lives here. Numbers are always passed in from live data
 * (stock, waitlist, hold expiry); nothing here lets a seller type a count, so scarcity
 * claims stay true (FCCPA s.123).
 */

export const naira = (kobo: number) => '₦' + Math.round(kobo / 100).toLocaleString('en-NG');

export const productLabel = (p: { name: string; variant: string }) =>
  p.variant ? `${p.variant.toLowerCase()} ${p.name}` : p.name;

export function clockTime(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
    .format(d)
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';

export const copy = {
  offerAlert: (first: string, label: string) =>
    `Hi ${first}, the ${label} is sold out right now. Want a message here the moment it's back? Reply YES to join the list. You can reply STOP any time.`,

  inStock: (first: string, label: string, priceKobo: number, stock: number) =>
    `Hi ${first}, yes, the ${label} is available at ${naira(priceKobo)}. We have ${stock} left.`,

  joined: (position: number, label: string) =>
    `Done. You're #${position} on the list for the ${label}. We'll message you here when it lands. Reply STOP any time to leave the list.`,

  alreadyWaiting: (position: number, label: string) => `You're already on the list for the ${label}, at #${position}.`,

  stopped: (seller: string) => `You've been removed from all of ${seller}'s restock lists. You won't get more alerts.`,

  /** Template body params, in order, for restock_hold_v1. */
  holdParams: (a: { first: string; label: string; units: number; waiting: number; until: string; price: string; url: string }) => [
    a.first, a.label, String(a.units), String(a.waiting), a.until, a.price, a.url,
  ],
  holdPreview: (a: { first: string; label: string; units: number; waiting: number; until: string; price: string; url: string }) =>
    `Hi ${a.first}, the ${a.label} is back. ${a.units} came in and ${a.waiting} people are waiting. One is held for you until ${a.until}. Pay ${a.price} to keep it: ${a.url} Reply STOP to leave the list.`,

  raceParams: (a: { first: string; label: string; units: number; told: number; price: string; url: string }) => [
    a.first, a.label, String(a.units), String(a.told), a.price, a.url,
  ],
  racePreview: (a: { first: string; label: string; units: number; told: number; price: string; url: string }) =>
    `Hi ${a.first}, the ${a.label} is back. ${a.units} came in and we're telling the first ${a.told} people on the list. First to pay ${a.price} gets one: ${a.url} Reply STOP to leave the list.`,

  soldOutParams: (a: { first: string; label: string }) => [a.first, a.label],
  soldOutPreview: (a: { first: string; label: string }) =>
    `Sorry ${a.first}, the ${a.label} sold out before you got one. You're still on the list for the next restock.`,

  paid: (label: string) => `Payment received, thank you. Your ${label} is yours. We'll message you about delivery.`,
  paidParams: (label: string) => [label],

  paidTooLate: (label: string) =>
    `We received your payment, but the last ${label} sold a moment earlier. We're refunding you in full and you keep your place on the list.`,
  paidTooLateParams: (label: string) => [label],
};
