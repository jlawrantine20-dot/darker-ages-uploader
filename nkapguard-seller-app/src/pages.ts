/** Small public pages customers see when they tap a payment link. Shown in the shop's language. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const TEXT = {
  en: {
    ended: 'This offer has ended',
    endedHeld: 'The hold on this item ran out, so it went to the next person in line. You keep your place on the list for the next restock.',
    endedSold: 'This item has sold out. You keep your place on the list for the next restock.',
    endedPaid: 'You have already paid for this item. Thank you!',
    orderEnded: 'The hour to pay for this order has passed, so the item went back on sale. Message the shop again if you still want it.',
    unavailable: 'Payment is unavailable right now',
    tryAgain: 'Please try the link again in a minute.',
    thanks: 'Thank you!',
    thanksBody: 'If your payment went through, you will get a confirmation on WhatsApp shortly.',
    testTitle: 'Test payment',
    testBody: 'This shop is in test mode. No money moves.',
    testPay: 'Pay',
    testDone: 'Test payment received',
  },
  fr: {
    ended: 'Cette offre est terminée',
    endedHeld: "La réservation a expiré et l'article est passé à la personne suivante. Vous gardez votre place sur la liste pour le prochain arrivage.",
    endedSold: "Cet article est épuisé. Vous gardez votre place sur la liste pour le prochain arrivage.",
    endedPaid: 'Vous avez déjà payé cet article. Merci !',
    orderEnded: "Le délai d'une heure pour payer cette commande est passé, l'article a donc été remis en vente. Écrivez de nouveau à la boutique si vous le voulez toujours.",
    unavailable: 'Le paiement est indisponible pour le moment',
    tryAgain: 'Réessayez dans une minute.',
    thanks: 'Merci !',
    thanksBody: 'Si votre paiement est passé, vous recevrez une confirmation sur WhatsApp sous peu.',
    testTitle: 'Paiement de test',
    testBody: "Cette boutique est en mode test. Aucun argent n'est débité.",
    testPay: 'Payer',
    testDone: 'Paiement de test reçu',
  },
};

export type PageText = (typeof TEXT)['en'];

/** Page wording in the shop's language. Bilingual shops get French, then English, one per line. */
export function pageText(lang: string): PageText {
  if (lang !== 'fr+en') return TEXT[lang as 'en' | 'fr'] ?? TEXT.en;
  const both = {} as PageText;
  for (const k of Object.keys(TEXT.en) as (keyof PageText)[]) both[k] = k === 'testPay' ? `${TEXT.fr[k]} / ${TEXT.en[k]}` : `${TEXT.fr[k]}\n${TEXT.en[k]}`;
  return both;
}

export function page(lang: string, title: string, body: string, extra = ''): string {
  return `<!doctype html><html lang="${esc(lang === 'fr+en' ? 'fr' : lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title.split('\n')[0])}</title><style>
:root{color-scheme:light dark;--bg:#F2F5F3;--card:#fff;--ink:#0E1A15;--muted:#66766F;--accent:#0A5A48;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0A100E;--card:#111916;--ink:#E9F0ED;--muted:#8C9D96;--accent:#3CCBA2;--on:#03201A}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:420px;width:100%;background:var(--card);border-radius:22px;padding:28px 24px;box-shadow:0 24px 48px -24px rgba(14,26,21,.3)}
h1{font-size:23px;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--muted);margin:0 0 16px}
button{width:100%;padding:15px;border:0;border-radius:14px;background:var(--accent);color:var(--on);font:600 16px system-ui,sans-serif;cursor:pointer}
</style></head><body><main><h1>${title.split('\n').map(esc).join('<br>')}</h1>${body.split('\n').map((p) => `<p>${esc(p)}</p>`).join('')}${extra}</main></body></html>`;
}

export const escapeHtml = esc;
