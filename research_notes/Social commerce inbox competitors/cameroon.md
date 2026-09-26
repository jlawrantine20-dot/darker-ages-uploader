# Cameroon adaptation notes (WhatsApp restock alerts, payment links, consent)

Research date: 26 Sep 2026. Primary sources were used where the scraper could reach them (Notch Pay docs, Meta pricing docs, the full texts of Laws 2024/017, 2010/021 and 2011/012, and Google libphonenumber metadata). Items marked **[UNVERIFIED]** come from secondary sources or memory and need checking before use in code or legal copy.

FX used throughout: **1 USD ≈ 575.7 XAF** (mid-market, 26 Sep 2026, [Pluang](https://pluang.com/en/tools/currency-converter/usd-xaf); the range that week was 570.9 to 577.0). XAF is pegged at 1 EUR = 655.957 XAF, which implies EUR/USD ≈ 1.139. XAF has no minor unit, so amounts are whole francs.

---

## 1. Payment gateways (MTN MoMo + Orange Money, XAF)

### Comparison

| Gateway | MTN / Orange CM | Collection fee (CM) | Hosted link API | Webhook signing | Email required? | Notes |
|---|---|---|---|---|---|---|
| **Notch Pay** (Cameroon-based) | Yes, plus Express Union, M2U, YooMee, Sara Money | **2% flat** per payment; 1% on withdrawal to MoMo; no setup or monthly fee ([pricing](https://notchpay.co/pricing)) | `POST /payments` returns `authorization_url` | HMAC-SHA256, header `x-notch-signature` | **No.** One of `email` / `phone` / `customer` is enough | Best docs (OpenAPI, llms.txt). Recommended primary. |
| **CamPay** (Yaoundé) | Yes (MTN and Orange only) | **2% flat** collect; 1% withdrawal; 5,000 XAF per bank transfer ([campay.net](https://www.campay.net/en/)) | `POST /api/get_payment_link/` returns `link` | Signed JWT in `signature` param | No (email optional) | Simple, MoMo-only. Recommended backup. |
| **CinetPay** | Yes, plus Express Union and cards | Orange **2.2%**, MTN **2%**, Express Union 2.5%, card 3.5%; same rates for Payment Links ([pricing](https://cinetpay.com/pricing)) | `POST /v2/payment` returns `data.payment_url` [UNVERIFIED] | HMAC-SHA256 `x-token` over concatenated `cpm_*` fields | Only for card payments [UNVERIFIED] | docs.cinetpay.com **did not resolve (DNS)** on 26 Sep 2026. CinetPay is also moving to a new back-office (panel.cinetpay.net). |
| **Flutterwave** | Yes (MTN, Orange). BEAC approval to operate in CM reported 24 Jun 2025 ([invest-time](https://invest-time.com/en/payments-flutterwave-wave-cameroon-fintech/)) | Mobile money **2%**, cards 4.8%, MoMo payout 1%, bank payout 1,500 XAF. Excludes VAT. By default the **customer** bears the fee ([flutterwave.com/cm/pricing](https://flutterwave.com/cm/pricing)) | v3 `POST /v3/payments` returns `data.link` [UNVERIFIED] | `verif-hash` header (static secret) [UNVERIFIED] | **Yes**, `customer.email` is required on v3 Standard [UNVERIFIED] | Pan-African, heavier KYC. The email requirement is friction for WhatsApp buyers. |
| Others seen | Monetbil, Diool, Afrikpay, MMGate, Maviance/Smobilpay | Not researched | | | | Named on MMGate's page as competitors of CamPay. |

Government tax context: the 2025 Finance Law added **0.2% + 4 XAF per mobile-money transaction**, effective 1 Jan 2025 ([Digital Business Africa](https://www.digitalbusiness.africa/cameroun-les-tarifs-de-retrait-de-mtn-mobile-money-momo-en-2025/)). Whether the payer or the gateway bears it depends on the rail. **[UNVERIFIED]**

### A. Notch Pay (recommended)

Sources: [Initialize a payment (OpenAPI)](https://developer.notchpay.co/api-reference/initialize-a-payment.md), [Payments API](https://developer.notchpay.co/api-reference/payments.md), [Collect](https://developer.notchpay.co/accept-payments/collect.md), [Webhooks API](https://developer.notchpay.co/api-reference/webhooks.md), [Verifying webhooks](https://developer.notchpay.co/get-started/webhooks/verify.md).

**(a) Create a hosted payment**
- `POST https://api.notchpay.co/payments` (the legacy `/payments/initialize` is equivalent). Sandbox and live use the same host; the key decides the mode.
- Headers: `Authorization: <PUBLIC_KEY>` (raw key, **no "Bearer"**) and `Content-Type: application/json`. Management endpoints such as webhook creation also need `X-Grant: <PRIVATE_KEY>`.
- Required: `amount` (number; whole XAF, e.g. `5000` = 5,000 XAF), `currency` (`"XAF"`), and **one of** `email` | `phone` | `customer` (a customer ID, or an object `{name, email, phone}`).
- Optional: `reference` (your order ID, unique), `description`, `callback` (redirect URL), `locked_channel` (`cm.mtn` / `cm.orange`), `locked_country` (`CM`), `locked_currency`, `items`, `customer_meta`.
- Response `201`: `{status:"Accepted", code:201, transaction:{id, reference, amount, currency, status:"pending", ...}, authorization_url:"https://pay.notchpay.co/..."}`.
  - **Checkout URL: `authorization_url`**. It is single-use, so create a new one for each payment.
  - **Reference: `transaction.reference`**. Verify with `GET /payments/{reference}` and check `transaction.status === "complete"`.
- Unpaid payments **expire after 3 hours** (status `expired`). A restock-alert link must be generated on click, or refreshed, rather than pre-generated.

**(b) Verify webhooks**
- Header: **`x-notch-signature`**.
- Algorithm: **HMAC-SHA256, hex digest**, keyed with the webhook **Hash Key** (Dashboard > Settings > API Keys; there are separate test and live hashes).
- What is signed: the **raw request body** (verify before JSON-parsing, and use a constant-time compare).
- Success event: **`payment.complete`**. Others: `payment.created`, `payment.processing`, `payment.failed`, `payment.canceled`, `payment.expired`.
- Payload paths: event `type`, event id `id` (use it for dedup), **`data.reference`**, **`data.amount`**, `data.currency`, **`data.status`** (`"complete"`), `data.id`.
- **[CAVEAT]** The docs are inconsistent here. The Collect page shows a callback of `?reference=trx.xxx&status=complete&trxref=order_123`, meaning Notch's own `trx.` reference plus your ref in `trxref`, while the webhook example shows `data.reference = "order_123"`. Log a real sandbox webhook, and match on your ref wherever it appears (possibly a `merchant_reference`-style field) before relying on `data.reference`.
- Deliveries are retried with backoff, so handlers must be idempotent.

### B. CamPay (backup)

Sources: [campay.net](https://www.campay.net/en/), [campay-go-sdk (pkg.go.dev)](https://pkg.go.dev/github.com/NdoleStudio/campay-go-sdk). The official Postman docs are at documenter.getpostman.com/view/2391374/T1LV8PVA and were not fetched.
- Hosts: `https://demo.campay.net` (sandbox) and `https://www.campay.net` (live).
- Auth: `POST /api/token/` with `{username, password}` returns `token` and `expires_in`. Send it as `Authorization: Token <token>` **[UNVERIFIED header scheme]**.
- Payment link: `POST /api/get_payment_link/` with body `amount` (string), `currency:"XAF"`, `description`, **`external_reference`** (your ref), `redirect_url`, and optional `failure_redirect_url`, `email`, `first_name`, `last_name`, `payment_options` (`"MOMO"`, `"CARD"`). Response: **`link`** (checkout URL) and `reference` (CamPay's ref).
- Webhook: the fields are `status`, `reference`, `amount`, `currency`, `operator`, `code`, `operator_reference`, **`signature`**, `external_reference` and `description`. They arrive as **query params**; the SDK tags them `query:`, so it is probably a GET. `signature` is a JWT signed with the app's **Webhook Key** (the SDK `ValidateCallback(signature, webhookKey)`; HS256 assumed **[UNVERIFIED]**). The success value is `status == "SUCCESSFUL"`. Re-check with `GET /api/transaction/{reference}/`.

### C. CinetPay [UNVERIFIED, docs unreachable]
From memory and search snippets:
- `POST https://api-checkout.cinetpay.com/v2/payment`. The body carries `apikey` and `site_id`, plus `transaction_id`, `amount` (a multiple of 5), `currency` (`XAF`), `description`, `notify_url`, `return_url` and `channels` (`MOBILE_MONEY`). The checkout URL is `data.payment_url`.
- Notification: CinetPay sends a POST to `notify_url` with `cpm_trans_id` (your `transaction_id`). The `x-token` header holds an HMAC-SHA256 (secret key) over the concatenation `cpm_site_id + cpm_trans_id + cpm_trans_date + cpm_amount + cpm_currency + signature + payment_method + …` (the full field list is longer). Confirm with the check endpoint. Search snippets: [HMAC page](https://docs.cinetpay.com/api/1.0-en/checkout/hmac), [notification page](https://docs.cinetpay.com/api/1.0-en/checkout/notification).

---

## 2. Meta WhatsApp pricing for Cameroon

- **Rate group: "Rest of Africa"** (Cameroon, +237, is listed there in Meta's country-code table) — [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).
- Meta base rates (USD per delivered message). They are unchanged on 1 Oct 2026 for Rest of Africa. The figures were cross-checked in [whautomate](https://whautomate.com/whatsapp-business-api-pricing) and [chakrahq](https://chakrahq.com/article/whatsapp-api-pricing-guide), because Meta's CSV rate card was not downloadable here:

| Category | USD | ≈ XAF (@575.7) |
|---|---|---|
| Marketing | **$0.0225** | **≈ 13 XAF** |
| Utility | **$0.0040** | ≈ 2.3 XAF |
| Authentication | **$0.0040** | ≈ 2.3 XAF |
| Authentication-international | n/a | – |
| Service (from 1 Oct 2026) | **$0.0040** (same as utility/auth) | ≈ 2.3 XAF |

  (SleekFlow lists 0.02588 / 0.00460, which is the base rate plus SleekFlow's markup of about 15% — [SleekFlow](https://help.sleekflow.io/en_US/whatsapp/pricing).)
- **Changes in 2026** ([Meta: upcoming pricing updates](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)):
  - **1 Jul 2026:** Meta Business Agent launched as a new non-template category.
  - **1 Aug 2026:** Meta Business Agent messages are charged per token, at $2 per 1M tokens (about 4–5 US cents per message).
  - **1 Oct 2026:** **service messages** (free-form replies inside the 24h window; free since 1 Nov 2024) **and utility templates sent inside an open 24h window** (free since 1 Jul 2025) become **charged per message**, at the market's utility/auth rate. There is a **free tier of 1,000 delivered service messages per month per business phone number**; it does not roll over, and service messages get no volume tiers. **Without a payment method on file by 30 Sep 2026, Meta stops delivering service messages after the free tier** (as of today, 26 Sep, that deadline is 4 days away).
  - The 72h free entry-point window (from Click-to-WhatsApp ads) stays free for delivery.
  - **1 Oct 2026:** nine markets leave their "Rest of" regions: Bangladesh, Iraq, Kazakhstan, Kuwait, **Morocco**, Nepal, Oman, Sri Lanka, Ukraine. **Cameroon is not among them.**
- Implication: a restock alert (a marketing template) costs about 13 XAF. The payment-link follow-up inside the window was free; from 1 Oct it costs about 2.3 XAF after the first 1,000 per month.

---

## 3. Law

### Law No. 2024/017 of 23 Dec 2024 on personal data protection (full text read: [PDF via Cabinet Nkoyok Ngoue](https://cabinetnkoyokngoue.com/wp-content/uploads/2025/03/Loi-n%C2%B0-2024017-du-23-decembre-2024-relative-a-la-protection-des-donnees-a-caractere-personnel-au-Cameroun-Nkoyok-Ngoue-Avocat-daffaire.pdf), [prc.cm](https://prc.cm/fr/multimedia/documents/10258-loi-n-2024-017-du-23-12-2024-web))
- **In force since promulgation. There is an 18-month compliance period (Art. 73), which ended on 23 Jun 2026**, so compliance is required now.
- **Consent:** Art. 9 requires prior, free, informed, specific and unambiguous consent. The Art. 5 definition adds that it must be "expresse". Legal exceptions cover only legal obligation, public-interest mission and health, so **there is no "legitimate interest" basis**. Art. 50: processing without prior consent is prohibited. Minors under 18 need parental consent.
- **Direct marketing:** "prospection directe" is defined (Art. 5) as any solicitation promoting goods, services or a person's image, whatever the medium. **Art. 40:** the right to object **at any time** to processing for prospection; after an objection the data "ne peuvent plus être utilisées à ces fins". **Art. 41:** passing data to third parties, or using it on their behalf, for direct prospection needs prior consent after information. **Art. 21:** at collection, you must inform the person of your identity, the purposes, recipients, retention period, rights (including the right to be informed in case of commercial prospection) and the possibility to refuse.
- **Authorisation regime:** Art. 19 requires **prior authorisation from the Authority before any processing**. There is also a processing register (Art. 29), an annual security report (Art. 27), breach notification "sans délai" (Art. 22), impact assessments for high-risk processing (Art. 33), and prior authorisation for **cross-border transfers** (Art. 32), which matters for hosting outside Cameroon.
- **Regulator:** the "Autorité de protection des données à caractère personnel" (Art. 53), whose creation and organisation are to be set by presidential decree. **[UNVERIFIED]** No decree creating or staffing it was found as of Sep 2026 (a draft decree exists on [minpostel.gov.cm](https://www.minpostel.gov.cm/images/Documentation/patnuc/textes_preparation_pour_consultation_publique/protection_data/230518%20Decret_APD%20FIN%20_CLEAN.pdf)). Authorisations are therefore likely impossible to obtain in practice yet.
- **Penalties (selected):**
  - Administrative:
    - Art. 54: a 10-day formal notice, then up to 100,000 XAF per day, then suspension or withdrawal.
    - Art. 55: processing without authorisation, 5–50M XAF.
    - Art. 56: refusing access requests, 1–10M XAF.
    - Art. 60: unauthorised foreign transfer, 10–50M XAF.
    - Art. 61: breaching the terms of the authorisation, 10–100M XAF.
  - Criminal:
    - **Art. 64: processing for direct prospection despite the person's objection, 1–3 years' prison and/or 50,000–1M XAF.**
    - **Art. 65: processing "à des fins de profilage", 3–10 years and/or 1–20M XAF.** This is broad. It is a risk for "interest tags" and preference inference; get legal review.
    - Art. 67: diversion from the original purpose, 6 months–2 years and/or 0.5–5M XAF.
    - Art. 71: legal persons, **50M–1bn XAF**.

### Law No. 2010/021 of 21 Dec 2010 on electronic commerce (full text: [opencamer](http://opencamer.blogspot.com/2013/08/loi-n2010021-du-21-decembre-2010.html); official PDFs at [mincommerce.gov.cm](https://www.mincommerce.gov.cm/sites/default/files/documents/loi-n-2010-021-du-21-decembre-2010-regissant-le-commerce-electronique-au-cameroun.pdf))
- **Art. 5:** online advertising must clearly identify **who it is sent on behalf of**, and promotional offers (discounts, gifts, contests) must be identified with their conditions easily accessible. This applies "without prejudice to" misleading-advertising rules.
- **Art. 6:** unsolicited e-mail advertising must be identifiable as such **from the moment it is received**.
- **Art. 7:** **direct prospection by automated calling system, fax or "courrier électronique" is prohibited without the recipient's prior consent.** "Courrier électronique" is defined (Art. 2) as *any* text, voice, sound or image message sent through a communication network. Arguably this covers WhatsApp and SMS, though that reading is inferred, not tested in court.
- **No explicit unsubscribe-link requirement** exists in this law. The opt-out duty comes from Art. 40 of Law 2024/017.
- **Art. 15:** before contract, disclose seller identity, address and phone; price; delivery cost; **the offer's validity period**; payment terms; and withdrawal rights.
- **Art. 25:** if an item is **unavailable**, inform the buyer at least 24h before the promised delivery and refund in full. This is directly relevant to oversold restock drops.
- **Art. 20:** 15-day withdrawal right.
- **Art. 43:** breaches of Arts. 15, 17, 19, 21, 24 and 25 carry fines of **250,000–2,500,000 XAF**.

### Law No. 2011/012 of 6 May 2011, consumer protection framework law (full text: [fratel.org PDF](https://www.fratel.org/documents/2011/12/201105-Cameroun-Loi_cadre_protection_consommateur.pdf))
- **Art. 8(1):** "la publicité erronée, mensongère ou abusive" and unfair commercial practices are strictly prohibited.
- **Art. 13:** consumer information must be "juste, suffisante, claire et lisible" **in French and in English**. Bilingual alert templates are the safer choice.
- **Art. 14:** advertising must follow the price-display rules.
- **Art. 32:** giving erroneous information about product quality carries 6 months–2 years' prison and/or 200,000–1M XAF; legal persons pay double (Art. 33).
- **Art. 28:** the seller bears the burden of proof.
- **False scarcity:** there is **no specific "false urgency / fake low-stock" provision**. Fake "only 2 left" or fake countdowns would fall under Art. 8 (misleading advertising) and the Art. 32 erroneous-information offence (inference).

---

## 4. Phone numbers

Source: Google libphonenumber `PhoneNumberMetadata.xml` and `carrier/en/237.txt` (fetched 26 Sep 2026), plus [Wikipedia](https://en.wikipedia.org/wiki/Telephone_numbers_in_Cameroon).
- Country code **+237**. **National numbers are 9 digits** (since 21 Nov 2014). There is **no trunk "0"**; the international prefix is 00.
- Mobile pattern: `^(?:24[23]|6(?:[25-9]\d|4[0-2]))\d{6}$`. Landline pattern: `^2(?:22|33)\d{6}$`. Toll-free: `88…`.
- Prefix to operator (the region is **number-portable**, so this is only a hint):
  - **MTN:** 650–654, 67x, 680–683
  - **Orange:** 655–659, 69x, 686–689, 640–642
  - **Nexttel:** 66x, 684–685
  - **Camtel (mobile/CDMA "Blue"):** 62x, 242/243
- Canonical format is `6 XX XX XX XX`. People commonly write `6XX XX XX XX`, `6XXXXXXXX`, `+237 6XX XX XX XX`, `237 6XX…` or `00237…`, and sometimes use dots (`6.99.12.34.56`) **[UNVERIFIED]**. The old 8-digit numbers (without the leading 6) may still appear in old contact lists. E.164 for WhatsApp and Notch Pay is `2376XXXXXXXX`.

---

## 5. Language: how customers ask and confirm (practitioner knowledge, **[UNVERIFIED]**)

Cameroon is about 80% Francophone. In the North-West and South-West regions, English and **Cameroonian Pidgin (Kamtok)** dominate. Urban youth mix in **Camfranglais**. No corpus study of WhatsApp commerce phrasing was found, so treat these lists as seed data for the matcher and validate them against real chats.

**Availability (French):** "vous avez encore … ?", "c'est encore disponible ?", "c'est dispo ?", "dispo ?", "il reste encore ?", "il y a encore ?", "y'a encore ?", "vous avez la taille 40 ?", "c'est toujours là ?", "ça existe encore ?", "le produit est disponible ?", "je peux avoir … ?", "c'est combien ?" / "ça fait combien ?" (price usually comes with the availability question), "vous livrez à Douala / Yaoundé ?"
**Availability (English):** "is it still available?", "do you still have…?", "any size 42?", "available?", "how much?"
**Availability (Pidgin/Kamtok):** "una get … ?", "you get …?", "e dey?", "e still dey?", "e remain?", "the thing dey?", "how much for dis one?", "na how much?", "you fit bring am for Buea?", "you fit come down?" (discount)
**Availability (Camfranglais):** "tu as encore le ndo ?" (ndo = the thing / stuff), "c'est combien le dos ?" (dos = money), "le ndo est là ?"

**Yes / confirm:** "oui", "ouais", "ok", "okay", "d'accord", "d'acc", "dac", "c'est bon", "ça marche", "je prends", "je valide", "on fait comme ça", "vas-y", "yes", "yes o", "ok o", "na so", "I go take am", "I wan am", "send am", "👍", "✅"
- **"On dit quoi ?"** is a greeting ("what's up?" / "what's the deal?"), **not a yes**. Treat it as a new-conversation opener.
- **"On est ensemble"** means "we're together / agreed / bye". It is an ambiguous closer; do not count it as order consent.
- **Opt-out words** to catch: "stop", "arrêtez", "arrête", "désabonner", "je ne veux plus", "plus de messages", "no send me again", "leave me".

---

## 6. TikTok Business Messaging API

- The official docs say the API is **"in Open Beta in APAC, LATAM, METAP, and North America"** ([TikTok API for Business](https://business-api.tiktok.com/portal/docs/business-messaging-api/v1.3)). METAP is TikTok's Middle East, Turkey, Africa and Pakistan region.
- Third-party summaries say it is available to Business Accounts registered **outside the US, EEA, Switzerland and UK** ([SleekFlow](https://sleekflow.io/en-us/channels-integrations/tiktok-business-messaging)). Media sending is blocked in a list that includes **Nigeria** but not Cameroon.
- **[UNVERIFIED]** Cameroon is not explicitly confirmed. The "Access to Business Messaging API" page did not render for the scraper. Access requires a TikTok developer app, a data-security and privacy review, and a Business Account. The practical route is a BSP (SleekFlow, respond.io).

---

## 7. Seller tools already used in Cameroon

- **The default stack is WhatsApp Business plus Facebook, Instagram and TikTok**, with WhatsApp as the de-facto CRM ([Alivaon 2026](https://www.alivaon.com/blog/meilleurs-logiciels-gestion-commerciale-cameroun), [lefisk.cm](https://lefisk.cm/blog/e-commerce-cameroun-vendre-tiktok-facebook-chine-dropshipping)). Payment is MoMo or Orange Money, often a manual transfer plus a screenshot.
- **No Cameroonian Bumpa-scale equivalent was found.** Bumpa covers Nigeria, Ghana and Kenya (Kenya launch June 2026); Catlog covers Nigeria and Ghana. Neither lists Cameroon.
- Local startups and closest analogues ([F6S, Sep 2026](https://www.f6s.com/companies/e-commerce/cameroon/co)):
  - **Comparo** (Douala, 2024, $20k from AUF): "launch an e-commerce site in 60 seconds", Mobile Money, conversational selling, Francophone Africa. **This is the closest to Bumpa.**
  - **Buyam** (Buea, 2022): "Shopify for traders in emerging markets", with AI marketing and sales tools, escrow and delivery ([buyam.co](https://buyam.co/)).
  - **EBATO** (Douala, 2019): social-media-integrated shopping for stay-at-home resellers.
  - One Market CM (Douala) and Sportings (a marketplace).
- Payment-link tools sellers use directly: **Notch Pay "Quick" payment links**, CamPay payment links and invoices, CinetPay Payment Link, and the Flutterwave store and links.
- POS and management software: GestionsPro and other tools listed by Alivaon. Marketplaces: Jumia CM, Glotelho, Iziway, NKCL Market.
- Gap: none of these advertise **back-in-stock / restock WhatsApp alerts with consent capture**. This is inferred from their listings; their full feature sets were not verified.

---

## Open items to verify
1. A Notch Pay sandbox webhook: which field carries your `reference` (`data.reference` vs `trxref` / `merchant_reference`).
2. The CamPay auth header scheme and the JWT algorithm; the CinetPay v2 fields once the docs resolve.
3. Whether the APDP (the data protection Authority) exists yet, and how prior authorisation (Art. 19) and transfer authorisation (Art. 32) work in practice.
4. Legal opinion on Art. 65 (the profiling offence) as it applies to interest tagging.
5. TikTok BM API access for a Cameroon-registered Business Account.
