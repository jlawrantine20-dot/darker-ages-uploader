# Back-in-Stock, Waitlist, Price-Drop & Pre-Order Tools + Scarcity/Messaging Rules (as of Sept 2026)

Method note: Most vendor, Meta, Nike and Nigerian news pages were blocked by the network proxy for direct fetching (apps.shopify.com, developers.facebook.com, whatsappbusiness.com, klaviyo.com, getswym.com, nike.com, legit.ng, businessday.ng, attentivemobile.com). Findings below come from search-result extracts of those pages (URLs cited are the originals the search engine summarised). Treat numbers as "reported"; the report writer should flag where verification against the primary page was not possible. Also note: the user's "Biztom" may be **Bizthom** (bizthom.com, a Nigerian AI commerce tool with WhatsApp cart follow-ups) — [Bizthom](https://bizthom.com/?amp=&amp=); no source found describing a restock-tagging product under either name.

## 1. What mature back-in-stock / waitlist / price-drop / pre-order tools do (per-tool profiles)

### Takeaway
Mature tools converge on the same core: a "Notify me" capture at variant level, multi-channel alerts (email + SMS, increasingly WhatsApp/push), inventory-aware batching so you don't notify more people than you have stock for, demand analytics by product/variant, and pre-order/deposit fallback. Genuinely "fair" allocation (lottery, invitation, holds, reserved checkout windows) exists mainly at large brands (Nike, Amazon), not in Shopify apps — this is an open gap a WhatsApp-native tool could fill.

### Cited Findings

