/**
 * Every customer-facing sentence, per language. Callers pass raw facts (the product, the
 * price in minor units, the hold deadline); each language formats them its own way, so a
 * bilingual message reads naturally in both halves. Counts, prices and deadlines always
 * come from live data, never from something the seller types, so scarcity claims stay true.
 * Template bodies avoid singular/plural wording because WhatsApp templates are fixed text.
 */
import type { Lang } from './markets.js';
import { formatMoney } from './money.js';

/** A single-language message set. The bilingual option combines two of these. */
export type Base = 'en' | 'fr';

export interface Facts {
  /** Customer's name as WhatsApp gives it; the first word is used. */
  name?: string | null;
  product?: { name: string; variant: string };
  priceMinor?: number;
  units?: number;
  waiting?: number;
  told?: number;
  until?: Date;
  url?: string;
  position?: number;
  stock?: number;
  seller?: string;
}

/** Shop settings needed to format money and time. */
export interface Fmt {
  currency: string;
  country: string;
  timezone: string;
}

interface Args {
  first: string;
  label: string;
  price: string;
  until: string;
  units: number;
  waiting: number;
  told: number;
  url: string;
  position: number;
  stock: number;
  seller: string;
}

export type Key = 'offerAlert' | 'inStock' | 'joined' | 'alreadyWaiting' | 'stopped' | 'hold' | 'race' | 'soldOut' | 'paid' | 'refund';
type Sentences = Record<Key, (a: Args) => string> & { fallbackName: string };

const en: Sentences = {
  fallbackName: 'there',
  offerAlert: (a) =>
    `Hi ${a.first}, the ${a.label} is sold out right now. Want a message here the moment it's back? Reply YES to join the list. You can reply STOP any time.`,
  inStock: (a) => `Hi ${a.first}, yes, the ${a.label} is available at ${a.price}. We have ${a.stock} left.`,
  joined: (a) =>
    `Done. You're #${a.position} on the list for the ${a.label}. We'll message you here when it lands. Reply STOP any time to leave the list.`,
  alreadyWaiting: (a) => `You're already on the list for the ${a.label}, at #${a.position}.`,
  stopped: (a) => `You've been removed from all of ${a.seller}'s restock lists. You won't get more alerts.`,
  hold: (a) =>
    `Hi ${a.first}, the ${a.label} is back. ${a.units} came in and the waiting list has ${a.waiting}. One is held for you until ${a.until}. Pay ${a.price} to keep it: ${a.url} Reply STOP to leave the list.`,
  race: (a) =>
    `Hi ${a.first}, the ${a.label} is back. ${a.units} came in and we're telling the first ${a.told} on the list. First to pay ${a.price} gets one: ${a.url} Reply STOP to leave the list.`,
  soldOut: (a) => `Sorry ${a.first}, the ${a.label} sold out before you got one. You're still on the list for the next restock.`,
  paid: (a) => `Payment received, thank you. Your ${a.label} is yours. We'll message you about delivery.`,
  refund: (a) =>
    `We received your payment, but the last ${a.label} sold a moment earlier. We're refunding you in full and you keep your place on the list.`,
};

const fr: Sentences = {
  fallbackName: 'cher client',
  offerAlert: (a) =>
    `Bonjour ${a.first}, l'article « ${a.label} » est en rupture de stock pour le moment. Voulez-vous un message ici dès son retour ? Répondez OUI pour être sur la liste. Vous pouvez répondre STOP à tout moment.`,
  inStock: (a) => `Bonjour ${a.first}, oui, l'article « ${a.label} » est disponible à ${a.price}. Il en reste ${a.stock}.`,
  joined: (a) =>
    `C'est noté. Vous êtes n°${a.position} sur la liste pour « ${a.label} ». Nous vous écrirons ici dès son arrivée. Répondez STOP à tout moment pour quitter la liste.`,
  alreadyWaiting: (a) => `Vous êtes déjà sur la liste pour « ${a.label} », en position n°${a.position}.`,
  stopped: (a) => `Vous avez été retiré(e) de toutes les listes d'attente de ${a.seller}. Vous ne recevrez plus d'alertes.`,
  hold: (a) =>
    `Bonjour ${a.first}, l'article « ${a.label} » est de retour. Arrivage : ${a.units} pièce(s), liste d'attente : ${a.waiting} personne(s). Une pièce vous est réservée jusqu'à ${a.until}. Payez ${a.price} pour la garder : ${a.url} Répondez STOP pour quitter la liste.`,
  race: (a) =>
    `Bonjour ${a.first}, l'article « ${a.label} » est de retour. Arrivage : ${a.units} pièce(s). Nous prévenons les ${a.told} premières personnes de la liste. Le premier à payer ${a.price} l'obtient : ${a.url} Répondez STOP pour quitter la liste.`,
  soldOut: (a) =>
    `Désolé ${a.first}, l'article « ${a.label} » a été vendu avant votre paiement. Vous gardez votre place sur la liste pour le prochain arrivage.`,
  paid: (a) => `Paiement reçu, merci ! L'article « ${a.label} » est à vous. Nous vous écrirons pour la livraison.`,
  refund: (a) =>
    `Nous avons reçu votre paiement, mais le dernier article « ${a.label} » venait d'être vendu. Nous vous remboursons intégralement et vous gardez votre place sur la liste.`,
};

