/**
 * Rule-based reading of customer messages. Deliberately conservative: when unsure it
 * returns nothing and the seller replies by hand. An LLM classifier can replace
 * detectProduct later behind the same signature.
 */

export interface CatalogItem {
  id: string;
  name: string;
  variant: string;
  aliases: string[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'of', 'for', 'and', 'or', 'with', 'is', 'are', 'do', 'you', 'have', 'it', 'this', 'that',
  'inch', 'inches', 'size', 'colour', 'color', 'one', 'pls', 'please', 'abeg', 'still', 'any',
]);

const tokens = (s: string) =>
  s.toLowerCase().replace(/["”“']/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOPWORDS.has(t));

// English and Pidgin ways of asking "is it available?"
const AVAILABILITY =
  /\b(do you (still )?have|have you got|is (it|this|the .+) (still )?available|available|in stock|back in stock|restock(ed)?|una (still )?get|you get|e (still )?dey|is there any|any .+ left|sold out)\b/i;

export function asksAvailability(text: string): boolean {
  return AVAILABILITY.test(text);
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
  const tied = viable.filter((s) => s.score === best.score);
  if (tied.length > 1) return null;
  const siblings = catalog.filter((c) => c.name.toLowerCase() === best.item.name.toLowerCase());
  if (siblings.length > 1 && !best.variantHit) return null;
  return best.item;
}

export function isStop(text: string): boolean {
  return /^\s*(stop|unsubscribe|remove me|opt ?out|cancel alerts?)\b/i.test(text);
}

/** A clear yes to "want an alert?". Anything hedged ("yes but how much") is not consent. */
export function isConsentYes(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/\b(but|how much|price|no|not)\b/.test(t)) return false;
  return /^(yes|yeah|yea|yep|ok|okay|sure|please do|alert me|notify me|abeg yes|yes o)\b/.test(t);
}