**Klaviyo (email/SMS/WhatsApp platform)**
- Back-in-stock (BIS) ordering/fairness control: "customers to notify" per unit. Example: 20 units restocked, setting = 5 → the **oldest 100 subscribers** are notified (i.e., first-come ordering by signup age); a "wait time between notifications" sends further batches while inventory remains above a minimum threshold; "minimum inventory" sets how many units must be restocked before anyone is notified — [Klaviyo Help: How to build a back in stock flow](https://help.klaviyo.com/hc/en-us/articles/115003872251) (via search summary); also [Lebesgue guide](https://lebesgue.io/email-marketing/klaviyo-back-in-stock)
- Feb 2026: Klaviyo released **Back in Stock Forms for WhatsApp**, collecting WhatsApp consent alongside SMS on BIS forms; BIS forms only for Shopify and BigCommerce; smart opt-in / tap-to-text not supported for BIS forms — [Klaviyo Feb 2026 product updates](https://community.klaviyo.com/product-updates-announcements-51/february-2026-product-updates-19034); [Klaviyo Help: BIS form](https://help.klaviyo.com/hc/en-us/articles/38767539287323)
- Custom (non-Shopify) catalogs can use BIS via API — [Klaviyo dev docs](https://developers.klaviyo.com/en/docs/how_to_set_up_custom_back_in_stock)
- **Price drop flow**: alerts people who viewed or started checkout on an item when price drops by a set amount or percentage; only triggers for in-stock items; does not send to anyone who already bought the item — [Klaviyo Help: price drop flow](https://help.klaviyo.com/hc/en-us/articles/4404249033755)
- **Low inventory flow**: alerts people who viewed/added to cart/started checkout when product or specific variant hits low inventory — [Klaviyo Help: low inventory flow](https://help.klaviyo.com/hc/en-us/articles/21374913673243); [Klaviyo blog](https://www.klaviyo.com/blog/low-inventory-flows)

**Appikon – Back In Stock (Shopify)**
- Plans: Free, Starter $19.99/mo, Pro $29.99/mo, Premium $49.99/mo — [Clickpost comparison](https://www.clickpost.ai/blog/back-in-stock-apps-for-shopify); [Appikon pricing](https://start.bis.appikon.com/pages/pricing.html)
- Channels: email, SMS, Facebook Messenger, web push; analytics dashboard, mailing-list integrations, customisable forms — same sources; [Appikon site](https://www.appikon.com/back-in-stock)
- ~4.7 stars, 1,000+ reviews (reported) — [eShipz](https://www.eshipz.com/blog/best-back-in-stock-apps/). No WhatsApp support found.

**Notify! Back in Stock | PreOrder ("Notify Me!", Shopify)**
- Listing positions it as "waitlist, preorder, wishlist and low stock — all in one"; channels email, SMS, push — [Shopify listing](https://apps.shopify.com/preorder-back-in-stock); [reviews](https://apps.shopify.com/preorder-back-in-stock/reviews). Pricing not retrieved (page blocked).

**Swym Back in Stock Alerts (+ Wishlist Plus)**
- Vendor claims **30–35% CTR, 20% conversion** on BIS alerts (vendor marketing, unaudited) — [Swym feature page](https://www.getswym.com/features/back-in-stock-product-alerts)
- Features: Notify-me button, email/SMS alerts, pre-orders, AI in-stock recommendations for OOS items, **batch alert send**, "coming soon" alerts, analytics of popular products; from $19.99/mo, Starter up to 1k alert requests/mo — [Swym app listing summary](https://apps.shopify.com/watchlist); [ecommercetech.io](https://ecommercetech.io/apps/swym)
- Demand dashboard: subscriber counts by product/variant, trends over time, conversion on restock — [pickyourapp](https://pickyourapp.com/products/watchlist) (third-party summary)
- Integrations: Klaviyo, Omnisend, Sailthru, Listrak, Bluecore, Bloomreach, dotdigital, Mailchimp, Ometria, Twilio, Postscript — same

**Restock Rocket → now STOQ (Shopify)**
- Lite $10/mo, Standard $29/mo, Pro $69/mo, free plan; paid plans add charges for SMS and pre-orders beyond limits — [Prediko](https://www.prediko.io/blog/best-shopify-back-in-stock-apps)
- Pre-orders, backorders, presales **with deposits/partial payment**, BIS email/SMS, multi-location, Klaviyo sync, markets, reminder alerts, multilingual — [STOQ site](https://www.stoqapp.com/); [Shopify listing](https://apps.shopify.com/back-in-stock-restock-alerts)

**Omnisend**
- Benchmark: BIS emails had the highest conversion rate among automation types (6.46%) and highest revenue per email ($9.14) — [Omnisend email statistics](https://www.omnisend.com/blog/email-marketing-statistics/)
- Automated SMS $0.74–0.75/send vs $0.15 campaign; automated SMS CTR 20.34% vs campaign 12.39%; click-to-conversion 3.81% vs 0.97% — [Omnisend SMS benchmarks](https://www.omnisend.com/blog/sms-marketing-benchmarks/); push automation click-to-conversion ~22.9% — [Omnisend 2026 report](https://www.omnisend.com/resources/reports/2026-ecommerce-marketing-report/)

**Attentive (SMS/email)**
- Back in Stock Waitlist: visitors enroll per variant (size/colour); when replenished, triggered SMS/email with purchase link; works with Shopify, other platforms, custom/headless — [Attentive: BIS Waitlist overview](https://help.attentive.com/hc/en-us/articles/17145192481172-Back-in-Stock-Waitlist-overview)
- "Back in Stock Opt In" journeys (SMS-only or SMS+email templates) — [Attentive help](https://help.attentivemobile.com/hc/en-us/articles/16791689189652-Create-a-Back-in-Stock-Opt-In-journey)
- Configurable **inventory thresholds** for BIS and waitlist journeys (article exists; details not retrievable) — [Attentive thresholds](https://help.attentivemobile.com/hc/en-us/articles/36388202394516-Set-up-back-in-stock-and-back-in-stock-opt-in-waitlist-journey-inventory-thresholds)
- Postscript: listed as a Swym integration partner; no Postscript BIS detail found — [ecommercetech.io](https://ecommercetech.io/apps/swym)

**Pre-order apps**
- Timesact: pre-order + BIS + coming-soon, auto-toggles pre-order/backorder/BIS by inventory; partial payments (e.g., 30% deposit, balance on set date); flat monthly pricing, no transaction fee — [PreProduct comparison](https://preproduct.io/timesact-alternative/); [Timesact blog](https://timesact.com/2025/05/20/partial-payments-on-preorders/)
- PreProduct: Starter free + 5% commission; strong on pay-later/deposit, dunning on deferred charges (competitor-authored claims) — [PreProduct](https://preproduct.io/best-pre-order-app-for-shopify/)

**WhatsApp-native / WhatsApp-capable BIS apps**
- Stok (Shopify): BIS, price-drop and pre-order alerts via email, SMS, **WhatsApp** and push; 4.7 (111 reviews) — [Stok listing](https://apps.shopify.com/notifyme)
- "Notify: Back in stock WhatsApp" app; Notifica-Me (Shopify Flow → email/SMS/WhatsApp; free 100 alerts/mo to $49.90/mo unlimited); "WhatsApp Back in Stock & More" — [HeyCarson](https://www.heycarson.com/apps/reviews/back-in-stock-whatsapp-alerts); [Shopify listing](https://apps.shopify.com/simple-stock-alerts)
- Interakt offers BIS alerts alongside cart recovery on WhatsApp; Zoko syncs Shopify inventory to WhatsApp API messaging; customers can enter WhatsApp number on Notify-Me — [Zoko blog](https://www.zoko.io/post/whatsapp-shopify-stock-alerts-top-apps-practices) (vendor content). No Wati- or DelightChat-specific BIS detail found.

**Large-brand allocation patterns**
- Nike SNKRS **Draw**: random lottery; entry window ~10 min (hot items 2–3 min); payment captured at entry but **charged only if selected** — [drop-list guide](https://www.drop-list.com/guides/nike-snkrs-explained/); [Nike draw rules](https://www.nike.com/help/a/nike-launch-drawing); [Snobette](https://snobette.com/2020/12/nike-snkrs-app-tutorial-reservation-draw/)
- SNKRS **Exclusive Access**: Nike pre-selects users meeting criteria (prior purchases/entries, engagement like "notify me" and SNKRS Live) — [Nike: Inside SNKRS Fairness](https://www.nike.com/launch/t/inside-snkrs-fairness); [Complex](https://www.complex.com/sneakers/a/cmplxvictor-deng/nike-inside-snkrs-exclusive-access-bots)
- Nike removes ~20M bot submissions/month; multiple accounts can get users blocked; ~12B bot entries/month reported in 2023 — [Nike bot protection](https://www.nike.com/launch/t/inside-snkrs-bot-protection); [SneakerNews](https://sneakernews.com/2023/05/03/nike-snkrs-bots/)
- Amazon **Invite-only**: "Request invitation" on product page, one request per item, free, Prime not required; selection weighs account history/age to deter bots/resellers; invitees get email and a **timed purchase window** shown by countdown; unselected requests roll over if more stock arrives — [Amazon help](https://www.amazon.com/gp/help/customer/display.html?nodeId=GALNNSRHJU49GBVM); [TechCrunch](https://techcrunch.com/2022/06/02/amazon-invite-only-ordering-option-ps5-xbox-series-x/); [Adweek](https://www.adweek.com/commerce/amazon-invite-only-orders/)

### Inferences
- The strongest idea to port to WhatsApp DM commerce: Amazon-style **invitation + time-boxed hold** ("You're #12; we've held 1 pair for you until 6pm, reply PAY") combined with Klaviyo-style **N-notified-per-unit batching** — this makes "only 3 came in, 300 interested" honest and actionable rather than a blast that frustrates 297 people.
- Priority tiers (past buyers, deposit-payers first) mirror SNKRS Exclusive Access; deposit-backed waitlists mirror STOQ/Timesact pre-orders and also filter tyre-kickers.
- Demand analytics (waitlist count per variant) is table stakes (Swym, Appikon); a DM-tagging tool can add richer signal (price asked, location, sizes) to guide reorder quantities.
- None of the Shopify apps surveyed advertise stock reservation/holds for waitlisters; this appears to be a differentiator (not confirmed exhaustively).

### Gaps
- Exact current pricing/limits for Notify! (Notify Me!), Swym tiers above Starter, Klaviyo BIS SMS/WhatsApp costs, Interakt/Wati/DelightChat restock features — pages blocked.
- No Shopify app found documenting random-draw or VIP-priority ordering; Klaviyo documents oldest-first only.
- ASOS "notify me"/waitlist mechanics not researched (no results retrieved).

## 2. Benchmark conversion rates for back-in-stock vs other messages

### Takeaway
BIS is consistently the highest-converting automation in published benchmarks: ~6.5–6.7% conversion and ~$9.14 revenue per recipient for email, versus ~$0.11–0.15 per campaign send; SMS automations earn ~5x campaigns per send.

### Cited Findings
- Omnisend: BIS email conversion 6.46% (highest of automations), $9.14 revenue per email — [Omnisend](https://www.omnisend.com/blog/email-marketing-statistics/)
- Agency compilation (2026): BIS flows 6.72% conversion, ~$9.14 RPR vs $0.11 for typical campaign send — [Darkroom](https://www.darkroomagency.com/observatory/email-marketing-benchmarks-ecommerce-2026) (note: the $9.14 figure appears to be Omnisend's, re-cited)
- Klaviyo blog case: one brand's BIS email converted at 7.9% vs BIS SMS at 8.5%; SMS flows are 7.6% of SMS sends but 45.2% of SMS revenue — [Klaviyo blog](https://www.klaviyo.com/blog/how-back-in-stock-text-messages-turn-waitlists-into-revenue)
- Agency claims BIS flows "typically convert at 10–15%" and recover 15–25% of stockout revenue (unsourced agency claims, treat with caution) — [Pea Soup Digital](https://peasoupdigital.co.uk/blog/how-to-set-up-klaviyo-back-in-stock-flow); [easyappsecom](https://easyappsecom.com/guides/shopify-waitlist-strategy)
- Swym vendor claim: 30–35% CTR, 20% conversion — [Swym](https://www.getswym.com/features/back-in-stock-product-alerts)
- WhatsApp "99% open rate" claims are vendor marketing, no primary data — [Condia](https://thecondia.com/sell-on-whatsapp-business-nigeria/)

### Inferences
- For a Nigerian WhatsApp-first product, per-message cost matters more than in email: at ~$0.05–0.06 per marketing template, notifying 300 people for 3 units costs ~$15–19 — another economic reason for inventory-aware batching.

### Gaps
- No published benchmarks found for WhatsApp or Instagram DM back-in-stock conversion specifically, or for Nigeria/Africa.

## 3. Legality/ethics of scarcity & urgency messaging (FTC, EU, UK CMA, Nigeria FCCPC)

### Takeaway
Scarcity claims are lawful only if true and substantiable. US, EU and UK all explicitly target fake low-stock and fake-deadline claims; Nigeria's FCCPA s.123 bans false/misleading representations about supply conditions and price, with FCCPC fines up to 10% of turnover. "Only 3 came in, you're among 300 interested" is fine if both numbers are real and current.

### Cited Findings
- FTC "Bringing Dark Patterns to Light" (Sept 2022) names false scarcity/low-stock claims and fake countdown timers as deceptive — [FTC report PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf); [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers)
- Commentary: FTC scrutiny extends to reset-on-reload timers, manufactured social-proof counters and identical "Only X left" badges (secondary source) — [scandiweb](https://scandiweb.com/blog/scarcity-marketing-examples-tactics/)
- EU UCPD Annex I point 7 (blacklist, always unfair): falsely stating a product will only be available for a very limited time/terms to elicit an immediate decision — [EUR-Lex UCPD](https://eur-lex.europa.eu/LexUriServ/LexUriServ.do?uri=OJ%3AL%3A2005%3A149%3A0022%3A0039%3Aen%3APDF)
- EU Digital Fairness Act proposal planned for Q4 2026, targeting dark patterns and unfair personalisation — [European Parliament legislative train](https://www.europarl.europa.eu/legislative-train/theme-protecting-our-democracy-upholding-our-values/file-digital-fairness-act)
- UK DMCC Act consumer provisions in force 6 April 2025; CMA can fine up to 10% of global turnover directly; CMA guidance: countdown timers must be substantiated — misleading if price doesn't change at zero or a near-identical promo restarts — [CMS](https://cms.law/en/gbr/legal-updates/the-dmcc-act-consumer-elements-come-into-force-from-6-april-2025); [Ashurst](https://www.ashurstperkinscoie.com/en/insights/mind-the-nudge-the-dmccs-crackdown-on-manipulative-online-design/)
- 18 Nov 2025: CMA opened 8 investigations and warned 100+ firms over drip pricing, hidden fees and misleading countdown timers — [Bird & Bird](https://www.twobirds.com/en/insights/2025/uk/cma-launches-major-consumer-enforcement-drive-focused-on-online-pricing-practices); [Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2025/12/aq-cma-announces-first-eight-investigations-into-consumer-law-breaches-using-new-enforcement-powers)
- Nigeria FCCPA 2018 s.123: prohibits false, misleading, erroneous, fraudulent or deceptive representations incl. about "manner or conditions of supply" and price; s.124: no coercion/harassment/unfair tactics or exploiting illiteracy — [LawGlobal Hub s.123](https://www.lawglobalhub.com/section-123-federal-competition-and-consumer-protection-act-2018/); [FCCPC: FCCPA](https://fccpc.gov.ng/resources-library/fccpa/); penalties up to 10% of turnover — [Law Kernel](https://lawkernel.ng/consumer-rights-in-nigeria-under-the-fccpa-2018/)
- FCCPC enforcement examples: shut five Kano textile warehouses (Nov 2025) over deceptive sales; DEON digital lending regulations 2025 ban unethical marketing; deceptive marketing among complaint categories Mar–Aug 2025 — [Nairametrics](https://nairametrics.com/2025/11/05/fccpc-shuts-down-five-textile-warehouses-in-kano-over-deceptive-sales-practices/); [FCCPC](https://fccpc.gov.ng/digital-lending-fccpc-tackles-abuses-issues-landmark-regulations/); [Vanguard](https://www.vanguardngr.com/2025/09/banking-fintech-top-consumer-complaints-in-nigeria-fccpc/amp/)

### Inferences
- Product design implication: compute scarcity numbers from live data (units actually received, count actually waitlisted), timestamp them, keep an audit log, and block free-text inflation by sellers — this makes claims substantiable under FCCPA s.123 / CMA / FTC standards.
- Hold windows ("held until 6pm") must actually release stock when they expire; otherwise it's a fake deadline.

### Gaps
- No FCCPC regulation or guidance specifically on "dark patterns" or online scarcity/countdown claims found.

## 4. Consent & platform rules: NDPA 2023/GAID, WhatsApp Business Platform, Instagram Messaging API

### Takeaway
Nigeria (via GAID 2025, effective 19 Sept 2025) requires express consent for direct marketing; WhatsApp requires explicit opt-in before business-initiated template messages and caps marketing frequency; restock alerts to someone who asked are arguably "utility-like" but Meta categorises based on content, and promotional scarcity copy pushes them to marketing pricing. Instagram only allows replies within 24h (7 days via human-agent tag, humans only) — so IG cannot be a reliable outbound restock channel unless the customer re-messages.

### Cited Findings
**NDPA / GAID**
- NDPA s.26: consent must be freely given, specific, informed, unambiguous; subjects must be told of right to withdraw; withdrawal must be easy (s.35); right to object to direct marketing — [KPMG NDPA review](https://assets.kpmg.com/content/dam/kpmg/ng/pdf/nigeria-data-protection-act2023_kpmg-review.pdf); [DLA Piper](https://www.dlapiperdataprotection.com/index.html?t=law&c=NG)
- GAID 2025 (issued March 2025, effective 19 Sept 2025) requires consent for any direct marketing; express consent where controller communicates directly with customers to promote products — [Mondaq GAID Series II](https://www.mondaq.com/nigeria/privacy-protection/1700306/gaid-2025-unpacked-series-ii-data-protection-officers-mandatory-consents-and-emerging-technologies); [NDPC GAID PDF](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf); [KPMG GAID review](https://assets.kpmg.com/content/dam/kpmg/ng/pdf/2025/05/Review%20of%20the%20NDPA%20General%20Application%20and%20Implementation%20Directive%20GAID%202025.pdf)

**WhatsApp Business Platform**
- Per-message pricing replaced conversation pricing on 1 July 2025; service (user-initiated, in-window free-form) messages free and unlimited since 1 Nov 2024; utility templates inside the 24h customer service window free from July 2025 — [Gupshup](https://support.gupshup.io/hc/en-us/articles/38821010267673-WhatsApp-Pricing-Updates-2024-2025); [Wati](https://support.wati.io/en/articles/11561662-message-based-pricing-all-you-need-to-know); [Meta pricing docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- **Change from 1 Oct 2026**: Meta announced (July 2026) that charges for certain service and utility messages resume; reported Nigeria rates ≈ $0.0101 (~₦14) per chargeable utility/service message and ≈ $0.062 (~₦84) per marketing message; businesses without a payment method by 30 Sept 2026 stop getting service messages delivered — [Sahara Reporters](https://saharareporters.com/2026/08/28/whatsapp-set-start-charging-businesses-customer-messages-october-1); [Legit.ng](https://www.legit.ng/business-economy/technology/1727481-whatsapp-charge-nigerian-businesses-message-october-1-what-companies-know/); [WithinNigeria](https://www.withinnigeria.com/2026/08/29/whatsapp-business-charges-what-nigerian-companies-need-to-know-before-october-1/); [BusinessDay](https://businessday.ng/technology/article/whatsapps-n14-fee-could-cost-nigerian-msmes-n14m-per-million-messages/)
- **Conflict**: Aggregators cite Meta's 2026 rate card for Nigeria as marketing $0.0516, utility $0.0067, authentication $0.0145 — [Ominiflow](https://ominiflow.com/whatsapp-api-pricing/nigeria); [Cylique](https://cylique.com/whatsapp-business-api-nigeria-full-pricing-breakdown/) — versus press figures of $0.062 marketing / $0.0101 utility for Oct 2026. Likely a rate-card update between versions; could not verify on Meta's page (blocked). Report writer should present both with dates.
- Blueticks reports utility templates inside the CSW were free July 2025–Sept 2026 and billable again from 1 Oct 2026 — [Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- Opt-in: explicit consent required before business-initiated messages; must honour opt-outs; opt-in can cover multiple categories or be per-category — [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/); [helo.ai](https://helo.ai/resources/blog/whatsapp-opt-in-complete-guide)
- Frequency capping: Meta limits how many marketing templates a user receives from businesses; aggregators state ~2 marketing templates per user per 24h across all businesses (not confirmed on a Meta page; Meta does not publish the exact number as far as found); utility templates not capped — [AiSensy](https://m.aisensy.com/blog/meta-frequency-capping-for-whatsapp-marketing-messages/); [Chatarmin](https://chatarmin.com/en/blog/whats-app-messaging-limits)

**Instagram Messaging API**
- Businesses can reply only within 24h of the user's last message; HUMAN_AGENT tag extends to 7 days, only for genuine human replies (App Review required; automation prohibited); nothing permitted beyond 7 days — [Meta Messenger/IG policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy); [KeyAPI guide](https://www.keyapi.ai/blog/instagram-messaging-api-policy/)
- HUMAN_AGENT is the only tag usable on Instagram; other tags (e.g., ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE) reported deprecated as of 27 April 2026 — [Conferbot](https://www.conferbot.com/limits/instagram) (secondary)

### Inferences
- Opt-in design: when a seller tags a DM customer for a product, the tool should send an in-window confirmation ("Want us to WhatsApp you when size 42 lands? Reply YES") — this captures express NDPA/GAID consent and WhatsApp opt-in with a record, and in-window replies are cheap.
- Restock alert copy that is purely factual ("the item you asked for is back, reply to buy") may qualify as utility; adding promotional/scarcity framing risks marketing categorisation (~$0.05–0.06/msg Nigeria) and frequency caps. Meta's categorisation rules were not directly verified.
- For Instagram-originated leads, capture a WhatsApp number or SMS consent during the 24h window, since IG cannot send a restock alert weeks later.
- SMS in Nigeria (NCC DND rules) not researched here.

### Gaps
- Could not access Meta's official rate card/pricing page to resolve the Nigeria rate conflict or confirm Oct 2026 utility/service charge details.
- Meta's exact template-categorisation treatment of back-in-stock notifications not verified.
- NCC (Nigerian Communications Commission) DND/SMS marketing rules not covered.
