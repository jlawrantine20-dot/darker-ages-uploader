// NKAPGUARD Seller App: Supabase edge function entry. Deployed as the `seller-app` function.
// deps.ts loads the libraries first (modules run in import order), then the tested app
// bundle, pinned to one git commit, is fetched and packaged by Supabase at deploy time.
// The app does its own authentication (WhatsApp sign-in codes, webhook signatures), so
// Supabase JWT verification is off for this function.
import './deps.ts';
import 'https://cdn.jsdelivr.net/gh/jlawrantine20-dot/darker-ages-uploader@68bb3d9e296e4fd29c8f7cfb1d1085f580df1743/nkapguard-seller-app/edge/dist/remote.js';
