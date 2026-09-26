# Oja MVP

Backend for a WhatsApp seller tool. When a customer asks for something that's sold out,
Oja asks whether they want an alert, records their consent, and puts them on a waitlist.
When stock arrives, it messages the people at the front of the line with a Paystack link
and, in hold mode, a real timed hold on a real unit. Unpaid holds pass down the line.

`Oja` is a placeholder name.

## What works today

- **Reading chats:** it spots "is this available?" questions in English and Pidgin
  ("una get", "e dey") and matches them to your catalog, including the right colour or
  variant. When it isn't sure, it stays quiet and leaves the reply to you.
- **Consent:** a clear YES records consent with the customer's exact words and the time
  (NDPA s.26 and GAID 2025). Hedged replies like "yes but how much?" don't count. STOP
  revokes consent and removes the customer from every list.
- **Restocks, two modes:**
  - `hold`: messages one person per unit, each with a timed hold. When a hold lapses, that
    unit goes to the next person in line.
  - `race`: messages several people per unit at once, and the first to pay wins. Everyone
    else gets a "sold out, you keep your place" note.
- **Honest numbers:** every count and deadline in a message comes from live stock and
  waitlist data. Sellers can't type them in (FCCPA s.123).
- **Payments:**
  - Each alert carries its own Paystack link.
  - Payments are matched by the Paystack webhook, which checks the signature.
  - A duplicate payment or one for less than the price is ignored.
  - A payment that arrives after the last unit sold is flagged for refund.
  - Oja never holds the money; it goes straight to the seller's Paystack account.
- **WhatsApp rules:**
  - Plain replies go out only within 24 hours of the customer's last message.
  - After that, a message goes out only as an approved template, or it's skipped.
  - Every outgoing message is logged with its estimated Meta charge.
- **Dry-run mode (the default):** nothing is sent and payments are simulated, so all of
  the above can be tested without any accounts.

## Run it

```bash
npm install
npm test            # 36 tests on an embedded Postgres; needs no accounts
npm run simulate    # plays a full restock story in the terminal
npm run dev         # API on :8787, dry run, data in ./.data
```

To try the API while it runs in dry-run mode:

```bash
curl -X POST localhost:8787/api/sellers -H 'content-type: application/json' \
  -d '{"name":"Lekki Hair Plug","waPhoneNumberId":"1098765432"}'
curl -X POST localhost:8787/api/products -H 'content-type: application/json' \
  -d '{"sellerId":"<id>","name":"12\" Claw Clip Ponytail","variant":"Brown","priceNaira":18500}'
# Post a customer message the way Meta would (see test/http.test.ts for the payload shape),
# then log a restock:
curl -X POST localhost:8787/api/products/<id>/restocks -H 'content-type: application/json' \
  -d '{"units":3,"mode":"hold","holdMinutes":120}'
curl -X POST localhost:8787/dev/pay/<payment_ref>   # pretend the customer paid
```

## API

The admin token is required as `Authorization: Bearer <ADMIN_TOKEN>`. In dry-run mode with
no token set, the API is open.

| Method | Path | What it does |
|---|---|---|
| GET/POST | `/webhooks/whatsapp` | Meta's verification handshake and incoming messages |
| POST | `/webhooks/paystack` | `charge.success` events |
| POST | `/api/sellers` | `{name, waPhoneNumberId}` |
| POST | `/api/products` | `{sellerId, name, variant?, aliases?, priceNaira, stock?}` |
| GET | `/api/products?sellerId=` | Products with waitlist counts |
| GET | `/api/products/:id/waitlist` | Line in order, with each person's consent wording |
| POST | `/api/products/:id/restocks` | `{units, mode: "hold" \| "race", holdMinutes?, perUnit?}` |
| GET | `/api/restocks/:id` | Every offer and its status (held, paid, expired, missed, refund due) |
| GET | `/api/consents?sellerId=` | Consent log, including opt-outs |
| GET | `/api/spend?sellerId=` | Messages sent and estimated Meta charges, by category |
| POST | `/api/tick` | Expires holds and passes units on. The server does this every minute; call it from a cron job if you deploy to serverless |
| POST | `/dev/pay/:ref` | Dry run only: simulate a payment |

## Going live

1. **Database:** create a Supabase project and set `DATABASE_URL` to its pooled
   connection string. Migrations run automatically when the server starts.
2. **WhatsApp:**
   1. Create a Meta app with the WhatsApp product and add the seller's number. Coexistence
      lets the seller keep using the WhatsApp Business app on the same number.
   2. Set `WA_TOKEN` (a permanent system-user token) and `WA_APP_SECRET`.
   3. Set the webhook to `https://<your host>/webhooks/whatsapp` with your
      `WA_VERIFY_TOKEN`, and subscribe to `messages`.
   4. Register the seller with the number's `phone_number_id`.
3. **Templates:** submit the five templates below in WhatsApp Manager and wait for
   approval.
4. **Paystack:** set `PAYSTACK_SECRET_KEY`, then set the webhook URL to
   `https://<your host>/webhooks/paystack`. Paystack needs an email for every payment, so
   buyers get `<whatsapp number>@PAYSTACK_EMAIL_DOMAIN`. Use a domain you own.
5. Set `DRY_RUN=false` and `ADMIN_TOKEN`. The server refuses to start live if any of
   these are missing.

### WhatsApp templates to submit

Meta sets each template's category when it reviews it, and that decides the price
(reported Nigeria rates from October 2026: about ₦84 marketing, about ₦14 utility).
Restock alerts will probably be classed as marketing. The alert templates end with a
sentence because Meta rejects templates that start or end with a variable.

| Name | Suggested category | Body |
|---|---|---|
| `restock_hold_v1` | Marketing | Hi {{1}}, the {{2}} is back. {{3}} came in and {{4}} people are waiting. One is held for you until {{5}}. Pay {{6}} to keep it: {{7}} Reply STOP to leave the list. |
| `restock_race_v1` | Marketing | Hi {{1}}, the {{2}} is back. {{3}} came in and we're telling the first {{4}} people on the list. First to pay {{5}} gets one: {{6}} Reply STOP to leave the list. |
| `restock_sold_out_v1` | Utility | Sorry {{1}}, the {{2}} sold out before you got one. You're still on the list for the next restock. |
| `payment_received_v1` | Utility | Payment received, thank you. Your {{1}} is yours. We'll message you about delivery. |
| `payment_refund_v1` | Utility | We received your payment, but the last {{1}} sold a moment earlier. We're refunding you in full and you keep your place on the list. |

## Not built yet

- **Seller app:** the clickable prototype shows the planned screens. This backend is the
  API those screens would use.
- **Instagram and Facebook DMs:** these need Meta app review. Their automated-reply window
  is 24 hours, so the plan is to ask for a WhatsApp number inside that window.
  `findNgPhone` already pulls the number out of a reply.
- **Smarter reading of chats:** an LLM classifier for messages the rule-based matcher
  misses, and photo-to-product matching.
- **Seller accounts:** proper logins for each seller (today there is one admin token), and
  a wallet that shows the message cost before each send.
- **Automatic refunds:** a late payment is flagged for refund, but the refund isn't sent
  through Paystack's refund API yet.
- **Tracking which ad produced a sale:** Click-to-WhatsApp ads, referral links, and past
  customer win-back.
