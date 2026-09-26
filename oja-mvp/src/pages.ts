/** Small public pages customers see when they tap a payment link. Shown in the shop's language. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const TEXT = {
  en: {
    ended: 'This offer has ended',
    endedHeld: 'The hold on this item ran out, so it went to the next person in line. You keep your place on the list for the next restock.',
    endedSold: 'This item has sold out. You keep your place on the list for the next restock.',
    endedPaid: 'You have already paid for this item. Thank you!',
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
    unavailable: 'Le paiement est indisponible pour le moment',
    tryAgain: 'Réessayez le lien dans une minute.',
    thanks: 'Merci !',
    thanksBody: 'Si votre paiement est passé, vous recevrez une confirmation sur WhatsApp sous peu.',
    testTitle: 'Paiement test',
    testBody: "Cette boutique est en mode test. Aucun argent n'est débité.",
    testPay: 'Payer',
    testDone: 'Paiement test reçu',
  },
};

export type PageText = (typeof TEXT)['en'];
export const pageText = (lang: string): PageText => TEXT[lang as 'en' | 'fr'] ?? TEXT.en;

export function page(lang: string, title: string, body: string, extra = ''): string {
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#F3F6F4;--card:#fff;--ink:#15201A;--muted:#5B6961;--accent:#0B6B55;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0C110F;--card:#141A17;--ink:#E6EDE9;--muted:#95A49C;--accent:#3CC49E;--on:#052019}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:420px;width:100%;background:var(--card);border-radius:16px;padding:24px}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 16px}
button{width:100%;padding:14px;border:0;border-radius:12px;background:var(--accent);color:var(--on);font:600 16px system-ui,sans-serif;cursor:pointer}
</style></head><body><main><h1>${esc(title)}</h1><p>${esc(body)}</p>${extra}</main></body></html>`;
}

export const escapeHtml = esc;
