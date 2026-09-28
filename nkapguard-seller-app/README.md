# NKAPGUARD Seller App

A WhatsApp selling tool for small businesses, in any country. When a customer asks for
something that's sold out, NKAPGUARD asks whether they want an alert, records their consent, and
puts them on a waitlist. When stock arrives it messages the people at the front of the line
with a payment link and, in hold mode, a real timed hold on a real unit. Unpaid holds pass
down the line.

## Works for any country

Each shop has its own country, currency, language, time zone and payment provider. Picking a
country fills in sensible defaults, and every one of them can be changed.

- **Currency:** any currency. Prices are stored in each currency's smallest unit, so FCFA
  (no subunit), naira (kobo) and dollars (cents) are all exact.
- **Language:** each customer is answered in the language they write in, French or
  English (Pidgin gets English). The shop's setting (English, French, or both, French
  first) covers customers whose language isn't known yet. Cameroon shops default to both,
  because Law 2011/012 (Art. 13) asks for consumer information in French and English. Reading chats works in
  English, French and West/Central African Pidgin ("una get", "e dey", "c'est dispo ?",
  "il en reste ?"). More languages are a matter of adding a translation set.
- **Phone numbers:** any country. Local formats are read in the shop's country
  ("6 77 12 34 56" in Cameroon, "0803 555 2190" in Nigeria).
- **WhatsApp fees:** estimated per country from Meta's rate card, in US dollars because
  that is how Meta bills.
- **Payments:** the seller connects their own account, so money goes straight to them.
  Keys are stored encrypted.

| Provider | Good for | Notes |
|---|---|---|
| Notch Pay | Cameroon: MTN MoMo, Orange Money | No customer email needed; 2% fee |
| Flutterwave | Most of Africa: MTN/Orange Money (XAF, XOF), M-Pesa, Ghana and Uganda mobile money, cards | Each webhook is double-checked with Flutterwave's verify API before it counts |
| Paystack | Nigeria, Ghana, Kenya, South Africa, Côte d'Ivoire | |
| Stripe | Cards in 40+ countries | |

Defaults exist for Cameroon, Nigeria, Ghana, Kenya, South Africa, Côte d'Ivoire, Senegal,
Gabon, Rwanda, Uganda, Tanzania, Egypt, the US, Canada, the UK, France, Belgium, Germany,
India and Brazil. Any other country works once you enter its currency and time zone.

## Accounts

- **Sign in:** sellers sign in with their WhatsApp number and a 6-digit code sent to it
  on WhatsApp. There are no passwords, and it works in any country.
- **Codes:**
  - A code expires after 10 minutes and works only once.
  - 5 wrong guesses lock it.
  - A number can request at most 5 codes an hour.
- **Sessions:** last 30 days and can be signed out. The database stores only hashes of
  codes and sessions.
- **Isolation:** each seller sees only the shops they belong to. Every chat, product,
  restock, insight, consent record and payment setting is checked against the signed-in
  person. Another shop's data answers "not found", so ids reveal nothing.
- **Teams:** whoever creates a shop is its owner. Owners add people by WhatsApp number:
  - **staff** handle chats, stock and restocks
  - **owners** also manage payments, shop details and the team

  A shop always keeps at least one owner.
- **Operator access:** the `ADMIN_TOKEN` is for you, the operator, and sees every shop. In
  test mode with no admin token set, requests without credentials are also treated as the
  operator, so local testing stays quick.

## What it does

- **Reading chats:** spots "is this available?" and matches it to your catalog, including
  the right colour. When a product comes in several colours and the customer doesn't say
  which, it lists them with what's in stock and reads the short answer ("jet black", "le
  noir"). When it isn't sure, it stays quiet and leaves the reply to you.
- **Shop page:** each shop gets a public page, `seller.nkapguard.com/shop.html?s=<link name>`,
  listing what it sells and whether each item is in stock (never how many), in French or
  English. Every item has a WhatsApp button that opens a chat with the question already
  written ("Bonjour, vous avez le modèle … ?"), which the app answers like any other message.
  Settings shows the link and a QR code to print. Customers start the chat themselves, which
  keeps the seller within WhatsApp's rules on contacting people.
- **Consent:** a clear yes ("yes", "oui", "d'accord") is recorded with the customer's exact
  words and the time. Hedged replies ("oui mais c'est combien ?") don't count. STOP (or
  "arrêter") removes them from every list.
- **Restocks:**
  - `hold`: messages one person per unit, each with a timed hold.
  - `race`: messages several per unit, and the first to pay wins. The others get a "sold
    out, you keep your place" note.
