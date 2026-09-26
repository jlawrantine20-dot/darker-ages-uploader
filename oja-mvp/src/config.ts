export interface Rates {
  /** Free-form reply inside the 24h window. */
  service: number;
  utility: number;
  marketing: number;
}

export interface Config {
  databaseUrl?: string;
  dataDir?: string;
  port: number;
  publicUrl: string;
  adminToken: string;
  dryRun: boolean;
  timezone: string;
  /** Estimated Meta charge per message, in kobo. Reported Nigeria rates from Oct 2026; re-check Meta's rate card. */
  rateKobo: Rates;
  whatsapp: {
    token: string;
    appSecret: string;
    verifyToken: string;
    apiVersion: string;
    templateLanguage: string;
    templates: { hold: string; race: string; soldOut: string; paid: string; refund: string };
  };
  paystack: { secretKey: string; callbackUrl: string; emailDomain: string };
}

const int = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dryRun = env.DRY_RUN !== 'false';
  const cfg: Config = {
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATA_DIR || undefined,
    port: int(env.PORT, 8787),
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:8787',
    adminToken: env.ADMIN_TOKEN ?? '',
    dryRun,
    timezone: env.TIMEZONE ?? 'Africa/Lagos',
    rateKobo: {
      service: int(env.RATE_SERVICE_KOBO, 0),
      utility: int(env.RATE_UTILITY_KOBO, 1400),
      marketing: int(env.RATE_MARKETING_KOBO, 8400),
    },
    whatsapp: {
      token: env.WA_TOKEN ?? '',
      appSecret: env.WA_APP_SECRET ?? '',
      verifyToken: env.WA_VERIFY_TOKEN ?? '',
      apiVersion: env.WA_API_VERSION ?? 'v21.0',
      templateLanguage: env.WA_TEMPLATE_LANG ?? 'en',
      templates: {
        hold: env.WA_TEMPLATE_HOLD ?? 'restock_hold_v1',
        race: env.WA_TEMPLATE_RACE ?? 'restock_race_v1',
        soldOut: env.WA_TEMPLATE_SOLD_OUT ?? 'restock_sold_out_v1',
        paid: env.WA_TEMPLATE_PAID ?? 'payment_received_v1',
        refund: env.WA_TEMPLATE_REFUND ?? 'payment_refund_v1',
      },
    },
    paystack: {
      secretKey: env.PAYSTACK_SECRET_KEY ?? '',
      callbackUrl: env.PAYSTACK_CALLBACK_URL ?? '',
      // Paystack needs an email per payment; buyers get <wa_id>@this-domain. Use a domain you own.
      emailDomain: env.PAYSTACK_EMAIL_DOMAIN ?? 'buyers.example.com',
    },
  };
  if (!dryRun) {
    const missing = [
      ['WA_TOKEN', cfg.whatsapp.token],
      ['WA_APP_SECRET', cfg.whatsapp.appSecret],
      ['WA_VERIFY_TOKEN', cfg.whatsapp.verifyToken],
      ['PAYSTACK_SECRET_KEY', cfg.paystack.secretKey],
      ['ADMIN_TOKEN', cfg.adminToken],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`DRY_RUN=false needs these settings: ${missing.join(', ')}`);
  }
  return cfg;
}
