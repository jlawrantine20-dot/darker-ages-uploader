import { describe, expect, it } from 'vitest';
import { clockTime, productLabel, say, slots, templateBody, templateFor } from '../src/domain/copy.js';
import { asksAvailability, detectLanguage, detectProduct, isConsentYes, isStop } from '../src/domain/intent.js';
import { isCurrency, isTimezone, marketFor, ratesFor } from '../src/domain/markets.js';
import { currencyExponent, formatMoney, formatUsdMicros, toMinor } from '../src/domain/money.js';
import { findPhone, formatPhone, normalizePhone } from '../src/domain/phone.js';
import { whatsappWindowOpen } from '../src/domain/windows.js';

const catalog = [
  { id: 'brown', name: '12" Claw Clip Ponytail', variant: 'Brown', aliases: [] },
  { id: 'black', name: '12" Claw Clip Ponytail', variant: 'Jet black', aliases: [] },
  { id: 'bonnet', name: 'Satin Bonnet', variant: 'Wine', aliases: ['silk bonnet'] },
  { id: 'meche', name: 'Mèche brésilienne', variant: 'Marron', aliases: ['tissage'] },
];

describe('phone numbers, in any country', () => {
  it.each([
    ['6 77 12 34 56', 'CM', '237677123456'],
    ['00237 677 12 34 56', 'NG', '237677123456'],
    ['0803 555 2190', 'NG', '2348035552190'],
    ['+1 415 555 2671', 'CM', '14155552671'],
    ['06 12 34 56 78', 'FR', '33612345678'],
    ['0712 345678', 'KE', '254712345678'],
  ])('reads %s in %s', (raw, country, want) => expect(normalizePhone(raw, country)).toBe(want));

  it('rejects numbers that are not valid', () => {
    expect(normalizePhone('12345', 'CM')).toBeNull();
    expect(normalizePhone('6 77 12', 'CM')).toBeNull();
  });

  it('finds a number inside a message and formats one for display', () => {
    expect(findPhone('Oui svp, mon numéro: 6 77 12 34 56 merci', 'CM')).toBe('237677123456');
    expect(findPhone('yes please', 'CM')).toBeNull();
    expect(formatPhone('237677123456')).toBe('+237 6 77 12 34 56');
  });
});

describe('money, in any currency', () => {
  it('knows which currencies have no subunit', () => {
    expect(currencyExponent('XAF')).toBe(0);
    expect(currencyExponent('NGN')).toBe(2);
    expect(toMinor(15000, 'XAF')).toBe(15000);
    expect(toMinor(18500, 'NGN')).toBe(1850000);
    expect(toMinor(19.99, 'USD')).toBe(1999);
  });

  it('formats in the shop language', () => {
    expect(formatMoney(15000, 'XAF', 'en', 'CM')).toBe('FCFA\u00a015,000');
    expect(formatMoney(15000, 'XAF', 'fr', 'CM')).toBe('15 000 FCFA');
    expect(formatMoney(1850000, 'NGN', 'en', 'NG')).toBe('₦18,500');
    expect(formatMoney(1999, 'USD', 'en', 'US')).toBe('$19.99');
    expect(formatUsdMicros(22500)).toBe('$0.0225');
  });

  it('has sensible defaults per country and falls back for others', () => {
    expect(marketFor('cm')).toMatchObject({ currency: 'XAF', timezone: 'Africa/Douala', language: 'fr+en' });
    expect(ratesFor('CM')).toEqual(ratesFor('KE'));
    expect(ratesFor('ZZ')).toEqual(ratesFor('XX'));
    expect(isCurrency('XAF')).toBe(true);
    expect(isCurrency('ABCD')).toBe(false);
    expect(isTimezone('Africa/Douala')).toBe(true);
    expect(isTimezone('Mars/Base')).toBe(false);
  });
});