const SENTENCES: Record<Base, Sentences> = { en, fr };

/** The languages a shop setting expands to, in the order they appear in a message. */
export function parts(lang: Lang | string): Base[] {
  if (lang === 'fr+en') return ['fr', 'en'];
  return lang === 'fr' ? ['fr'] : ['en'];
}

/** Separates the two halves of a bilingual message. */
export const BILINGUAL_SEPARATOR = '\n\n';

/**
 * "brown 12" Claw Clip Ponytail" in English; "12" Claw Clip Ponytail marron" in French.
 * A variant written "Marron / Brown" gives French the first word and English the second.
 */
export function productLabel(p: { name: string; variant: string }, lang: string = 'en'): string {
  if (!p.variant) return p.name;
  const [frVariant, enVariant] = variantParts(p.variant);
  return parts(lang)[0] === 'fr' ? `${p.name} ${frVariant.toLowerCase()}` : `${enVariant.toLowerCase()} ${p.name}`;
}

/** "Marron / Brown" → ["Marron", "Brown"]; "Brown" → ["Brown", "Brown"]. */
export function variantParts(variant: string): [string, string] {
  const [a, b] = variant.split('/').map((v) => v.trim());
  return [a, b || a];
}

export function firstName(name: string | null | undefined, lang: string = 'en'): string {
  return (name ?? '').trim().split(/\s+/)[0] || SENTENCES[parts(lang)[0]].fallbackName;
}

/** "12:00 PM" in English, "12:00" in French, in the shop's time zone. */
export function clockTime(d: Date, timezone: string, lang: string = 'en'): string {
  const french = parts(lang)[0] === 'fr';
  return new Intl.DateTimeFormat(french ? 'fr' : 'en', { hour: 'numeric', minute: '2-digit', hour12: !french, timeZone: timezone })
    .format(d)
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function args(l: Base, f: Facts, fmt: Fmt): Args {
  return {
    first: firstName(f.name, l),
    label: f.product ? productLabel(f.product, l) : '',
    price: f.priceMinor === undefined ? '' : formatMoney(f.priceMinor, fmt.currency, l, fmt.country),
    until: f.until ? clockTime(f.until, fmt.timezone, l) : '',
    units: f.units ?? 0,
    waiting: f.waiting ?? 0,
    told: f.told ?? 0,
    url: f.url ?? '',
    position: f.position ?? 0,
    stock: f.stock ?? 0,
    seller: f.seller ?? '',
  };
}

/** The message text in the shop's language; bilingual shops get French, then English. */
export function say(lang: Lang | string, key: Key, facts: Facts, fmt: Fmt): string {
  return parts(lang).map((l) => SENTENCES[l][key](args(l, facts, fmt))).join(BILINGUAL_SEPARATOR);
}

/** Slot values for each template, in order. */
const SLOTS: Record<'hold' | 'race' | 'soldOut' | 'paid' | 'refund', (a: Args) => string[]> = {
  hold: (a) => [a.first, a.label, String(a.units), String(a.waiting), a.until, a.price, a.url],
  race: (a) => [a.first, a.label, String(a.units), String(a.told), a.price, a.url],
  soldOut: (a) => [a.first, a.label],
  paid: (a) => [a.label],
  refund: (a) => [a.label],
};

/**
 * Template slot values. A bilingual template has the French slots first, then the English
 * ones, because names, prices and times are written differently in each half.
 */
export function slots(lang: Lang | string, key: keyof typeof SLOTS, facts: Facts, fmt: Fmt): string[] {
  return parts(lang).flatMap((l) => SLOTS[key](args(l, facts, fmt)));
}

/** Template name and WhatsApp language code for a shop language. Bilingual templates are registered under French. */
export function templateFor(baseName: string, lang: Lang | string): { name: string; language: string } {
  return lang === 'fr+en' ? { name: `${baseName}_bilingual`, language: 'fr' } : { name: baseName, language: parts(lang)[0] };
}
