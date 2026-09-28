// NKAPGUARD Seller App: Supabase edge function entry. Deployed as the `seller-app` function.
// deps.ts loads the libraries first (modules run in import order), then the tested app
// bundle, pinned to one git commit, is fetched and packaged by Supabase at deploy time.
// The app does its own authentication (WhatsApp sign-in codes, webhook signatures), so
// Supabase JWT verification is off for this function.
import './deps.ts';
import 'https://cdn.jsdelivr.net/gh/jlawrantine20-dot/darker-ages-uploader@00bcf50a7344748a3409ad6d302172b77b5a2112/nkapguard-seller-app/edge/dist/remote.js';
