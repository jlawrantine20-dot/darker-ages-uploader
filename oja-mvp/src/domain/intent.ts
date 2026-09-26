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
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
    const variantWords = tokens(item.variant);
    const variantHit = variantWords.length > 0 && variantWords.every((w) => words.has(w));
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

export function isStop(text: string): boolean {
  return /^\s*(stop|unsubscribe|remove me|opt ?out|cancel alerts?|arret(e|er)?|desabonne(r|z)?( moi)?|retirez[- ]moi|desinscri(re|vez)[- ]moi)\b/i.test(fold(text));
}

/** A clear yes to "want an alert?". Anything hedged ("yes but how much", "oui mais c'est combien") is not consent. */
export function isConsentYes(text: string): boolean {
  const t = fold(text).replace(/[’']/g, ' ').trim();
  if (/\b(but|how much|price|no|not|mais|combien|prix|non|pas)\b/.test(t)) return false;
  return /^(yes|yeah|yea|yep|ok|okay|sure|please do|alert me|notify me|abeg yes|yes o|oui|ouais|ouai|d ?accord|dac|bien sur|volontiers|oui svp|oui stp)\b/.test(t);
}
