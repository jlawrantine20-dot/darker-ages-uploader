import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalise a phone number to WhatsApp id form: country code + number, digits only, no '+'.
 * Local numbers are read in the shop's country: "6 77 12 34 56" in CM → 237677123456,
 * "0803 555 2190" in NG → 2348035552190. International numbers work from anywhere.
 */
export function normalizePhone(raw: string, defaultCountry: string): string | null {
  const cleaned = raw.trim().replace(/^00/, '+');
  const n = parsePhoneNumberFromString(cleaned, defaultCountry.toUpperCase() as CountryCode);
  if (!n || !n.isValid()) return null;
  return n.number.replace('+', '');
}

/** First valid phone number written anywhere in a message, read in the shop's country. */
export function findPhone(text: string, defaultCountry: string): string | null {
  const hit = findPhoneNumbersInText(text, defaultCountry.toUpperCase() as CountryCode).find((h) => h.number.isValid());
  return hit ? hit.number.number.replace('+', '') : null;
}

/** The country a WhatsApp id belongs to, e.g. 237677123456 → "CM". */
export function phoneCountry(waId: string): string | null {
  return parsePhoneNumberFromString('+' + waId)?.country ?? null;
}

/** "+237 6 77 12 34 56" style, for showing a WhatsApp id to a seller. */
export function formatPhone(waId: string): string {
  const n = parsePhoneNumberFromString('+' + waId);
  return n ? n.formatInternational() : '+' + waId;
}
