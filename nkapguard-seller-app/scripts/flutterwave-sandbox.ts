/**
 * Check NKAPGUARD's Flutterwave integration against Flutterwave's real test environment.
 *
 *   FLW_SECRET_KEY=FLWSECK_TEST-... npm run check:flutterwave -- --amount 100 --currency XAF --phone 237677123456
 *
 * It creates a checkout exactly the way NKAPGUARD does, prints the link, then waits while you pay
 * with Flutterwave's test details (their docs list test cards and test mobile money numbers),
 * and finally confirms the payment through the same verify endpoint NKAPGUARD uses for webhooks.
 * Use test keys only: nothing here should touch real money.
 */
import { flutterwave, flutterwaveByReference } from '../src/payments/providers.js';
import { toMinor } from '../src/domain/money.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const secretKey = process.env.FLW_SECRET_KEY ?? '';
if (!secretKey.startsWith('FLWSECK_TEST')) {
  console.error('Set FLW_SECRET_KEY to a Flutterwave TEST secret key (it starts with FLWSECK_TEST).');
  process.exit(1);
}
const currency = arg('currency', 'XAF').toUpperCase();
const amount = Number(arg('amount', '100'));
const phone = arg('phone', '237677123456').replace(/\D/g, '');
const reference = `nkg_sandbox.${Date.now().toString(36)}`;

const provider = flutterwave({ secretKey, publicUrl: 'https://example.com', emailDomain: 'buyers.example.com' });
console.log(`Creating a ${amount} ${currency} checkout (reference ${reference})…`);
const { url } = await provider.createLink({
  reference,
  amountMinor: toMinor(amount, currency),
  currency,
  description: 'NKAPGUARD sandbox check',
  waId: phone,
  name: 'Sandbox Buyer',
  metadata: { purpose: 'sandbox-check' },
});
console.log(`\nOpen this link and pay with Flutterwave test details:\n\n  ${url}\n\nWaiting for the payment (up to 10 minutes)…`);

const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const r = await flutterwaveByReference(secretKey, reference);
  if (r.status === 'success' && r.data) {
    console.log(`Flutterwave reports: ${r.data.status}, ${r.data.amount} ${r.data.currency}`);
    if (r.data.status === 'successful') {
      const confirmed = await provider.confirm!({ reference, amountMinor: 0, providerTxId: String(r.data.id) });
      if (confirmed && confirmed.amountMinor >= toMinor(amount, currency) && confirmed.currency === currency) {
        console.log('\nPASS: checkout created, payment made, and confirmed through the verify endpoint.');
        process.exit(0);
      }
      console.error('\nFAIL: Flutterwave says successful but the verify check did not match.', confirmed);
      process.exit(1);
    }
    if (r.data.status === 'failed') {
      console.error('\nThe payment failed. Try again with Flutterwave’s test details.');
      process.exit(1);
    }
  }
}
console.error('\nNo payment within 10 minutes.');
process.exit(1);
