/** Money helpers. Amounts are integers in the currency's smallest unit ("minor units"). */

/** Decimal places the currency uses: 2 for NGN, USD and EUR; 0 for XAF, XOF, UGX and RWF. */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export const toMinor = (major: number, currency: string) => Math.round(major * 10 ** currencyExponent(currency));
export const toMajor = (minor: number, currency: string) => minor / 10 ** currencyExponent(currency);

const LOCALE: Record<string, string> = { en: 'en', fr: 'fr' };

/** "15 000 FCFA" in French, "FCFA 15,000" in English, "₦18,500" for NGN. Whole amounts drop the decimals. */
export function formatMoney(minor: number, currency: string, lang = 'en', country?: string): string {
  const major = toMajor(minor, currency);
  const locale = country ? `${LOCALE[lang] ?? 'en'}-${country}` : (LOCALE[lang] ?? 'en');
  const whole = Number.isInteger(major);
  const fmt = (loc: string) =>
    new Intl.NumberFormat(loc, { style: 'currency', currency, minimumFractionDigits: whole ? 0 : undefined });
  try {
    return fmt(locale).format(major);
  } catch {
    return fmt(LOCALE[lang] ?? 'en').format(major);
  }
}

/** Meta fees for display: "$0.0225" style, never rounded to zero. */
export function formatUsdMicros(micros: number): string {
  const usd = micros / 1_000_000;
  const digits = usd !== 0 && usd < 1 ? 4 : 2;
  return '$' + usd.toFixed(digits);
}
