/**
 * Rule-based reading of customer messages in English, French and West/Central African
 * Pidgin. Deliberately conservative: when unsure it returns nothing and the seller
 * replies by hand. An LLM classifier can replace detectProduct later behind the same
 * signature, which is how more languages get covered.
 */

export interface CatalogItem {
  id: string;
  name: string;
  variant: string;
  aliases: string[];
}

const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'in', 'of', 'for', 'and', 'or', 'with', 'is', 'are', 'do', 'you', 'have', 'it', 'this', 'that',
  'inch', 'inches', 'size', 'colour', 'color', 'one', 'pls', 'please', 'still', 'any',
  // Pidgin
  'abeg', 'una', 'get', 'dey', 'e',
  // French
  'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'en', 'est', 'et', 'ou', 'vous', 'avez', 'tu', 'as', 'encore',
  'pour', 'avec', 'svp', 'stp', 'pouce', 'pouces', 'taille', 'couleur', 'il', 'reste', 'ce', 'ca', 'cette', 'disponible', 'dispo',
]);

/** Lowercase, strip accents and punctuation: "Marron?" → "marron", "Mèche" → "meche". */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const tokens = (s: string) =>
  fold(s).replace(/["”“'’]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOPWORDS.has(t));

// Ways of asking "is it available?"
const AVAILABILITY = new RegExp(
  [
    // English
    'do you (still )?have', 'have you got', 'is (it|this|the .+) (still )?available', 'available', 'in stock', 'back in stock',
    'restock(ed)?', 'is there any', 'any .+ left', 'sold out',
    // Pidgin
    'una (still )?get', 'you get', 'e (still )?dey',
    // French (accents already folded)
    'vous avez', 'avez[- ]vous', 'tu as', 'as[- ]tu', 'c ?est dispo', 'disponible', 'dispo', 'en stock', 'il (en )?reste',
    'y ?a encore', 'il y a encore', 'rupture',
  ].map((p) => `\\b${p}\\b`).join('|'),
  'i',
);

// Words that mark a message as French or English. Pidgin counts as English: the English
// copy reads naturally to Pidgin speakers. Product names are left out on purpose, since
// French speakers often use English names ("claw clip", "bonnet").
const FRENCH = new Set([
  'bonjour', 'bonsoir', 'salut', 'merci', 'oui', 'ouais', 'non', 'vous', 'avez', 'tu', 'est', 'sont', 'c', 'je', 'j',
  'voudrais', 'veux', 'combien', 'prix', 'encore', 'svp', 'stp', 'quand', 'pourquoi', 'comment', 'avec', 'mais', 'pas',
  'le', 'la', 'les', 'des', 'du', 'une', 'un', 'moi', 'ca', 'reste', 'disponible', 'dispo', 'est-ce', 'quoi', 'votre',
  'mon', 'ma', 'mes', 'pour', 'aussi', 'bien', 'daccord', 'accord', 'cest', 'il', 'elle', 'nous', 'coute',
]);
const ENGLISH = new Set([
  'hello', 'hi', 'hey', 'good', 'morning', 'evening', 'thanks', 'thank', 'yes', 'yeah', 'no', 'you', 'have', 'is', 'it',
  'the', 'how', 'much', 'price', 'i', 'want', 'would', 'like', 'available', 'still', 'please', 'pls', 'when', 'why',
  'with', 'but', 'not', 'do', 'any', 'left', 'me', 'my', 'your', 'can', 'get', 'what', 'where', 'there', 'okay', 'sure',
  'abeg', 'una', 'dey', 'wetin', 'na', 'sabi',
]);

/** The language a message is written in, or null when it gives no clear sign ("ok", "?", "👍"). */
export function detectLanguage(text: string): 'en' | 'fr' | null {
  const words = fold(text).replace(/["”“'’]/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FRENCH.has(w)) fr++;
    if (ENGLISH.has(w)) en++;
  }
  if (fr === en) return null;
  return fr > en ? 'fr' : 'en';
}

export function asksAvailability(text: string): boolean {
  return AVAILABILITY.test(fold(text).replace(/[’']/g, ' '));
}

/**
 * Pick the catalog item a message is about. Requires at least two name/alias words to
 * match, and when several variants share a name, the variant word must appear.
 */
export function detectProduct<T extends CatalogItem>(text: string, catalog: T[]): T | null {
  const words = new Set(tokens(text));
  const scored = catalog.map((item) => {
    const nameWords = new Set([...tokens(item.name), ...item.aliases.flatMap(tokens)]);
    const nameHits = [...nameWords].filter((w) => words.has(w)).length;
    // "Marron / Brown": either spelling counts.
    const variantHit = item.variant.split('/').some((alt) => {
      const vw = tokens(alt);
      return vw.length > 0 && vw.every((w) => words.has(w));
    });
    return { item, nameHits, variantHit, score: nameHits + (variantHit ? 2 : 0) };
  });
  const viable = scored.filter((s) => s.nameHits >= 2 || (s.nameHits >= 1 && s.variantHit));
  if (!viable.length) return null;
  viable.sort((a, b) => b.score - a.score);
  const best = viable[0];
  if (viable.filter((s) => s.score === best.score).length > 1) return null;
  const siblings = catalog.filter((c) => fold(c.name) === fold(best.item.name));
  if (siblings.length > 1 && !best.variantHit) return null;
  return best.item;
}

/**
 * A product that comes in several variants, named without saying which one ("vous avez le
 * claw clip ponytail ?"). Returns every variant of it, or null when the message names no
 * single product family.
 */
export function productFamily<T extends CatalogItem>(text: string, catalog: T[]): T[] | null {
  const words = new Set(tokens(text));
  const families = new Map<string, T[]>();
  for (const item of catalog) families.set(fold(item.name), [...(families.get(fold(item.name)) ?? []), item]);
  const named = [...families.values()].filter((items) => {
    const nameWords = new Set([...tokens(items[0].name), ...items.flatMap((i) => i.aliases.flatMap(tokens))]);
    const hits = [...nameWords].filter((w) => words.has(w)).length;
    return hits >= Math.min(2, tokens(items[0].name).length);
  });
  return named.length === 1 && named[0].length > 1 ? named[0] : null;
}

/** The one variant a reply picks out of a family ("jet black", "le noir"), or null. */
export function pickVariant<T extends CatalogItem>(text: string, family: T[]): T | null {
  const words = new Set(tokens(text));
  const picked = family.filter((item) =>
    item.variant.split('/').some((alt) => {
      const vw = tokens(alt);
      return vw.length > 0 && vw.every((w) => words.has(w));
    }),
  );
  return picked.length === 1 ? picked[0] : null;
}

export function isStop(text: string): boolean {
  return /^\s*(stop|unsubscribe|remove me|opt ?out|cancel alerts?|arret(e|er)?|desabonne(r|z)?( moi)?|retirez[- ]moi|desinscri(re|vez)[- ]moi)\b/i.test(fold(text));
}

/** A clear yes to "want an alert?". Anything hedged ("yes but how much", "oui mais c'est combien") is not consent. */
export function isConsentYes(text: string): boolean {
  const t = fold(text).replace(/[’']/g, ' ').trim();
  if (/\b(but|how much|price|no|not|mais|combien|prix|non|pas)\b/.test(t)) return false;
  return /^(yes|yeah|yea|yep|ok|okay|sure|please do|alert me|notify me|abeg yes|yes o|oui|ouais|ouai|d ?accord|dac|bien sur|volontiers|oui svp|oui stp)\b/.test(t);
}
