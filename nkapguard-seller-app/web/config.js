// Where the NKAPGUARD API is. The NKAPGUARD Node server serves this app under /app/ on its own
// host, so the API is the same host there. Anywhere else, use the hosted API on Supabase.
window.NKG_API = location.pathname.startsWith('/app/') || location.hostname === 'localhost'
  ? ''
  : 'https://psalpplvvygliobywsda.supabase.co/functions/v1/seller-app';
