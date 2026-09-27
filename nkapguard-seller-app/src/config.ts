export interface Config {
  databaseUrl?: string;
  dataDir?: string;
  port: number;
  publicUrl: string;
  adminToken: string;
  /** Encrypts sellers' payment keys. Changing it makes stored keys unreadable. */
  appSecret: string;
  dryRun: boolean;
  /** Estimated USD per free-form reply inside the 24h window. 0 while Meta keeps these free. */
  serviceRateUsd: number;
  /** Buyers without an email get <waId>@this domain where a payment provider insists on one. */
  buyerEmailDomain: string;
  whatsapp: {
    token: string;
    appSecret: string;
    verifyToken: string;
    apiVersion: string;
    templates: { hold: string; race: string; soldOut: string; paid: string; refund: string };
  };
  /** NKAPGUARD's own WhatsApp number, which sends sign-in codes to sellers. */
  platform: { phoneNumberId: string; loginTemplate: string; loginTemplateLanguage: string };
  /** Where the seller app is hosted, when it is not on the API's own host. Customer pages are drawn there. */
  appUrl: string;
  /** Origins allowed to call the API from a browser. */
  allowedOrigins: string[];
  /** Test mode only: treat requests with no credentials as the operator. Off for public deployments. */
  openTestMode: boolean;
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
    appSecret: env.APP_SECRET ?? (dryRun ? 'dry-run-only-secret' : ''),
    dryRun,
    serviceRateUsd: Number(env.RATE_SERVICE_USD ?? 0),
    buyerEmailDomain: env.BUYER_EMAIL_DOMAIN ?? 'buyers.example.com',
    whatsapp: {
      token: env.WA_TOKEN ?? '',
      appSecret: env.WA_APP_SECRET ?? '',
      verifyToken: env.WA_VERIFY_TOKEN ?? '',
      apiVersion: env.WA_API_VERSION ?? 'v21.0',
      templates: {
        hold: env.WA_TEMPLATE_HOLD ?? 'restock_hold_v1',
        race: env.WA_TEMPLATE_RACE ?? 'restock_race_v1',
        soldOut: env.WA_TEMPLATE_SOLD_OUT ?? 'restock_sold_out_v1',
        paid: env.WA_TEMPLATE_PAID ?? 'payment_received_v1',
        refund: env.WA_TEMPLATE_REFUND ?? 'payment_refund_v1',
      },
    },
    appUrl: env.APP_URL ?? '',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').split(',').map((o) => o.trim()).filter(Boolean),
    openTestMode: dryRun && env.OPEN_TEST_MODE !== 'false',
    platform: {
      phoneNumberId: env.PLATFORM_WA_PHONE_ID ?? '',
      loginTemplate: env.WA_TEMPLATE_LOGIN ?? 'login_code_v1',
      loginTemplateLanguage: env.WA_TEMPLATE_LOGIN_LANG ?? 'en',
    },
  };
  if (!dryRun) {
    const missing = [
      ['WA_TOKEN', cfg.whatsapp.token],
      ['WA_APP_SECRET', cfg.whatsapp.appSecret],
      ['WA_VERIFY_TOKEN', cfg.whatsapp.verifyToken],
      ['ADMIN_TOKEN', cfg.adminToken],
      ['APP_SECRET', cfg.appSecret],
      ['PLATFORM_WA_PHONE_ID', cfg.platform.phoneNumberId],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`DRY_RUN=false needs these settings: ${missing.join(', ')}`);
  }
  return cfg;
}