describe('reading customer messages', () => {
  it('spots availability questions in English, Pidgin and French', () => {
    for (const t of ['Do you have the brown one?', 'Is the wine bonnet available', 'una get the brown claw clip', 'e still dey?',
      'Vous avez encore la mèche marron ?', 'C’est disponible ?', 'Il en reste ?', 'y a encore le bonnet?', 'dispo?']) {
      expect(asksAvailability(t), t).toBe(true);
    }
    expect(asksAvailability('How much is delivery to Bonamoussadi')).toBe(false);
    expect(asksAvailability('Bonjour, je veux payer')).toBe(false);
  });

  it('matches the right variant, accents or not', () => {
    expect(detectProduct('Hi! Do you have the 12 inch claw clip ponytail in brown?', catalog)?.id).toBe('brown');
    expect(detectProduct('jet black claw clip abeg', catalog)?.id).toBe('black');
    expect(detectProduct('you get silk bonnet?', catalog)?.id).toBe('bonnet');
    expect(detectProduct('Vous avez encore la meche bresilienne marron ?', catalog)?.id).toBe('meche');
    expect(detectProduct('le tissage marron est dispo?', catalog)?.id).toBe('meche');
  });

  it('accepts either spelling of a bilingual variant', () => {
    const cat = [
      { id: 'b', name: 'Claw Clip', variant: 'Marron / Brown', aliases: [] },
      { id: 'k', name: 'Claw Clip', variant: 'Noir / Black', aliases: [] },
    ];
    expect(detectProduct('vous avez la claw clip marron ?', cat)?.id).toBe('b');
    expect(detectProduct('una get the brown claw clip?', cat)?.id).toBe('b');
    expect(detectProduct('black claw clip dey?', cat)?.id).toBe('k');
    expect(productLabel({ name: 'Claw Clip', variant: 'Marron / Brown' }, 'fr')).toBe('Claw Clip marron');
    expect(productLabel({ name: 'Claw Clip', variant: 'Marron / Brown' }, 'en')).toBe('brown Claw Clip');
  });

  it('stays quiet when unsure', () => {
    expect(detectProduct('do you have the claw clip?', catalog)).toBeNull();
    expect(detectProduct('how much is delivery?', catalog)).toBeNull();
    expect(detectProduct('do you have brown?', catalog)).toBeNull();
  });

  it('treats only a clear yes as consent, in both languages', () => {
    for (const t of ['YES', 'Yes please. 0803 555 2190', 'ok', 'Alert me', 'yes o', 'Oui', 'oui svp', "D'accord", 'ouais']) expect(isConsentYes(t), t).toBe(true);
    for (const t of ['yes but how much?', 'no', 'maybe', 'not now', 'oui mais c’est combien ?', 'non merci', 'pas maintenant']) expect(isConsentYes(t), t).toBe(false);
  });

  it('recognises STOP in both languages', () => {
    for (const t of ['STOP', 'stop please', 'Unsubscribe', 'remove me', 'Arrêter', 'désabonner', 'retirez-moi']) expect(isStop(t), t).toBe(true);
    expect(isStop("don't stop the music")).toBe(false);
  });
});

