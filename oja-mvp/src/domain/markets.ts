/**
 * Defaults per country, used when a shop is created. Every value can be changed per shop.
 *
 * WhatsApp rates are Meta's per-message list prices in USD for the customer's country,
 * taken from Meta's published rate card. They are estimates for showing sellers what a
 * send will cost; Meta changes them, so check the current card before relying on them.
 */

/** 'fr+en' sends every message in French, then English (required for consumer information in Cameroon). */
export type Lang = 'en' | 'fr' | 'fr+en';
export type Provider = 'test' | 'paystack' | 'flutterwave' | 'stripe' | 'notchpay';

export interface Rates {
  marketing: number;
  utility: number;
}

export interface Market {
  name: string;
  currency: string;
  timezone: string;
  language: Lang;
  /** Suggested payment providers, best first. */
  providers: Provider[];
  /** Meta pricing market this country falls under. */
  rateGroup: string;
}

// Meta rate card, USD per delivered message. Groups follow Meta's market names.
export const RATE_GROUPS: Record<string, Rates> = {
  'Nigeria': { marketing: 0.0516, utility: 0.0067 },
  'South Africa': { marketing: 0.0379, utility: 0.0076 },
  'Egypt': { marketing: 0.1073, utility: 0.0036 },
  'Rest of Africa': { marketing: 0.0225, utility: 0.004 },
  'North America': { marketing: 0.025, utility: 0.004 },
  'United Kingdom': { marketing: 0.0529, utility: 0.022 },
  'France': { marketing: 0.0859, utility: 0.03 },
  'Germany': { marketing: 0.1365, utility: 0.055 },
  'Rest of Western Europe': { marketing: 0.0592, utility: 0.03 },
  'India': { marketing: 0.0107, utility: 0.0014 },
  'Brazil': { marketing: 0.0625, utility: 0.008 },
  'Other': { marketing: 0.0604, utility: 0.0077 },
};

export const MARKETS: Record<string, Market> = {
  CM: { name: 'Cameroon', currency: 'XAF', timezone: 'Africa/Douala', language: 'fr+en', providers: ['notchpay', 'flutterwave'], rateGroup: 'Rest of Africa' },
  NG: { name: 'Nigeria', currency: 'NGN', timezone: 'Africa/Lagos', language: 'en', providers: ['paystack', 'flutterwave'], rateGroup: 'Nigeria' },
  GH: { name: 'Ghana', currency: 'GHS', timezone: 'Africa/Accra', language: 'en', providers: ['paystack', 'flutterwave'], rateGroup: 'Rest of Africa' },
  KE: { name: 'Kenya', currency: 'KES', timezone: 'Africa/Nairobi', language: 'en', providers: ['paystack', 'flutterwave'], rateGroup: 'Rest of Africa' },
  ZA: { name: 'South Africa', currency: 'ZAR', timezone: 'Africa/Johannesburg', language: 'en', providers: ['paystack', 'stripe'], rateGroup: 'South Africa' },
  CI: { name: "Côte d'Ivoire", currency: 'XOF', timezone: 'Africa/Abidjan', language: 'fr', providers: ['paystack', 'flutterwave'], rateGroup: 'Rest of Africa' },
  SN: { name: 'Senegal', currency: 'XOF', timezone: 'Africa/Dakar', language: 'fr', providers: ['flutterwave'], rateGroup: 'Rest of Africa' },
  GA: { name: 'Gabon', currency: 'XAF', timezone: 'Africa/Libreville', language: 'fr', providers: ['flutterwave'], rateGroup: 'Rest of Africa' },
  RW: { name: 'Rwanda', currency: 'RWF', timezone: 'Africa/Kigali', language: 'en', providers: ['flutterwave'], rateGroup: 'Rest of Africa' },
  UG: { name: 'Uganda', currency: 'UGX', timezone: 'Africa/Kampala', language: 'en', providers: ['flutterwave'], rateGroup: 'Rest of Africa' },
  TZ: { name: 'Tanzania', currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', language: 'en', providers: ['flutterwave'], rateGroup: 'Rest of Africa' },
  EG: { name: 'Egypt', currency: 'EGP', timezone: 'Africa/Cairo', language: 'en', providers: ['paystack', 'stripe'], rateGroup: 'Egypt' },
  US: { name: 'United States', currency: 'USD', timezone: 'America/New_York', language: 'en', providers: ['stripe'], rateGroup: 'North America' },
  CA: { name: 'Canada', currency: 'CAD', timezone: 'America/Toronto', language: 'en', providers: ['stripe'], rateGroup: 'North America' },
  GB: { name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London', language: 'en', providers: ['stripe'], rateGroup: 'United Kingdom' },
  FR: { name: 'France', currency: 'EUR', timezone: 'Europe/Paris', language: 'fr', providers: ['stripe'], rateGroup: 'France' },
  BE: { name: 'Belgium', currency: 'EUR', timezone: 'Europe/Brussels', language: 'fr', providers: ['stripe'], rateGroup: 'Rest of Western Europe' },
  DE: { name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin', language: 'en', providers: ['stripe'], rateGroup: 'Germany' },
  IN: { name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', language: 'en', providers: ['stripe'], rateGroup: 'India' },
  BR: { name: 'Brazil', currency: 'BRL', timezone: 'America/Sao_Paulo', language: 'en', providers: ['stripe'], rateGroup: 'Brazil' },
};

export const LANGS: Lang[] = ['en', 'fr', 'fr+en'];

/** Defaults for a country we have no entry for: the seller fills in currency and time zone. */
export function marketFor(country: string): Market | null {
  return MARKETS[country.toUpperCase()] ?? null;
}

export function ratesFor(country: string): Rates {
  return RATE_GROUPS[marketFor(country)?.rateGroup ?? 'Other'];
}

export const usdMicros = (usd: number) => Math.round(usd * 1_000_000);

export function isCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return /^[A-Z]{3}$/.test(code);
  } catch {
    return false;
  }
}

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