- **Honest numbers:** counts, prices and deadlines in messages come from live data, never
  from something the seller types.
- **Payment links:**
  - Alerts carry NKAPGUARD's own link. The provider checkout is created only when the customer
    taps it, and only if the hold still stands. Otherwise the customer sees a clear "this
    offer has ended" page in their language.
  - This matters because some providers' checkouts expire (Notch Pay after 3 hours) before
    a hold does.
- **WhatsApp rules:**
  - Plain replies go out only within 24 hours of the customer's last message.
  - After that, a message goes out only as an approved template, or it's skipped.
  - Payment confirmations fall back to a template automatically.
- **Seller app:** at `/app`, mobile first.
  - Chats, with unread counts and waitlist tags.
  - Replies, blocked with an explanation when the 24-hour window has closed.
  - Stock, and restocks with a live preview of the exact message and the estimated fees.
  - A live restock view showing each hold's countdown.
  - Insights: sales from alerts, fees, what to reorder, refunds due, and the consent log.
  - Settings for the shop and for payments.
- **Test mode (the default):** nothing is sent and payments are simulated. The app can load
  a sample shop in the country you pick, and lets you message the shop as a customer.

## Run it

```bash
npm install
npm test            # 82 tests on an embedded Postgres; no accounts needed
npm run simulate    # a full restock story in a Cameroon shop, in French and English
npm run simulate -- --country NG --lang en
npm run dev         # server on :8787; open http://localhost:8787/app
```

## Testing Flutterwave for real

The automated tests run Flutterwave end to end against a faithful fake of its API: checkout
creation, payment, webhook and verification, plus tampered, failed, duplicate and late
payments. To check against Flutterwave's real sandbox from your own machine:

```bash
FLW_SECRET_KEY=FLWSECK_TEST-xxxx npm run check:flutterwave -- --amount 100 --currency XAF --phone 237677123456
```

It creates a real test checkout, prints the link, waits while you pay with Flutterwave's
test details, and confirms the payment through the verify endpoint. Use test keys only.

## API

Send a session token from `/auth/verify`, or the operator's admin token, as
`Authorization: Bearer <token>`. List endpoints need `?sellerId=` unless you are the
operator.

| Method | Path | What it does |
|---|---|---|
| GET/POST | `/webhooks/whatsapp` | Meta's verification handshake and incoming messages |
| POST | `/webhooks/payments/:sellerId` | Payment webhooks, checked with that seller's own secret |
| GET | `/pay/:ref` | The link in alerts. Opens a fresh checkout, or shows why the offer ended |
| POST | `/auth/start`, `/auth/verify`, `/auth/logout` | Sign in: `{phone, country}` sends a code; `{phone, country, code}` returns a session token |
| GET | `/api/me` | Who is signed in |
| GET/POST/DELETE | `/api/sellers/:id/members` | The shop's team. Adding and removing needs an owner: `{phone, role: "owner" \| "staff"}` |
| GET | `/markets`, `/api/markets` | Country defaults, languages, payment providers and fee estimates |
| GET/POST | `/api/sellers` | List shops, or create one: `{name, waPhoneNumberId, country, currency?, language?, timezone?}` |
| PATCH | `/api/sellers/:id` | Change the name, country, currency, language or time zone |
| PUT | `/api/sellers/:id/payments` | `{provider, secretKey, webhookSecret?}`. Keys are encrypted and never returned |
| POST | `/api/products` | `{sellerId, name, variant?, aliases?, price, stock?}`, with `price` in the shop currency |
| GET/PATCH | `/api/products/:id` | Product, waitlist count and past restocks; or edit it |
| GET | `/api/products/:id/waitlist` | The line in order, with each person's consent wording |
| POST | `/api/products/:id/restocks/preview` | Who would be messaged, the exact wording and the estimated fees. Sends nothing |
| POST | `/api/products/:id/restocks` | `{units, mode: "hold" \| "race", holdMinutes?, perUnit?}` |
| GET | `/api/restocks/:id` | Every offer and its status |
| GET | `/api/chats`, `/api/chats/:id` | Inbox, and one conversation |
| POST | `/api/chats/:id/reply` | Replies, only inside WhatsApp's 24-hour window |
| GET | `/api/insights`, `/api/consents` | Sales, fees, demand, refunds due; the consent log |
| POST | `/api/tick` | Expires holds and passes units on. The server does this every minute (on Supabase, pg_cron calls `/cron/tick`) |

## Going live

