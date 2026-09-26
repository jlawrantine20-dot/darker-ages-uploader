import { describe, expect, it } from 'vitest';
import { clockTime, naira } from '../src/domain/copy.js';
import { asksAvailability, detectProduct, isConsentYes, isStop } from '../src/domain/intent.js';
import { findNgPhone, normalizeNgPhone } from '../src/domain/phone.js';
import { whatsappWindowOpen } from '../src/domain/windows.js';

const catalog = [
  { id: 'brown', name: '12" Claw Clip Ponytail', variant: 'Brown', aliases: [] },
  { id: 'black', name: '12" Claw Clip Ponytail', variant: 'Jet black', aliases: [] },
  { id: 'bonnet', name: 'Satin Bonnet', variant: 'Wine', aliases: ['silk bonnet'] },
];

describe('phone numbers', () => {
  it.each([
    ['0803 555 2190', '2348035552190'],
    ['+234 803 555 2190', '2348035552190'],
    ['234-803-555-2190', '2348035552190'],
    ['+2340803 555 2190', '2348035552190'],
    ['8035552190', '2348035552190'],
    ['0916 000 1234', '2349160001234'],
  ])('normalises %s', (raw, want) => expect(normalizeNgPhone(raw)).toBe(want));

  it.each(['12345', '0603 555 2190', '+44 7700 900123'])('rejects %s', (raw) => expect(normalizeNgPhone(raw)).toBeNull());

  it('finds a number inside a sentence', () => {
    expect(findNgPhone('Yes please. 0803 555 2190 thanks')).toBe('2348035552190');
    expect(findNgPhone('yes please')).toBeNull();
  });
});

describe('reading customer messages', () => {
  it('spots availability questions in English and Pidgin', () => {
    expect(asksAvailability('Do you have the brown one?')).toBe(true);
    expect(asksAvailability('Is the wine bonnet available')).toBe(true);
    expect(asksAvailability('una get the brown claw clip')).toBe(true);
    expect(asksAvailability('e still dey?')).toBe(true);
    expect(asksAvailability('How much is delivery to Ikeja')).toBe(false);
  });

  it('matches the right variant', () => {
    expect(detectProduct('Hi! Do you have the 12 inch claw clip ponytail in brown?', catalog)?.id).toBe('brown');
    expect(detectProduct('jet black claw clip abeg', catalog)?.id).toBe('black');
    expect(detectProduct('is the wine satin bonnet available', catalog)?.id).toBe('bonnet');
    expect(detectProduct('you get silk bonnet?', catalog)?.id).toBe('bonnet');
  });

  it('stays quiet when unsure', () => {
    expect(detectProduct('do you have the claw clip?', catalog)).toBeNull(); // which colour?
    expect(detectProduct('how much is delivery to Ikeja?', catalog)).toBeNull();
    expect(detectProduct('do you have brown?', catalog)).toBeNull();
  });

  it('treats only a clear yes as consent', () => {
    for (const t of ['YES', 'Yes please. 0803 555 2190', 'ok', 'Alert me', 'yes o']) expect(isConsentYes(t)).toBe(true);
    for (const t of ['yes but how much?', 'no', 'maybe', 'not now', 'what is the price']) expect(isConsentYes(t)).toBe(false);
  });

  it('recognises STOP', () => {
    for (const t of ['STOP', 'stop please', 'Unsubscribe', 'remove me']) expect(isStop(t)).toBe(true);
    expect(isStop("don't stop the music")).toBe(false);
  });
});

describe('formatting and windows', () => {
  it('formats naira and Lagos time', () => {
    expect(naira(1850000)).toBe('₦18,500');
    expect(clockTime(new Date('2026-10-05T11:00:00Z'), 'Africa/Lagos')).toBe('12:00 PM');
  });

  it('knows when the 24h window is open', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(whatsappWindowOpen(new Date('2026-10-05T00:00:01Z'), now)).toBe(true);
    expect(whatsappWindowOpen(new Date('2026-10-04T12:00:00Z'), now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
  });
});
