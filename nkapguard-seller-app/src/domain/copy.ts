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
  /** For "which one?": each variant of a product and how many are free to sell. */
  options?: { variant: string; free: number }[];
  /** Units in a chat order. */
  quantity?: number;
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
  options: string;
  quantity: number;
}

export type Key =
  | 'whichVariant' | 'offerWhatsApp' | 'soldOutPlain' | 'commentReply' | 'offerAlert' | 'inStock' | 'joined' | 'alreadyWaiting' | 'stopped'
  | 'hold' | 'race' | 'soldOut' | 'paid' | 'refund'
  | 'orderLink' | 'orderManual' | 'orderAgain' | 'orderShort' | 'orderRefund';
type Sentences = Record<Key, (a: Args) => string> & { fallbackName: string };

// Each language is written as a native speaker would text a customer, not translated line by
// line. French uses "vous" and "le modèle …", which reads correctly whatever the product's own
// gender. Template messages (hold, race, soldOut, paid, refund) are fixed text on Meta's side,
// so they avoid wording that changes with a number ("1 personne" / "2 personnes").
const en: Sentences = {
  fallbackName: 'there',
  whichVariant: (a) => `Hi ${a.first}, the ${a.label} comes in ${a.options}. Which one would you like?`,
  offerWhatsApp: (a) =>
    `Hi ${a.first}, the ${a.label} is sold out at the moment. We send restock alerts on WhatsApp: open this link and send the message, and we'll let you know as soon as it's back.\n${a.url}`,
  soldOutPlain: (a) => `Hi ${a.first}, the ${a.label} is sold out at the moment.`,
  commentReply: (a) => `Hi ${a.first}, thanks for your comment! Here's everything we sell, with prices and what's in stock:\n${a.url}\nAsk us anything here.`,
  offerAlert: (a) =>
    `Hi ${a.first}, the ${a.label} is sold out at the moment. Want us to message you here as soon as it's back? Just reply YES. (Reply STOP anytime to opt out.)`,
  inStock: (a) =>
    `Hi ${a.first}, yes, we have the ${a.label} in stock at ${a.price}. ${a.stock === 1 ? "It's the last one!" : `We've got ${a.stock} left.`} To order, just reply YES.`,
  orderLink: (a) =>
    `Great, ${a.quantity > 1 ? `${a.quantity} × ${a.label} are` : `the ${a.label} is`} yours! We're holding ${a.quantity > 1 ? 'them' : 'it'} for you until ${a.until}. Pay ${a.price} here to confirm your order:\n${a.url}`,
  orderManual: (a) =>
    `Great, noted! We're keeping ${a.quantity > 1 ? `${a.quantity} × ${a.label}` : `the ${a.label}`} aside for you until ${a.until}. We'll message you shortly to arrange payment (${a.price}).`,
  orderAgain: (a) => `Your ${a.label} is already held for you until ${a.until}. Pay ${a.price} here to confirm:\n${a.url}`,
  orderShort: (a) => `We only have ${a.stock} left of the ${a.label}. How many would you like?`,
  orderRefund: (a) =>
    `We received your payment, but the ${a.label} sold out after your hold ended. We're refunding you in full. Sorry about that!`,
  joined: (a) =>
    `You're on the list! You're #${a.position} for the ${a.label}, and we'll message you here as soon as it's back. Reply STOP anytime to leave the list.`,
  alreadyWaiting: (a) => `You're already on the list for the ${a.label} (#${a.position}). We'll let you know as soon as it's back.`,
  stopped: (a) => `Done, you won't get any more alerts from ${a.seller}. Feel free to message us anytime.`,
  hold: (a) =>
    `Hi ${a.first}, good news: the ${a.label} is back! Units in: ${a.units}. People waiting: ${a.waiting}. We're holding one for you until ${a.until}. Pay ${a.price} here to secure it: ${a.url} (Reply STOP to leave the list.)`,
  race: (a) =>
    `Hi ${a.first}, good news: the ${a.label} is back! Units in: ${a.units}. People notified: ${a.told}. The first to pay ${a.price} gets it: ${a.url} (Reply STOP to leave the list.)`,
  soldOut: (a) =>
    `Sorry ${a.first}, the ${a.label} sold out before your payment came through. You're still on the list, and we'll let you know about the next restock.`,
  paid: (a) => `Payment received, thank you! The ${a.label} is yours. We'll be in touch shortly about delivery.`,
  refund: (a) =>
    `We received your payment, but the last ${a.label} sold just moments before. We're refunding you in full, and you keep your place on the list.`,
};

