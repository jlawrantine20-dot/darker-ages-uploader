/**
 * Every customer-facing sentence, per language. Counts, prices and deadlines are always
 * passed in from live data (stock, waitlist, hold expiry); nothing here lets a seller type
 * a number, so scarcity claims stay true. Template bodies avoid singular/plural wording
 * because WhatsApp templates are fixed text with numbered slots.
 */
import type { Lang } from './markets.js';

export interface HoldArgs { first: string; label: string; units: number; waiting: number; until: string; price: string; url: string }
export interface RaceArgs { first: string; label: string; units: number; told: number; price: string; url: string }
export interface NameArgs { first: string; label: string }

export interface Copy {
  fallbackName: string;
  offerAlert(first: string, label: string): string;
  inStock(first: string, label: string, price: string, stock: number): string;
  joined(position: number, label: string): string;
  alreadyWaiting(position: number, label: string): string;
  stopped(seller: string): string;
  holdPreview(a: HoldArgs): string;
  racePreview(a: RaceArgs): string;
  soldOutPreview(a: NameArgs): string;
  paid(label: string): string;
  paidTooLate(label: string): string;
}

const en: Copy = {
  fallbackName: 'there',
  offerAlert: (first, label) =>
    `Hi ${first}, the ${label} is sold out right now. Want a message here the moment it's back? Reply YES to join the list. You can reply STOP any time.`,
  inStock: (first, label, price, stock) => `Hi ${first}, yes, the ${label} is available at ${price}. We have ${stock} left.`,
  joined: (pos, label) =>
    `Done. You're #${pos} on the list for the ${label}. We'll message you here when it lands. Reply STOP any time to leave the list.`,
  alreadyWaiting: (pos, label) => `You're already on the list for the ${label}, at #${pos}.`,
  stopped: (seller) => `You've been removed from all of ${seller}'s restock lists. You won't get more alerts.`,
  holdPreview: (a) =>
    `Hi ${a.first}, the ${a.label} is back. ${a.units} came in and the waiting list has ${a.waiting}. One is held for you until ${a.until}. Pay ${a.price} to keep it: ${a.url} Reply STOP to leave the list.`,
  racePreview: (a) =>
    `Hi ${a.first}, the ${a.label} is back. ${a.units} came in and we're telling the first ${a.told} on the list. First to pay ${a.price} gets one: ${a.url} Reply STOP to leave the list.`,
  soldOutPreview: (a) => `Sorry ${a.first}, the ${a.label} sold out before you got one. You're still on the list for the next restock.`,
  paid: (label) => `Payment received, thank you. Your ${label} is yours. We'll message you about delivery.`,
  paidTooLate: (label) =>
    `We received your payment, but the last ${label} sold a moment earlier. We're refunding you in full and you keep your place on the list.`,
};

const fr: Copy = {
  fallbackName: 'cher client',
  offerAlert: (first, label) =>
    `Bonjour ${first}, l'article « ${label} » est en rupture de stock pour le moment. Voulez-vous un message ici dès son retour ? Répondez OUI pour être sur la liste. Vous pouvez répondre STOP à tout moment.`,
  inStock: (first, label, price, stock) => `Bonjour ${first}, oui, l'article « ${label} » est disponible à ${price}. Il en reste ${stock}.`,
  joined: (pos, label) =>
    `C'est noté. Vous êtes n°${pos} sur la liste pour « ${label} ». Nous vous écrirons ici dès son arrivée. Répondez STOP à tout moment pour quitter la liste.`,
  alreadyWaiting: (pos, label) => `Vous êtes déjà sur la liste pour « ${label} », en position n°${pos}.`,
  stopped: (seller) => `Vous avez été retiré(e) de toutes les listes d'attente de ${seller}. Vous ne recevrez plus d'alertes.`,
  holdPreview: (a) =>
    `Bonjour ${a.first}, l'article « ${a.label} » est de retour. Arrivage : ${a.units} pièce(s), liste d'attente : ${a.waiting} personne(s). Une pièce vous est réservée jusqu'à ${a.until}. Payez ${a.price} pour la garder : ${a.url} Répondez STOP pour quitter la liste.`,
  racePreview: (a) =>
    `Bonjour ${a.first}, l'article « ${a.label} » est de retour. Arrivage : ${a.units} pièce(s). Nous prévenons les ${a.told} premières personnes de la liste. Le premier à payer ${a.price} l'obtient : ${a.url} Répondez STOP pour quitter la liste.`,
  soldOutPreview: (a) =>
    `Désolé ${a.first}, l'article « ${a.label} » a été vendu avant votre paiement. Vous gardez votre place sur la liste pour le prochain arrivage.`,
  paid: (label) => `Paiement reçu, merci ! L'article « ${label} » est à vous. Nous vous écrirons pour la livraison.`,
  paidTooLate: (label) =>
    `Nous avons reçu votre paiement, mais le dernier article « ${label} » venait d'être vendu. Nous vous remboursons intégralement et vous gardez votre place sur la liste.`,
};

export const COPY: Record<Lang, Copy> = { en, fr };
export const copyFor = (lang: string): Copy => COPY[lang as Lang] ?? en;

/** Template slot values, in order. The same order is used for every language. */
export const params = {
  hold: (a: HoldArgs) => [a.first, a.label, String(a.units), String(a.waiting), a.until, a.price, a.url],
  race: (a: RaceArgs) => [a.first, a.label, String(a.units), String(a.told), a.price, a.url],
  soldOut: (a: NameArgs) => [a.first, a.label],
  label: (label: string) => [label],
};

/** "brown 12" Claw Clip Ponytail" in English; "12" Claw Clip Ponytail marron" in French. */
export function productLabel(p: { name: string; variant: string }, lang = 'en'): string {
  if (!p.variant) return p.name;
  return lang === 'fr' ? `${p.name} ${p.variant.toLowerCase()}` : `${p.variant.toLowerCase()} ${p.name}`;
}

export function firstName(name: string | null | undefined, lang = 'en'): string {
  return (name ?? '').trim().split(/\s+/)[0] || copyFor(lang).fallbackName;
}

/** "12:00 PM" in English, "12:00" in French, in the shop's time zone. */
export function clockTime(d: Date, timezone: string, lang = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr' : 'en', { hour: 'numeric', minute: '2-digit', hour12: lang !== 'fr', timeZone: timezone })
    .format(d)
    .toUpperCase()
    .replace(/\s+/g, ' ');
}