1. **Database:** set `DATABASE_URL`, for example to a Supabase pooled connection string.
2. **Secrets:** set `APP_SECRET` to a long random value, and `ADMIN_TOKEN`.
3. **Sign-in number:** set `PLATFORM_WA_PHONE_ID` to NKAPGUARD's own WhatsApp number, which
   sends sign-in codes. Then submit an **authentication** template named `login_code_v1`
   with a copy-code button. Meta supplies the wording for authentication templates.
4. **WhatsApp:**
   1. Create a Meta app with WhatsApp, and add the seller's number. Coexistence lets the
      seller keep using the WhatsApp Business app on the same number.
   2. Set `WA_TOKEN` and `WA_APP_SECRET`.
   3. Set the webhook to `https://<host>/webhooks/whatsapp`, and subscribe to `messages`.
   4. Add a payment method in Meta Business Manager. Without one, Meta stops delivering
      service messages beyond the free tier from 1 October 2026.
5. **Templates:** submit the templates below in each language your shops use (`en`, `fr`),
   plus the bilingual set if any shop uses French and English.
6. **Payments:** in the seller app, go to Settings › Get paid. Pick the provider, paste the
   keys, and paste the webhook URL it shows into the provider's dashboard.
7. Set `DRY_RUN=false`. The server refuses to start live if any required setting is
   missing.

### Instagram and Messenger (optional, per shop)

Each shop turns on only the apps it sells on, in Settings → Channels. WhatsApp is always on,
because it's the only one that can send a restock alert days later: Meta retired message tags
and Instagram marketing messages, and Messenger's paid marketing messages aren't open to
businesses in Africa. So Instagram and Messenger are for answering and capturing:

- DMs asking about a product get the same answers as WhatsApp (price, which colour, sold out),
  in the customer's language, within Meta's 24-hour reply window. Replies are free.
- A sold-out answer carries a WhatsApp link with "Bonjour, prévenez-moi quand le modèle …
  revient" already written. Sending it puts the customer on the waitlist in one step, and
  their own words are the consent record. The shop page's "Alert me" button does the same.
- A comment asking about price or stock ("prix ?", "dispo ?") gets one private reply (Meta
  allows one per comment): the product answer, or the shop page link. At most once per person
  per post per day, and each shop can switch comment replies off.
- A paused channel still records nothing and answers nothing; disconnecting keeps past chats.

Setup in the Meta app (developers.facebook.com → NKAPGUARD Seller App):

1. **Instagram:** add the use case "Manage messaging & content on Instagram" (Instagram API
   with Instagram Login). Copy its **Instagram app ID** and **Instagram app secret** into
   Supabase secrets as `IG_APP_ID` and `IG_APP_SECRET`. Add the redirect URL
   `https://psalpplvvygliobywsda.supabase.co/functions/v1/seller-app/oauth/instagram`, and set
   the webhook to `…/seller-app/webhooks/meta` with the same verify token as WhatsApp,
   subscribed to `messages` and `comments`.
2. **Messenger:** add the use case "Engage with customers on Messenger from Meta". Add the
   Facebook Login redirect URL `…/seller-app/oauth/facebook`, and a Page webhook to
   `…/seller-app/webhooks/meta` subscribed to `messages`, `messaging_postbacks` and `feed`.
   `META_APP_ID` is set in the deployed defaults; `META_APP_SECRET` falls back to
   `WA_APP_SECRET`, since it's the same app.
3. Until Meta's App Review approves the permissions (it needs business verification), only
   accounts with a role on the app can connect and message. That's enough to test with your
   own Instagram account and Page.

Data deletion: in App settings → Basic, set "User data deletion" to **Data deletion callback
URL** `…/seller-app/meta/data-deletion`. In Instagram business login settings, use the same
URL for "Data deletion request URL" and `…/seller-app/meta/deauthorize` for "Deauthorize
callback URL". Both check Meta's signed_request and delete that person's Instagram/Messenger
chats (with their consents and waitlist places) straight away; the deletion one answers with
a confirmation code and a status page on seller.nkapguard.com/data-deletion.html.

Instagram tokens last 60 days; the scheduler refreshes them a week before they expire.
TikTok DMs need TikTok's Business Messaging API and its data-security review, so for now
sellers put their shop page link in their TikTok bio.

### WhatsApp templates