const fr: Sentences = {
  fallbackName: 'cher client',
  whichVariant: (a) => `Bonjour ${a.first} ! Le modèle ${a.label} existe en ${a.options}. Lequel souhaitez-vous ?`,
  offerWhatsApp: (a) =>
    `Bonjour ${a.first} ! Le modèle ${a.label} est momentanément en rupture de stock. Nos alertes de retour passent par WhatsApp : ouvrez ce lien et envoyez le message, nous vous préviendrons dès son retour.\n${a.url}`,
  soldOutPlain: (a) => `Bonjour ${a.first} ! Le modèle ${a.label} est momentanément en rupture de stock.`,
  commentReply: (a) => `Bonjour ${a.first}, merci pour votre commentaire ! Voici tous nos articles, avec les prix et la disponibilité :\n${a.url}\nPosez-nous vos questions ici.`,
  offerAlert: (a) =>
    `Bonjour ${a.first} ! Le modèle ${a.label} est momentanément en rupture de stock. Souhaitez-vous que nous vous prévenions ici dès son retour ? Répondez simplement OUI. (Répondez STOP à tout moment pour ne plus recevoir de messages.)`,
  inStock: (a) =>
    `Bonjour ${a.first} ! Oui, le modèle ${a.label} est disponible au prix de ${a.price}. ${a.stock === 1 ? "C'est le dernier !" : `Il nous en reste ${a.stock}.`} Pour le commander, répondez simplement OUI.`,
  orderLink: (a) =>
    `Parfait, ${a.quantity > 1 ? `c'est noté pour ${a.quantity} × ${a.label}` : `le modèle ${a.label} est à vous`} ! Nous vous ${a.quantity > 1 ? 'les' : 'le'} réservons jusqu'à ${a.until}. Réglez ${a.price} ici pour confirmer votre commande :\n${a.url}`,
  orderManual: (a) =>
    `Parfait, c'est noté ! Nous vous mettons ${a.quantity > 1 ? `${a.quantity} × ${a.label}` : `le modèle ${a.label}`} de côté jusqu'à ${a.until}. Nous vous écrivons très vite pour le paiement (${a.price}).`,
  orderAgain: (a) => `Le modèle ${a.label} vous est déjà réservé jusqu'à ${a.until}. Réglez ${a.price} ici pour confirmer :\n${a.url}`,
  orderShort: (a) => `Il ne nous en reste que ${a.stock} pour le modèle ${a.label}. Combien en voulez-vous ?`,
  orderRefund: (a) =>
    `Nous avons bien reçu votre paiement, mais le modèle ${a.label} a été vendu après la fin de votre réservation. Nous vous remboursons intégralement. Toutes nos excuses !`,
  joined: (a) =>
    `C'est noté ! Vous êtes n°${a.position} sur la liste d'attente du modèle ${a.label}. Nous vous écrirons ici dès son retour. Pour quitter la liste, répondez STOP.`,
  alreadyWaiting: (a) => `Vous êtes déjà sur la liste d'attente du modèle ${a.label} (n°${a.position}). Nous vous prévenons dès son retour.`,
  stopped: (a) => `C'est fait : vous ne recevrez plus d'alertes de ${a.seller}. N'hésitez pas à nous écrire à tout moment.`,
  hold: (a) =>
    `Bonjour ${a.first}, bonne nouvelle : le modèle ${a.label} est de retour ! Arrivage : ${a.units}. Personnes en attente : ${a.waiting}. Nous vous en réservons un jusqu'à ${a.until}. Pour le garder, réglez ${a.price} ici : ${a.url} (Répondez STOP pour quitter la liste.)`,
  race: (a) =>
    `Bonjour ${a.first}, bonne nouvelle : le modèle ${a.label} est de retour ! Arrivage : ${a.units}. Personnes prévenues : ${a.told}. Le premier à régler ${a.price} l'emporte : ${a.url} (Répondez STOP pour quitter la liste.)`,
  soldOut: (a) =>
    `Désolés ${a.first}, le modèle ${a.label} est parti avant votre paiement. Vous restez sur la liste et nous vous préviendrons au prochain arrivage.`,
  paid: (a) => `Paiement bien reçu, merci ! Le modèle ${a.label} est à vous. Nous revenons très vite vers vous pour la livraison.`,
  refund: (a) =>
    `Nous avons bien reçu votre paiement, mais le dernier modèle ${a.label} a été vendu quelques instants plus tôt. Nous vous remboursons intégralement, et vous gardez votre place sur la liste.`,
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

/** "brown (sold out) or jet black (6 in stock)"; "marron (en rupture) ou noir (6 en stock)". */
function options(l: Base, list: { variant: string; free: number }[]): string {
  const items = list.map(({ variant, free }) => {
    const [frName, enName] = variantParts(variant);
    const name = (l === 'fr' ? frName : enName).toLowerCase();
    if (l === 'fr') return `${name} (${free > 0 ? `${free} en stock` : 'en rupture'})`;
    return `${name} (${free > 0 ? `${free} in stock` : 'sold out'})`;
  });
  return new Intl.ListFormat(l, { type: 'disjunction' }).format(items);
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
    options: options(l, f.options ?? []),
    quantity: f.quantity ?? 1,
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

/**
 * The fixed text of a WhatsApp template, with {{1}}, {{2}}… where the slot values go, exactly
 * as it must be submitted to Meta. Bilingual templates number the English slots after the
 * French ones. Generated from the same sentences the app sends, so the two cannot drift.
 */
export function templateBody(lang: Lang | string, key: keyof typeof SLOTS): string {
  let n = 0;
  return parts(lang)
    .map((l) => {
      const fields = SLOTS[key](Object.fromEntries(Object.keys(args(l, {}, { currency: 'USD', country: 'US', timezone: 'UTC' })).map((k) => [k, k])) as unknown as Args);
      const a = Object.fromEntries(fields.map((field) => [field, `{{${++n}}}`])) as unknown as Args;
      return SENTENCES[l][key](a);
    })
    .join(BILINGUAL_SEPARATOR);
}
