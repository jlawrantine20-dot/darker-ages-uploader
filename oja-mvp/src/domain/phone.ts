/**
 * Normalise a Nigerian phone number to WhatsApp id form: 234 + 10 digits, no '+'.
 * Accepts 0803 555 2190, +234 803 555 2190, 234-803-555-2190, 8035552190.
 * Returns null for anything that is not a Nigerian mobile number.
 */
export function normalizeNgPhone(raw: string): string | null {
  let d = raw.replace(/[^\d]/g, '');
  if (d.startsWith('2340')) d = '234' + d.slice(4);
  if (d.startsWith('234')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  if (!/^[789][01]\d{8}$/.test(d)) return null;
  return '234' + d;
}

/** Find the first Nigerian mobile number written anywhere in a message. */
export function findNgPhone(text: string): string | null {
  const candidates = text.match(/\+?\d[\d\s-]{8,16}\d/g) ?? [];
  for (const c of candidates) {
    const n = normalizeNgPhone(c);
    if (n) return n;
  }
  return null;
}
