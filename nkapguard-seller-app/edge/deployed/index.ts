// NKAPGUARD Seller App: Supabase edge function entry. Deployed as the `seller-app` function.
// deps.ts loads the libraries first (modules run in import order), then the tested app
// bundle, pinned to one git commit, is fetched and packaged by Supabase at deploy time.
// The app does its own authentication (WhatsApp sign-in codes, webhook signatures), so
// Supabase JWT verification is off for this function.
import './deps.ts';
import 'https://cdn.jsdelivr.net/gh/jlawrantine20-dot/darker-ages-uploader@2fc66bef2d779e0f33c45c8e7e4af10525993b7e/nkapguard-seller-app/edge/dist/remote.js';