describe('wording and time', () => {
  it('writes product names naturally per language', () => {
    expect(productLabel({ name: '12" Claw Clip Ponytail', variant: 'Brown' }, 'en')).toBe('brown 12" Claw Clip Ponytail');
    expect(productLabel({ name: 'Mèche brésilienne', variant: 'Marron' }, 'fr')).toBe('Mèche brésilienne marron');
    const f = { currency: 'XAF', country: 'CM', timezone: 'Africa/Douala' };
    const meche = { name: 'Mèche brésilienne', variant: 'Marron' };
    expect(say('fr', 'joined', { product: meche, position: 3 }, f)).toContain("Vous êtes n°3 sur la liste d'attente du modèle Mèche brésilienne marron");
    expect(say('xx', 'joined', { product: meche, position: 3 }, f)).toContain("You're #3 for the marron Mèche brésilienne");
  });

  it('writes bilingual messages with each half formatted in its own language', () => {
    const f = { currency: 'XAF', country: 'CM', timezone: 'Africa/Douala' };
    const facts = { name: 'Nadège Mballa', product: { name: 'Claw Clip', variant: 'Brown' }, priceMinor: 15000, units: 3, waiting: 8, until: new Date('2026-10-05T11:00:00Z'), url: 'https://nkapguard.test/pay/x' };
    const [french, english] = say('fr+en', 'hold', facts, f).split('\n\n');
    expect(french).toBe("Bonjour Nadège, bonne nouvelle : le modèle Claw Clip brown est de retour ! Arrivage : 3. Personnes en attente : 8. Nous vous en réservons un jusqu'à 12:00. Pour le garder, réglez 15\u202f000\u00a0FCFA ici : https://nkapguard.test/pay/x (Répondez STOP pour quitter la liste.)");
    expect(english).toBe('Hi Nadège, good news: the brown Claw Clip is back! Units in: 3. People waiting: 8. We\'re holding one for you until 12:00 PM. Pay FCFA\u00a015,000 here to secure it: https://nkapguard.test/pay/x (Reply STOP to leave the list.)');
    // Template slots: the 7 French values, then the 7 English ones.
    expect(slots('fr+en', 'hold', facts, f)).toEqual([
      'Nadège', 'Claw Clip brown', '3', '8', '12:00', '15\u202f000\u00a0FCFA', 'https://nkapguard.test/pay/x',
      'Nadège', 'brown Claw Clip', '3', '8', '12:00 PM', 'FCFA\u00a015,000', 'https://nkapguard.test/pay/x',
    ]);
    expect(slots('en', 'hold', facts, f)).toHaveLength(7);
    expect(say('fr+en', 'offerAlert', { product: facts.product }, f)).toMatch(/^Bonjour cher client ! .+\n\nHi there, /s);
    expect(templateFor('restock_hold_v1', 'fr+en')).toEqual({ name: 'restock_hold_v1_bilingual', language: 'fr' });
    expect(templateFor('restock_hold_v1', 'en')).toEqual({ name: 'restock_hold_v1', language: 'en' });
  });

  it('formats time in the shop time zone and language', () => {
    const d = new Date('2026-10-05T11:00:00Z');
    expect(clockTime(d, 'Africa/Douala', 'en')).toBe('12:00 PM');
    expect(clockTime(d, 'Africa/Douala', 'fr')).toBe('12:00');
    expect(clockTime(d, 'America/New_York', 'en')).toBe('7:00 AM');
  });

  it('knows when the 24h window is open', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(whatsappWindowOpen(new Date('2026-10-05T00:00:01Z'), now)).toBe(true);
    expect(whatsappWindowOpen(new Date('2026-10-04T12:00:00Z'), now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('reads French, English and Pidgin, and gives up when there is no sign', () => {
    expect(detectLanguage('Bonjour, vous avez le claw clip ponytail?')).toBe('fr');
    expect(detectLanguage("c'est combien le bonnet ?")).toBe('fr');
    expect(detectLanguage('Oui')).toBe('fr');
    expect(detectLanguage('Do you have the jet black claw clip?')).toBe('en');
    expect(detectLanguage('una get the brown one?')).toBe('en');
    expect(detectLanguage('yes please')).toBe('en');
    expect(detectLanguage('ok')).toBeNull();
    expect(detectLanguage('claw clip ponytail brown?')).toBeNull();
    expect(detectLanguage('👍')).toBeNull();
  });
});

describe('WhatsApp template texts', () => {
  it('match the README table submitted to Meta', async () => {
    const { readFileSync } = await import('node:fs');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const key of ['hold', 'race', 'soldOut', 'paid', 'refund', 'priceDrop'] as const) {
      expect(readme).toContain(templateBody('en', key));
      expect(readme).toContain(templateBody('fr', key));
      expect(readme).toContain(templateBody('fr+en', key).replace('\n\n', '<br><br>'));
    }
    expect(templateBody('fr+en', 'hold')).toMatch(/\{\{14\}\}/);
  });
});