Meta decides each template's category when it reviews it, and that decides the price.
Restock alerts will probably be classed as marketing (Cameroon and the rest of "Rest of
Africa": about $0.0225 a message; Nigeria: about $0.0516). Templates can't start or end
with a variable.

The texts below are generated from `src/domain/copy.ts` (`templateBody`), and a test checks
that this table still matches, so submit them to Meta exactly as written.

The app can submit them all for you with a token that has `whatsapp_business_management`:
`POST /api/admin/templates?wabaId=<WhatsApp Business Account id>` with the admin token.
`GET` on the same URL shows Meta's review status. Templates Meta already has are skipped,
so running it again only submits what's missing. Meta only accepts the authentication
template (`login_code_v1`) once the business is verified.

| Name | Category | English | French |
|---|---|---|---|
| `restock_hold_v1` | Marketing | Hi {{1}}, good news: the {{2}} is back! Units in: {{3}}. People waiting: {{4}}. We're holding one for you until {{5}}. Pay {{6}} here to secure it: {{7}} (Reply STOP to leave the list.) | Bonjour {{1}}, bonne nouvelle : le modèle {{2}} est de retour ! Arrivage : {{3}}. Personnes en attente : {{4}}. Nous vous en réservons un jusqu'à {{5}}. Pour le garder, réglez {{6}} ici : {{7}} (Répondez STOP pour quitter la liste.) |
| `restock_race_v1` | Marketing | Hi {{1}}, good news: the {{2}} is back! Units in: {{3}}. People notified: {{4}}. The first to pay {{5}} gets it: {{6}} (Reply STOP to leave the list.) | Bonjour {{1}}, bonne nouvelle : le modèle {{2}} est de retour ! Arrivage : {{3}}. Personnes prévenues : {{4}}. Le premier à régler {{5}} l'emporte : {{6}} (Répondez STOP pour quitter la liste.) |
| `restock_sold_out_v1` | Utility | Sorry {{1}}, the {{2}} sold out before your payment came through. You're still on the list, and we'll let you know about the next restock. | Désolés {{1}}, le modèle {{2}} est parti avant votre paiement. Vous restez sur la liste et nous vous préviendrons au prochain arrivage. |
| `payment_received_v1` | Utility | Payment received, thank you! The {{1}} is yours. We'll be in touch shortly about delivery. | Paiement bien reçu, merci ! Le modèle {{1}} est à vous. Nous revenons très vite vers vous pour la livraison. |
| `payment_refund_v1` | Utility | We received your payment, but the last {{1}} sold just moments before. We're refunding you in full, and you keep your place on the list. | Nous avons bien reçu votre paiement, mais le dernier modèle {{1}} a été vendu quelques instants plus tôt. Nous vous remboursons intégralement, et vous gardez votre place sur la liste. |

### Bilingual templates (French and English)

For shops set to "French and English". Register each under the same base name with the
suffix `_bilingual`, in language `fr`. The French half uses slots 1–7 and the English half
8–14, because names, prices and times are written differently in each language: "Claw Clip
marron · 15 000 FCFA · 12:00" versus "brown Claw Clip · FCFA 15,000 · 12:00 PM". For the
same reason, write variants in both languages, like `Marron / Brown`. Customers can use
either word, and each half of the message picks its own.

Each customer is answered in the language they write in: French in, French out; English or
Pidgin in, English out. The app remembers it for later alerts and confirmations. The shop's
setting (including "French and English") is only used until a customer's language is known,
for example after a message like "ok" or "👍".

| Name | Body |
|---|---|
| `restock_hold_v1_bilingual` | Bonjour {{1}}, bonne nouvelle : le modèle {{2}} est de retour ! Arrivage : {{3}}. Personnes en attente : {{4}}. Nous vous en réservons un jusqu'à {{5}}. Pour le garder, réglez {{6}} ici : {{7}} (Répondez STOP pour quitter la liste.)<br><br>Hi {{8}}, good news: the {{9}} is back! Units in: {{10}}. People waiting: {{11}}. We're holding one for you until {{12}}. Pay {{13}} here to secure it: {{14}} (Reply STOP to leave the list.) |
| `restock_race_v1_bilingual` | Bonjour {{1}}, bonne nouvelle : le modèle {{2}} est de retour ! Arrivage : {{3}}. Personnes prévenues : {{4}}. Le premier à régler {{5}} l'emporte : {{6}} (Répondez STOP pour quitter la liste.)<br><br>Hi {{7}}, good news: the {{8}} is back! Units in: {{9}}. People notified: {{10}}. The first to pay {{11}} gets it: {{12}} (Reply STOP to leave the list.) |
| `restock_sold_out_v1_bilingual` | Désolés {{1}}, le modèle {{2}} est parti avant votre paiement. Vous restez sur la liste et nous vous préviendrons au prochain arrivage.<br><br>Sorry {{3}}, the {{4}} sold out before your payment came through. You're still on the list, and we'll let you know about the next restock. |
| `payment_received_v1_bilingual` | Paiement bien reçu, merci ! Le modèle {{1}} est à vous. Nous revenons très vite vers vous pour la livraison.<br><br>Payment received, thank you! The {{2}} is yours. We'll be in touch shortly about delivery. |
| `payment_refund_v1_bilingual` | Nous avons bien reçu votre paiement, mais le dernier modèle {{1}} a été vendu quelques instants plus tôt. Nous vous remboursons intégralement, et vous gardez votre place sur la liste.<br><br>We received your payment, but the last {{2}} sold just moments before. We're refunding you in full, and you keep your place on the list. |

A bilingual message is one WhatsApp message, so it costs the same as a single-language one.

## Legal notes to check before launch

This is not legal advice; have a local lawyer review the points for each country you launch
in.

- **Consent:** every alert is based on recorded, express, prior consent, and every message
  offers STOP. That matches what Nigeria's NDPA, Cameroon's Law 2024/017 and GDPR-style
  laws require for marketing.
- **Cameroon:**
  - Law 2024/017 makes "profiling" a criminal offence (Art. 65), and requires prior
    authorisation from the data protection Authority. Get a lawyer's view on whether
    waitlist tags count as profiling.
  - Law 2011/012 (Art. 13) requires consumer information in French and English, which the
    "French and English" language setting covers.
- **Scarcity claims:** counts come from live data only, because false scarcity breaches
  consumer law in Nigeria (FCCPA s.123), Cameroon (Law 2011/012 Art. 8), the EU and the UK.

## Not built yet

- **Instagram, Facebook and TikTok DMs:** the data model and inbox are already
  channel-aware, but these need Meta app review and TikTok Business Messaging API access.
- **More languages:** a translation set per language, plus an LLM classifier for messages
  the rule-based matcher misses.
- **Other providers:** CinetPay and CamPay.
- **Automatic refunds:** late payments are flagged for refund, but the refund isn't sent
  through the provider's refund API yet.

## Deployed on Supabase (pilot)

The backend runs as the `seller-app` edge function in the **nkapguard** Supabase project, with
its data in its own `seller_app` schema. The rest of that project (NKAPGUARD's public tables,
data and other functions) is not read or changed.

- **API:** `https://psalpplvvygliobywsda.supabase.co/functions/v1/seller-app`
  (`/health` answers `{"ok":true,...}`)
- **Seller app:** `https://seller.nkapguard.com`, served by GitHub Pages from the
  `jlawrantine20-dot/nkapguard-seller` repo (a copy of `web/`, plus a `CNAME` file). The DNS
  record is a CNAME from `seller` to `jlawrantine20-dot.github.io`, in Vercel DNS. To
  publish a change, copy `web/` into that repo and push.
- **Schema:** `deploy/seller_app_schema.sql`, applied as the `seller_app_schema` migration.
  Every name is schema-qualified, every table has row-level security on, and the public
  API roles have no access.
- **Database user:** the function connects as `seller_app_fn`, which Postgres caps at 10
  connections, and it can only reach the `seller_app` schema (`deploy/seller_app_role.sql`).
  Each function instance holds at most one connection and closes it after 2 idle seconds,
  so the seller app can't use up the connections NKAPGUARD needs.
- **Function files:** `edge/deployed/`. The app itself is `edge/dist/remote.js` at the pinned
  commit, served by jsDelivr.

The app screens are hosted separately because Supabase serves HTML from functions and Storage
as plain text on its own domain. Customer payment pages are drawn by `web/pay.html` on the app
host.

**Updating:**
1. Run `npm run build:edge`, commit and push.
2. Point `edge/deployed/index.ts` and the `APP_URL` in `deps.ts` at the new commit.
3. Redeploy the function.

**It runs in test mode:** nothing is sent to WhatsApp and payments are simulated. Sign-in codes
are shown on screen, so anyone with the link can sign in as any number. Use test data only
until WhatsApp is connected.

**To go live**, set these in Supabase under Edge Functions › Secrets:
- `DRY_RUN=false`
- `ADMIN_TOKEN`
- `WA_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`
- `PLATFORM_WA_PHONE_ID`
- `APP_SECRET`: optional. It defaults to a key derived from the service role key; set it
  before sellers save payment keys.

Expired holds are passed on every minute by a pg_cron job (`deploy/seller_app_cron.sql`)
that calls `POST /cron/tick` through pg_net. That endpoint needs the `x-cron-secret` header,
kept in Supabase Vault as `seller_app_cron_secret` and given to the function as
`CRON_SECRET`; it can run the hold timer and nothing else. Other requests also pass holds
on, at most once a minute, as a backstop. To pause the job:
`select cron.unschedule('seller-app-tick');`
