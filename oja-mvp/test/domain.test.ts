import { describe, expect, it } from 'vitest';
import { clockTime, copyFor, productLabel } from '../src/domain/copy.js';
import { asksAvailability, detectProduct, isConsentYes, isStop } from '../src/domain/intent.js';
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
    expect(marketFor('cm')).toMatchObject({ currency: 'XAF', timezone: 'Africa/Douala', language: 'fr' });
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
    expect(copyFor('fr').joined(3, 'Mèche brésilienne marron')).toContain('Vous êtes n°3 sur la liste');
    expect(copyFor('xx')).toBe(copyFor('en'));
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
