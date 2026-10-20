// NKAPGUARD Seller App. Plain JavaScript modules, no build step; talks to the /api routes.
import { lang, setLang, t } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
/** Where the NKAPGUARD API lives. Empty when the app and API share a host; set in config.js otherwise. */
const API = (window.NKG_API ?? '').replace(/\/$/, '');
const main = $('#main');
const top = $('#top');
const nav = $('#nav');
let TZ = 'UTC';

// ---------- small helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const exponent = (cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
const toMajor = (minor) => (minor ?? 0) / 10 ** exponent(S.seller?.currency ?? 'USD');
/** The language customers are written to, as the seller reads it in the app's language. */
const langName = (l) => t(`lang.${l}`);
/** Locale for numbers and dates: the app's language, with the shop's country for number style. */
const locale = () => `${lang()}-${S.seller?.country ?? (lang() === 'fr' ? 'FR' : 'GB')}`;
/** The shop's own language, which is the language its product names and variants are written in. */
const shopLang = () => ((S.seller?.language ?? 'en').startsWith('fr') ? 'fr' : 'en');
function fmtMoney(major, cur, digits) {
  const opts = { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(major) ? 0 : undefined, ...(digits !== undefined ? { maximumFractionDigits: digits, minimumFractionDigits: 0 } : {}) };
  try { return new Intl.NumberFormat(locale(), opts).format(major); }
  catch { return new Intl.NumberFormat(lang(), opts).format(major); }
}
/** A price in the shop's currency, written the way the app's language writes it: "15 000 FCFA", "FCFA 15,000", "₦18,500". */
const money = (minor) => fmtMoney(toMajor(minor), S.seller?.currency ?? 'USD');
/** Meta bills fees in US dollars; sellers see them in their own currency, converted at the day's rate. */
const usd = (micros) => { const v = (micros ?? 0) / 1e6; const d = v !== 0 && v < 0.01 ? 4 : 2; return fmtMoney(Number(v.toFixed(d)), 'USD', d); };
function fee(micros) {
  const cur = S.seller?.currency ?? 'USD';
  const rate = S.markets?.fx?.perUsd?.[cur];
  if (!rate || cur === 'USD') return usd(micros);
  if (!micros) return fmtMoney(0, cur);
  const local = ((micros ?? 0) / 1e6) * rate;
  // Small fees keep their decimals; bigger ones round to whole units.
  return `≈ ${fmtMoney(local, cur, local >= 10 ? 0 : Math.min(2, exponent(cur)))}`;
}
const initials = (name) => esc((name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
const phone = (wa) => (wa ? '+' + esc(wa) : '');
const chName = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Messenger', tiktok: 'TikTok' };
/** How a customer is shown: WhatsApp by name or number; Instagram and Messenger by name or @handle. */
const who = (c) => c.channel === 'whatsapp' || !c.channel ? c.name ?? phone(c.wa_id) : c.name ?? (c.username ? '@' + c.username : t('chats.customerOf', { app: chName[c.channel] }));
const whoSub = (c) => c.channel === 'whatsapp' || !c.channel ? phone(c.wa_id) : c.username ? '@' + c.username : chName[c.channel];
const chip = (ch) => `<span class="ch ${esc(ch)}"><i></i>${chName[ch] ?? esc(ch)}</span>`;
/**
 * A product as the seller reads it. A bilingual variant ("Marron / Brown") follows the app's
 * language; otherwise names stay as the seller wrote them, in the shop's word order:
 * "Claw Clip marron" in French, "Brown Claw Clip" in English.
 */
function label(p) {
  const parts = (p.variant ?? '').split('/').map((x) => x.trim());
  const both = parts.length > 1 && parts[1];
  const l = both ? lang() : shopLang();
  const v = both ? (l === 'fr' ? parts[0] : parts[1]) : parts[0];
  return esc(l === 'fr' ? [p.name, (v ?? '').toLowerCase()].filter(Boolean).join(' ') : [v, p.name].filter(Boolean).join(' '));
}
const variantText = (v) => { const [a, b] = (v ?? '').split('/').map((x) => x.trim()); return b ? (lang() === 'fr' ? a : b) : a; };
const dateLocale = () => (lang() === 'fr' ? 'fr-FR' : 'en-GB');
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString('en-GB', { timeZone: TZ }) === new Date().toLocaleDateString('en-GB', { timeZone: TZ });
  if (sameDay) return clock(iso);
  if (Date.now() - d.getTime() < 6 * 864e5) return d.toLocaleDateString(dateLocale(), { weekday: 'short', timeZone: TZ });
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', timeZone: TZ });
}
/** "14:05" in French, "2:05 PM" in English. */
const clock = (iso) => new Date(iso).toLocaleTimeString(lang() === 'fr' ? 'fr-FR' : 'en-GB', { hour: 'numeric', minute: '2-digit', hour12: lang() !== 'fr', timeZone: TZ }).toUpperCase();
/** "2 h 30" in French, "2h 30m" in English. */
const mins = (m) => {
  m = Math.max(0, m);
  if (lang() === 'fr') return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`;
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
};
/** "40 %" in French, "40%" in English. */
const pct = (n) => new Intl.NumberFormat(dateLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(n / 100);
/** A product's photo link, or null. The version in the link changes with the photo. */
const photoOf = (p) => (p?.photo_version ? `${API}/photos/${p.id}?v=${p.photo_version}` : null);
const thumb = (p) => (photoOf(p) ? `<img class="prodicon" src="${esc(photoOf(p))}" alt="" loading="lazy">` : avatar(p.name, 'prodicon'));
/**
 * Shrink a photo on the phone before upload: at most 1024 px on the long side, as JPEG. A 4 MB
 * camera photo becomes about 100 KB, which uploads quickly on a weak connection.
 */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function uploadPhoto(productId, file) {
  let dataUrl;
  try { dataUrl = await shrink(file); } catch { throw new Error(t('ph.unreadable')); }
  return api(`/api/products/${productId}/photo`, { method: 'POST', body: { dataUrl } });
}
/** Country names in the app's language: "Cameroun" or "Cameroon". */
function countryName(code, fallback) {
  try { return new Intl.DisplayNames([lang()], { type: 'region' }).of(code) ?? fallback ?? code; } catch { return fallback ?? code; }
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked: fall back to memory */ }
  return undefined;
}
const mem = {};
const get = (k) => store(k) ?? mem[k] ?? null;
const set = (k, v) => { mem[k] = v; store(k, v); };

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.hidden = true), 2400);
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Lang': lang() };
  const token = get('nkg.token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? t('requestFailed', { status: res.status }));
  return data;
}

// ---------- app state ----------
const S = { dryRun: false, seller: null, markets: null, chatFilter: 'all', restockForm: null, confirm: false };
const setSeller = (s) => { S.seller = s; TZ = s?.timezone ?? 'UTC'; };
async function markets() { return (S.markets ??= await api('/markets')); }
const sellerId = () => get('nkg.seller');

// ---------- chrome ----------
// Line icons, 24px grid, drawn with the current text colour.
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  chats: svg('<path d="M7.5 18.5 4 20.5V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3z"/><path d="M8.5 9.5h7M8.5 13h4.5"/>'),
  orders: svg('<path d="M5.5 8h13l-1.1 11.1a2 2 0 0 1-2 1.9H8.6a2 2 0 0 1-2-1.9z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>'),
  stock: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  insights: svg('<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>'),
  settings: svg('<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  bag: svg('<path d="M5.5 8h13l-1.1 11.1a2 2 0 0 1-2 1.9H8.6a2 2 0 0 1-2-1.9z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/><path d="m9.5 15 1.8 1.8 3.4-3.6"/>', ' stroke-width="2"'),
  back: svg('<path d="m15 18-6-6 6-6"/>', ' stroke-width="2.2"'),
  chev: svg('<path d="m9 18 6-6-6-6"/>'),
  send: svg('<path d="M5 12h13M13 6l6 6-6 6"/>', ' stroke-width="2.2"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', ' stroke-width="2.2"'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="2.2"'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', ' stroke-width="2.2"'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.4"/>', ' stroke-width="2"'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  alert: svg('<path d="M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17v.3"/>'),
  phone: svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  download: svg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  truck: svg('<path d="M3 6.5h10.5v10H3zM13.5 10h4l3 3.2v3.3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  pin: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
  user: svg('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>'),
  crown: svg('<path d="m4 8 4 3.5L12 5l4 6.5L20 8l-1.5 10h-13z"/>'),
  team: svg('<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3 3.2-4.6 6-4.6s5.1 1.6 6 4.6"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.8c1.7.6 2.9 2 3.5 4.2"/>'),
  card: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>'),
  store: svg('<path d="M4 9.5 5.3 4.5h13.4L20 9.5"/><path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8.5h13V12M10 20.5v-5h4v5"/>'),
  link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>'),
  qr: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5"/>'),
  camera: svg('<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  money: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v.01M18 14.5v.01"/>', ' stroke-width="1.9"'),
  trend: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  repeat: svg('<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>'),
  message: svg('<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12Z"/>'),
  coins: svg('<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M3.5 11v4c0 1.4 2.5 2.5 5.5 2.5 1 0 2-.1 2.8-.4"/><ellipse cx="15.5" cy="15" rx="5" ry="2.3"/><path d="M10.5 15v3.5c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3V15"/>'),
  refund: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  shield: svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>'),
  flask: svg('<path d="M9.5 3h5M10 3v6L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.2 14.5h9.6"/>'),
  box: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z"/>'),
  tag: svg('<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>'),
  logout: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16.5 5.5 12 10 7.5M5.5 12H15"/>'),
  swap: svg('<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>'),
};
// Brand glyphs for the sales channels (simplified, single colour).
const BRAND = {
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.8L2.2 21.8l4.9-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.2.2-.6.2-1 .1-1.2l-.5-.2Z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5c-5.4 0-9.5 4-9.5 9.1 0 2.9 1.4 5.4 3.6 7.1V22l3.3-1.8c.8.2 1.7.3 2.6.3 5.4 0 9.5-4 9.5-9.1S17.4 2.5 12 2.5Zm1 12.1-2.4-2.6-4.7 2.6 5.2-5.5 2.5 2.6 4.6-2.6z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 3c.4 2 1.7 3.4 3.9 3.6v3.1a7.4 7.4 0 0 1-3.9-1.2v6.4a6 6 0 1 1-6-6v3.2a2.8 2.8 0 1 0 2.8 2.8V3z"/></svg>',
};
const brandIco = (ch) => `<span class="brandico ${esc(ch)}">${BRAND[ch] ?? ''}</span>`;
/** A soft colour per name, so customers are easy to tell apart at a glance. */
const TINTS = [['#E2F2EC', '#0A5A48'], ['#FBF1DB', '#8A5A0B'], ['#E6EEFD', '#1F4FB8'], ['#FCE7EF', '#A61E57'], ['#EDE8FC', '#5B3CC4'], ['#E0F3F7', '#0B6478'], ['#FDEBDF', '#A2470E'], ['#EAF1E2', '#3F6A12']];
const DARK_TINTS = [['#11332A', '#7BE0C2'], ['#33270F', '#F1C46B'], ['#16264A', '#8DB3FA'], ['#3A1526', '#F58FB8'], ['#251C47', '#B9A5FA'], ['#0E2F37', '#7FD3E6'], ['#3A2112', '#F5A773'], ['#1D2C10', '#B3DA7E']];
function tint(name) {
  let h = 0;
  for (const ch of String(name ?? '?')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const [bg, ink] = (dark ? DARK_TINTS : TINTS)[h % TINTS.length];
  return `--av-bg:${bg};--av-ink:${ink}`;
}
const avatar = (name, cls = 'av') => `<span class="${cls}" style="${tint(name)}">${initials(name)}</span>`;
/** A notice with an icon: kind is '' (amber), 'ok', 'bad' or 'info'. */
const banner = (html, kind = '') => `<div class="banner ${kind}">${ICON[kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert']}<div>${html}</div></div>`;
/** An empty list: an icon, a short title and one line of help. */
const empty = (icon, title, text = '') => `<div class="empty"><span class="ico muted">${ICON[icon]}</span>${title ? `<b>${title}</b>` : ''}${text ? `<span>${text}</span>` : ''}</div>`;
const sect = (text, count) => `<h2 class="sect"><span>${text}</span>${count !== undefined ? `<span class="count">${count}</span>` : ''}</h2>`;

function header(title, { back, sub, plain } = {}) {
  // The language switch is on every screen, sign-in included.
  const toggle = `<div class="langtog" role="group" aria-label="Langue / Language">${['fr', 'en'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${lang() === l}">${l.toUpperCase()}</button>`).join('')}</div>`;
  if (plain) { top.classList.remove('detail'); top.innerHTML = `<h1></h1>${toggle}`; return; }
  top.classList.toggle('detail', !!back);
  top.innerHTML = `${back ? `<a class="back" href="${back}" aria-label="${t('back')}">${ICON.back}</a>` : `<span class="mark">${ICON.bag}</span>`}<h1><span class="t">${title}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</h1>${toggle}`;
}
function setNav(active, unread = 0) {
  $('.shell').classList.toggle('bare', !active);
  if (!active) { nav.hidden = true; return; }
  nav.hidden = false;
  const item = (k, href, text, extra = '') => `<a href="${href}" class="${active === k ? 'on' : ''}"${active === k ? ' aria-current="page"' : ''}>${ICON[k]}<span class="l">${text}</span>${extra}</a>`;
  nav.innerHTML =
    `<div class="nav-brand"><span class="mark">${ICON.bag}</span><span>NKAPGUARD<small>Seller App</small></span></div>` +
    item('chats', '#/chats', t('nav.chats'), unread ? `<span class="dot">${unread}</span>` : '') +
    item('orders', '#/orders', t('nav.orders')) +
    item('stock', '#/products', t('nav.stock')) + item('insights', '#/insights', t('nav.insights')) + item('settings', '#/settings', t('nav.settings')) +
    (S.seller ? `<div class="nav-foot"><b>${esc(S.seller.name)}</b>${esc(countryName(S.seller.country))} · ${esc(S.seller.currency)}</div>` : '');
}
window.addEventListener('scroll', () => top.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

// ---------- views ----------
const views = {};

/** Sign in with a WhatsApp number: step 1 asks for the number, step 2 for the code. */
views.login = async (_p, msg) => {
  setNav(null);
  const mk = await markets();
  const guess = (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[1] ?? '').toUpperCase();
  const country = S.login?.country ?? (mk.countries.some((c) => c.code === guess) ? guess : 'CM');
  header('', { plain: true });
  const hero = `<div class="auth-hero${S.login?.sent ? ' compact' : ''}">
      <div class="auth-brand"><span class="mark">${ICON.bag}</span>NKAPGUARD</div>
      <h2>${t('login.hero')}</h2>
      <p>${t('login.heroText')}</p>
      <ul class="auth-points">
        <li><span>${ICON.message}</span>${t('login.point1')}</li>
        <li><span>${ICON.card}</span>${t('login.point2')}</li>
        <li><span>${ICON.bell}</span>${t('login.point3')}</li>
      </ul></div>`;
  const legal = `<p class="legal">${t('login.legal')}</p>`;
  if (S.login?.sent) {
    main.innerHTML = `<section class="auth">${hero}<div class="auth-card">
      <h3>${t('login.codeTitle')}</h3>
      <p class="intro">${t('login.sent', { phone: esc(S.login.phone) })}</p>
      ${S.login.devCode ? `<div class="testcode"><span>${t('login.testCodeShort')}</span><b>${esc(S.login.devCode)}</b></div>` : ''}
      <form class="form" data-form="login-code">
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
        <label>${t('login.code')}<input id="l-code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required value="${esc(S.login.devCode ?? '')}"></label>
        <button class="btn primary block">${t('login.signIn')}</button>
        <button type="button" class="btn ghost block" data-act="login-back">${t('login.otherNumber')}</button></form>
      </div>${legal}</section>`;
    return;
  }
  main.innerHTML = `<section class="auth">${hero}<div class="auth-card">
    <h3>${t('login.title')}</h3>
    <p class="intro">${t('login.intro')}</p>
    <form class="form" data-form="login-phone">
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <label>${t('login.country')}<select id="l-country">${countryOptions(mk, country)}</select>
        <span class="hint">${t('login.countryHint')}</span></label>
      <label>${t('login.phone')}<input id="l-phone" type="tel" autocomplete="tel" required value="${esc(S.login?.phone ?? '')}" placeholder="6 77 12 34 56"></label>
      <button class="btn primary block">${t('login.send')} ${ICON.send}</button></form>
    <div class="trust"><span>${ICON.lock}${t('login.trust1')}</span><span>${ICON.shield}${t('login.trust2')}</span></div>
    </div>${legal}</section>`;
};

views.setup = async () => {
  header(t('setup.sub'), { sub: 'NKAPGUARD Seller App' });
  setNav(null);
  const sellers = await api('/api/sellers');
  const [mk, me] = await Promise.all([markets(), api('/api/me')]);
  // Default to the country of the seller's own WhatsApp number, then the browser's.
  const guess = me.user?.country ?? (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[1] ?? '').toUpperCase();
  const def = mk.countries.some((c) => c.code === guess) ? guess : 'CM';
  main.innerHTML = `
    ${sellers.length ? `${sect(t('setup.choose'))}<div class="group shops">${sellers.map((s) => `<a class="row" href="#/chats" data-pick="${esc(s.id)}">
      ${avatar(s.name)}<span style="min-width:0"><span class="name"><span class="n">${esc(s.name)}</span></span><span class="last">${esc(countryName(s.country))} · ${esc(s.currency)} · ${langName(s.language)}</span></span>${ICON.chev.replace('<svg', '<svg class="chev"')}</a>`).join('')}</div>` : ''}
    ${S.dryRun && !sellers.length ? `<div class="card accent"><div class="head"><span class="ico">${ICON.flask}</span><h2>${t('demo.title')}</h2></div><p>${t('demo.text')}</p><button class="btn primary block" data-act="demo">${t('demo.btn')}</button></div>` : ''}
    ${sect(sellers.length ? t('setup.addAnother') : t('setup.add'))}
    <div class="group"><form class="form" data-form="seller">
      <label>${t('shop.name')}<input id="s-name" required placeholder="${t('shop.namePh')}"></label>
      ${shopFields(mk, { country: def })}
      <label>${t('shop.phoneId')}<input id="s-phone" required placeholder="${t('shop.phoneIdPh')}" value="${S.dryRun ? 'demo-' + Math.floor(Math.random() * 1e6) : ''}">
        <span class="hint">${t('shop.phoneIdHint')}</span></label>
      <p class="err" hidden></p>
      <button class="btn primary block">${t('shop.addBtn')}</button>
    </form></div>`;
};

/** Country, language, currency and time zone. Picking a country fills in the rest. */
/** Country choices, named and sorted in the app's language. */
function countryOptions(mk, selected) {
  return mk.countries
    .map((c) => ({ code: c.code, name: countryName(c.code, c.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang()))
    .map((c) => `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function shopFields(mk, cur) {
  const m = mk.countries.find((c) => c.code === cur.country);
  const other = m ? '' : `<option value="${esc(cur.country)}" selected>${esc(countryName(cur.country))}</option>`;
  return `<label>${t('shop.country')}<select id="s-country" data-country>${countryOptions(mk, cur.country)}${other}<option value="__other">${t('shop.otherCountry')}</option></select></label>
    <label id="s-other-wrap" hidden>${t('shop.countryCode')}<input id="s-other" maxlength="2" placeholder="${t('shop.countryCodePh')}"></label>
    <label>${t('shop.talkIn')}<select id="s-lang">${mk.languages.map((l) => `<option value="${l}" ${l === (cur.language ?? m?.language) ? 'selected' : ''}>${langName(l)}</option>`).join('')}</select>
      <span class="hint">${t('shop.talkInHint')}</span></label>
    <label>${t('shop.currency')}<input id="s-currency" maxlength="3" value="${esc(cur.currency ?? m?.currency ?? '')}" required><span class="hint">${t('shop.currencyHint')}</span></label>
    <label>${t('shop.tz')}<input id="s-tz" value="${esc(cur.timezone ?? m?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><span class="hint">${t('shop.tzHint')}</span></label>`;
}
function shopValues(form) {
  const v = (id) => $(`#${id}`, form).value.trim();
  const country = v('s-country') === '__other' ? v('s-other').toUpperCase() : v('s-country');
  return { country, language: v('s-lang'), currency: v('s-currency').toUpperCase(), timezone: v('s-tz') };
}
/** Settings: changing the currency asks for the exchange rate so prices keep their value. */
function syncRate(form) {
  const wrap = $('#s-rate-wrap', form);
  if (!wrap) return;
  const from = wrap.dataset.from;
  const to = $('#s-currency', form).value.trim().toUpperCase();
  wrap.hidden = !/^[A-Z]{3}$/.test(to) || to === from;
  if (wrap.hidden) return;
  $('#s-rate-label', form).textContent = t('rate.label', { to, from });
  const ex = Number($('#s-rate', form).value) || null;
  $('#s-rate-hint', form).textContent = ex
    ? t('rate.example', { from, to, rate: ex.toLocaleString(lang()), before: priceIn(10, from), after: priceIn(10 * ex, to) })
    : t('rate.hint');
}
const priceIn = (major, cur) => { try { return new Intl.NumberFormat(lang(), { style: 'currency', currency: cur, maximumFractionDigits: exponent(cur) }).format(major); } catch { return `${major} ${cur}`; } };
document.addEventListener('input', (e) => { if (e.target.matches('#s-currency, #s-rate')) syncRate(e.target.closest('form')); });
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-country]')) return;
  const form = e.target.closest('form');
  const other = e.target.value === '__other';
  $('#s-other-wrap', form).hidden = !other;
  const m = (await markets()).countries.find((c) => c.code === e.target.value);
  if (m) { $('#s-currency', form).value = m.currency; $('#s-tz', form).value = m.timezone; $('#s-lang', form).value = m.language; }
  if (other) { $('#s-currency', form).value = ''; $('#s-other', form).focus(); }
  syncRate(form);
});

views.chats = async () => {
  const [chats, channels] = await Promise.all([api(`/api/chats?sellerId=${sellerId()}`), S.dryRun ? api(`/api/channels?sellerId=${sellerId()}`) : null]);
  const unread = chats.reduce((a, c) => a + (c.unread > 0 ? 1 : 0), 0);
  header(t('chats.title'), { sub: esc(S.seller?.name ?? '') });
  setNav('chats', unread);
  const list = S.chatFilter === 'unread' ? chats.filter((c) => c.unread > 0) : S.chatFilter === 'waiting' ? chats.filter((c) => c.waiting_for.length) : chats;
  const f = (k, text, n) => `<button class="chip ${S.chatFilter === k ? 'on' : ''}" data-filter="${k}">${text}${n ? `<span class="c">${n}</span>` : ''}</button>`;
  const waiting = chats.filter((c) => c.waiting_for.length).length;
  main.innerHTML = `
    ${S.dryRun ? testCustomerForm(channels?.accounts.filter((a) => a.enabled)) : ''}
    <div class="chips">${f('all', t('chats.all'))}${f('unread', t('chats.unread'), unread)}${f('waiting', t('chats.waiting'), waiting)}</div>
    ${list.length ? `<div class="group">${list.map((c) => {
      const tags = c.waiting_for.map((w) => `<span class="tag">${ICON.clock}${t('chats.waitingFor', { item: label(w) })}</span>`);
      if (c.awaiting_consent) tags.push(`<span class="tag hold">${t('chats.askedAlert')}</span>`);
      if (c.order_status === 'held') tags.push(`<span class="tag hold">${t('chats.orderHeld')}</span>`);
      if (c.order_status === 'paid') tags.push(`<span class="tag">${ICON.check}${t('chats.orderPaid')}</span>`);
      return `<a class="row${c.unread ? ' unread' : ''}" href="#/chat/${esc(c.id)}">
        ${avatar(c.name ?? c.wa_id)}
        <span style="min-width:0"><span class="name"><span class="n">${esc(who(c))}</span>${chip(c.channel)}</span>
          <span class="last">${c.last_direction === 'out' ? t('chats.youPrefix') : ''}${esc(c.last_body ?? '')}</span>
          ${tags.length ? `<span class="tagline">${tags.join('')}</span>` : ''}</span>
        <span class="meta"><span>${when(c.last_at)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</span></a>`;
    }).join('')}</div>` : `<div class="group">${chats.length ? empty('check', t('chats.nothing')) : empty('chats', t('chats.emptyTitle'), t('chats.empty'))}</div>`}`;
};

function testCustomerForm(accounts = []) {
  const opts = [['whatsapp', 'WhatsApp'], ...accounts.map((a) => [a.channel, chName[a.channel]]), ...accounts.map((a) => [`${a.channel}:comment`, t('test.comment', { app: chName[a.channel] })])];
  return `<details class="test"><summary>${ICON.flask}${t('test.summary')}</summary>
    <form class="form" data-form="as-customer">
      ${accounts.length ? `<label>${t('test.channel')}<select id="tc-channel">${opts.map(([v, text]) => `<option value="${v}">${esc(text)}</option>`).join('')}</select></label>` : ''}
      <label>${t('test.from')}<input id="tc-from" value="${esc(samplePhone())}" required><span class="hint">${t('test.fromHint')}</span></label>
      <label>${t('test.name')}<input id="tc-name" value="${lang() === 'fr' ? 'Nadège Mballa' : 'Amaka Obi'}"></label>
      <label>${t('test.message')}<input id="tc-text" value="${esc(t('test.sampleText'))}" required></label>
      <button class="btn dark block">${t('test.send')}</button>
    </form></details>`;
}
/** An example local number for the shop's country, for the test-mode customer form. */
let phoneSeq = Math.floor(Math.random() * 40);
function samplePhone() {
  const r = String((phoneSeq++ % 90) + 10);
  return ({ CM: `6 77 12 34 ${r}`, NG: `0803 555 21${r}`, GH: `024 412 34${r}`, KE: `0712 3456${r}`, CI: `07 07 12 34 ${r}`, SN: `77 123 45 ${r}`,
    US: `(415) 555-01${r}`, GB: `07700 9001${r}`, FR: `06 12 34 56 ${r}` })[S.seller?.country] ?? `+237 6 77 12 34 ${r}`;
}

views.chat = async ([id]) => {
  const { contact: c, messages, waitingFor, consents } = await api(`/api/chats/${id}`);
  header(esc(who(c)), { back: '#/chats', sub: `${esc(whoSub(c))} · ${chName[c.channel] ?? ''}` });
  const app_ = chName[c.channel] ?? 'WhatsApp';
  setNav('chats');
  const hoursLeft = c.last_inbound_at ? Math.max(0, 24 - Math.floor((Date.now() - new Date(c.last_inbound_at)) / 36e5)) : 0;
  const live = consents.find((k) => !k.revoked_at);
  const stickToBottom = !main.dataset.view || main.dataset.view !== `chat:${id}` || window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
  const notice = c.channel !== 'whatsapp'
    ? c.window_open ? banner(t('chat.openOther', { h: hoursLeft, app: app_ }), 'ok') : banner(t('chat.closedOther', { app: app_ }))
    : c.window_open ? banner(t('chat.openWa', { h: hoursLeft }), 'ok') : banner(t('chat.closedWa'));
  // A small date divider whenever the day changes.
  let lastDay = '';
  const bubbles = messages.map((m) => {
    const day = new Date(m.created_at).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
    const divider = day !== lastDay ? `<span class="day">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</span>` : '';
    lastDay = day;
    return `${divider}<div class="b ${m.direction}">${m.image_url ? `<img class="bimg" src="${esc(m.image_url)}" alt="" loading="lazy">` : ''}${m.kind === 'template' ? `<span class="tpl">${t('chat.template')}${m.cost_usd_micros ? ` · ${fee(m.cost_usd_micros)}` : ''}</span>` : ''}${esc(m.body)}${m.error ? `<span class="fail">${ICON.alert.replace('<svg', '<svg width="14" height="14"')}${t('chat.notSent', { why: esc(m.error) })}</span>` : ''}<small>${clock(m.created_at)}</small></div>`;
  }).join('');
  main.classList.add('is-chat');
  main.innerHTML = `<div class="chatview">
    ${notice}
    ${waitingFor.length || live ? `<span class="tagline">
      ${waitingFor.map((w) => `<span class="tag">${ICON.clock}${t('chat.waitingTag', { item: label(w), pos: w.position })}</span>`).join('')}
      ${live ? `<span class="tag muted">${ICON.check}${t('chat.consentTag', { quote: esc(live.quote), when: when(live.granted_at) })}</span>` : consents.length ? `<span class="tag muted">${t('chat.optedOut')}</span>` : ''}
    </span>` : ''}
    <div class="msgs">${bubbles}</div>
    <div class="composer-stack">
    ${S.dryRun ? `<form class="composer test" data-form="as-this-customer" data-wa="${esc(c.wa_id)}" data-name="${esc(c.name ?? '')}" data-channel="${esc(c.channel)}">
      <input id="as-cust" placeholder="${esc(t('test.replyAs', { name: c.name ? c.name.split(' ')[0] : t('test.customer') }))}" autocomplete="off"><button aria-label="${t('chat.send')}">${ICON.send}</button></form>` : ''}
    <form class="composer" data-form="reply" data-id="${esc(id)}">
      <input id="reply" placeholder="${c.window_open ? t('chat.reply') : t('chat.replyOff')}" autocomplete="off" ${c.window_open ? '' : 'disabled'}>
      <button ${c.window_open ? '' : 'disabled'} aria-label="${t('chat.send')}">${ICON.send}</button></form>
    </div></div>`;
  if (stickToBottom) window.scrollTo(0, document.body.scrollHeight);
};

/** Orders placed in chats: waiting for payment, paid, or closed. */
views.orders = async () => {
  const list = await api(`/api/orders?sellerId=${sellerId()}`);
  const toPay = list.filter((o) => o.status === 'held');
  header(t('ord.title'), { sub: t('ord.sub', { n: toPay.length }) });
  setNav('orders');
  S.orderFilter ??= 'toPay';
  const shown = S.orderFilter === 'toPay' ? list.filter((o) => ['held', 'expired', 'refund_due'].includes(o.status)) : S.orderFilter === 'paid' ? list.filter((o) => o.status === 'paid') : list;
  const f = (k, text, n) => `<button class="chip ${S.orderFilter === k ? 'on' : ''}" data-ofilter="${k}">${text}${n ? `<span class="c">${n}</span>` : ''}</button>`;
  const pill = (o) => {
    if (o.status === 'held' && o.claimed_at) return `<span class="pill notified">${t('ord.claimed')}</span>`;
    if (o.status === 'held') return `<span class="pill held">${t('ord.held', { left: mins(Math.round((new Date(o.expires_at) - Date.now()) / 6e4)) })}</span>`;
    if (o.status === 'paid') return `<span class="pill paid">${t('ord.paid', { at: when(o.paid_at) })}${o.paid_via === 'manual' ? ` · ${t('ord.byHand')}` : ''}</span>`;
    if (o.status === 'refund_due') return `<span class="pill refund">${t('ord.refund')}</span>`;
    if (o.status === 'cancelled') return `<span class="pill expired">${t('ord.cancelled')}</span>`;
    return `<span class="pill expired">${t('ord.expired')}</span>`;
  };
  const customer = (o) => who({ channel: o.contact_channel, name: o.name, username: o.username, wa_id: o.wa_id });
  const paid = list.filter((o) => o.status === 'paid');
  const toCheck = list.filter((o) => o.status === 'held' && o.claimed_at).length;
  const toCollect = toPay.reduce((a, o) => a + Number(o.amount_minor), 0);
  main.innerHTML = `
    ${!S.dryRun && !S.seller?.payments_connected && !(S.seller?.pay_methods ?? []).length ? banner(t('ord.manualNote', { href: '#/settings' }), 'info') : ''}
    ${toCheck ? banner(t('ord.checkBanner', { n: toCheck }), 'ok') : ''}
    ${list.length ? `<div class="tiles">
      <div class="tile"><span class="ico gold">${ICON.clock}</span><span class="k">${t('ord.toCollect')}</span><b class="num">${money(toCollect)}</b></div>
      <div class="tile"><span class="ico">${ICON.check}</span><span class="k">${t('ord.paidTab')}</span><b class="num">${paid.length}</b></div>
    </div>` : ''}
    <div class="chips" style="padding-top:14px">${f('toPay', t('ord.toPay'), toPay.length)}${f('paid', t('ord.paidTab'))}${f('all', t('ord.all'))}</div>
    <div class="group">${shown.map((o) => `<div class="order">
      <div class="order-top">${avatar(customer(o))}<div class="order-id"><a href="#/chat/${esc(o.contact_id)}" class="order-who">${esc(customer(o))}</a><span class="hint">${when(o.created_at)}${o.delivery_zone ? ` · ${t('ord.delivery', { zone: esc(o.delivery_zone), fee: o.delivery_fee_minor > 0 ? money(o.delivery_fee_minor) : t('dl.free') })}` : ''}</span></div>${pill(o)}</div>
      <div class="order-what"><b>${o.quantity} × ${label({ name: o.product, variant: o.variant })}</b><span class="num">${money(o.amount_minor)}</span></div>
      ${o.status === 'held' && o.claimed_at ? `<div class="claim">${ICON.money}<span>${o.claim_note && o.claim_note !== 'photo' ? t('ord.claimNote', { note: esc(o.claim_note) }) : o.claim_note === 'photo' ? t('ord.claimPhoto') : t('ord.claimSaid')}</span></div>
        <div class="btns split"><button class="btn primary sm" data-order-paid="${esc(o.id)}" data-name="${esc(customer(o))}" data-claimed="1">${ICON.check}${t('ord.confirm')}</button><button class="btn sm" data-order-unclaim="${esc(o.id)}" data-name="${esc(customer(o))}">${t('ord.notReceived')}</button></div>`
      : ['held', 'expired'].includes(o.status) ? `<div class="btns split"><button class="btn primary sm" data-order-paid="${esc(o.id)}" data-name="${esc(customer(o))}">${ICON.check}${t('ord.markPaid')}</button><button class="btn sm" data-order-cancel="${esc(o.id)}">${t('ord.cancel')}</button></div>` : ''}
    </div>`).join('')
      || (list.length ? empty('check', t('ord.nothing')) : empty('orders', t('ord.emptyTitle'), t('ord.empty')))}</div>
    <p class="lead" style="padding-top:14px">${t('ord.how')}</p>`;
};

views.products = async () => {
  const products = await api(`/api/products?sellerId=${sellerId()}`);
  header(t('stock.title'), { sub: t('stock.peopleWaiting', { n: products.reduce((a, p) => a + p.waiting, 0) }) });
  setNav('stock');
  const row = (p) => `<a class="row" href="#/product/${esc(p.id)}">${thumb(p)}
    <span style="min-width:0"><span class="name"><span class="n">${esc(p.name)}</span></span><span class="last">${esc(variantText(p.variant) || t('stock.noVariant'))} · ${money(p.price_minor)}</span>
      <span class="tagline">${p.stock > 0 ? `<span class="tag">${t('stock.inStockN', { n: p.stock })}</span>` : `<span class="tag hold">${t('stock.soldOut')}</span>`}</span></span>
    <span class="r"><b class="${p.waiting ? '' : 'zero'}">${p.waiting}</b>${t('stock.waitingLabel')}</span></a>`;
  const out = products.filter((p) => p.stock === 0);
  const inStock = products.filter((p) => p.stock > 0);
  main.innerHTML = `<div class="pad" style="padding-top:4px"><a class="btn primary block" href="#/products/new">${ICON.plus}${t('stock.add')}</a></div>
    ${out.length ? `${sect(t('stock.soldOut'), out.length)}<div class="group">${out.map(row).join('')}</div>` : ''}
    ${inStock.length ? `${sect(t('stock.inStock'), inStock.length)}<div class="group">${inStock.map(row).join('')}</div>` : ''}
    ${products.length ? '' : `<div class="group">${empty('box', t('stock.emptyTitle'), t('stock.empty'))}</div>`}`;
};

views.newProduct = async () => {
  header(t('product.addTitle'), { back: '#/products' });
  setNav('stock');
  const both = S.seller.language === 'fr+en';
  main.innerHTML = `<div class="group" style="margin-top:8px"><form class="form" data-form="product">
    <label>${t('product.name')}<input id="p-name" required placeholder="${esc(t('product.namePh'))}"></label>
    <label>${t('product.variant')}<input id="p-variant" placeholder="${both ? t('product.variantPhBoth') : shopLang() === 'fr' ? 'Marron' : 'Brown'}"><span class="hint">${t('product.variantHint')}${both ? t('product.variantHintBoth') : ''}</span></label>
    <div class="row2">
      <label>${t('product.price', { cur: esc(S.seller.currency) })}<input id="p-price" type="number" inputmode="decimal" min="0" step="any" required></label>
      <label>${t('product.stockNow')}<input id="p-stock" type="number" inputmode="numeric" min="0" step="1" value="0"></label>
    </div>
    <label>${t('product.aliases')}<input id="p-aliases" placeholder="${esc(t('product.aliasesPh'))}"><span class="hint">${t('product.aliasesHint')}</span></label>
    <label class="drop" id="p-drop"><span class="ico">${ICON.camera}</span><span><b id="p-drop-t">${t('ph.add')}</b><span class="hint">${t('ph.optional')}</span></span><input id="p-photo" type="file" accept="image/*"></label>
    <p class="err" id="p-err" hidden></p>
    <button class="btn primary block">${t('product.save')}</button></form></div>`;
};
// Show the chosen photo's name in the add-product form.
document.addEventListener('change', (e) => {
  if (e.target.id !== 'p-photo') return;
  const f = e.target.files?.[0];
  $('#p-drop')?.classList.toggle('has', !!f);
  if ($('#p-drop-t')) $('#p-drop-t').textContent = f ? f.name : t('ph.add');
});

views.product = async ([id]) => {
  const [{ product: p, restocks }, waitlist, drop] = await Promise.all([api(`/api/products/${id}`), api(`/api/products/${id}/waitlist`), api(`/api/products/${id}/price-drop`).catch(() => null)]);
  if (!S.restockForm || S.restockForm.id !== id) S.restockForm = { id, units: 3, mode: 'hold', holdMinutes: 120, perUnit: 5 };
  const f = S.restockForm;
  const past = restocks.filter((r) => r.messaged > 0);
  const bought = past.length ? Math.round((100 * past.reduce((a, r) => a + r.sold, 0)) / past.reduce((a, r) => a + r.messaged, 0)) : null;
  const running = restocks.find((r) => !r.closed_at);
  header(label(p), { back: '#/products', sub: money(p.price_minor) });
  setNav('stock');
  const stepper = (k) => `<span class="step"><button type="button" data-cfg="${k}:-1" aria-label="${t('fewer')}">−</button><output>${f[k]}</output><button type="button" data-cfg="${k}:1" aria-label="${t('more')}">+</button></span>`;
  const q = (text) => (lang() === 'fr' ? `« ${text} »` : `“${text}”`);
  const pic = photoOf(p);
  main.innerHTML = `
    <div class="photo-block">
      ${pic ? `<img src="${esc(pic)}" alt="">` : avatar(p.name, 'prodicon big')}
      <div><p class="note" style="margin:0 0 10px">${t('ph.why')}</p>
        <div class="btns" style="margin:0"><label class="btn sm">${ICON.camera}${pic ? t('ph.change') : t('ph.add')}<input type="file" accept="image/*" data-photo="${esc(p.id)}" hidden></label>
        ${pic ? `<button class="btn sm ghost" data-photo-remove="${esc(p.id)}">${t('ph.remove')}</button>` : ''}</div></div>
    </div>
    <div class="kv"><div><span>${t('product.inStock')}</span><b>${p.stock}</b></div><div><span>${t('product.waiting')}</span><b>${p.waiting}</b></div><div><span>${t('product.bought')}</span><b>${bought === null ? t('none') : pct(bought)}</b></div></div>
    ${running ? banner(t('product.running', { href: `#/restock/${esc(running.id)}` }), 'info') : ''}
    ${S.priceDrop?.id === id && drop?.watchers ? `<div class="card accent"><div class="head"><span class="ico gold">${ICON.tag}</span><h2>${t('pd.title')}</h2></div>
      <p>${t('pd.text', { n: drop.watchers, to: money(p.price_minor), from: money(S.priceDrop.fromMinor) })}</p>
      <div class="cost"><span class="tot">${t('restock.feesTotal')}</span><b class="tot num">${fee(drop.costUsdMicros)}</b></div>
      <div class="btns split"><button class="btn primary" data-act="price-drop">${t('pd.send', { n: drop.watchers })}</button><button class="btn" data-act="price-drop-later">${t('pd.later')}</button></div></div>`
      : drop?.watchers ? banner(t('pd.waiting', { n: drop.watchers }), 'info') : ''}
    <div class="card"><div class="head"><span class="ico">${ICON.box}</span><h2>${p.waiting ? t('restock.logTitle') : t('restock.addStock')}</h2></div>
      <div class="field"><label>${t('restock.units')}</label>${stepper('units')}</div>
      ${p.waiting ? `<div class="field"><div class="seg"><button type="button" data-mode="hold" class="${f.mode === 'hold' ? 'on' : ''}">${t('restock.hold')}</button><button type="button" data-mode="race" class="${f.mode === 'race' ? 'on' : ''}">${t('restock.race')}</button></div></div>
      ${f.mode === 'hold'
        ? `<div class="field"><label>${t('restock.holdLength')}</label><div class="seg" style="width:auto;min-width:230px">${[60, 120, 240, 1440].map((m) => `<button type="button" data-hold="${m}" class="${f.holdMinutes === m ? 'on' : ''}">${mins(m)}</button>`).join('')}</div></div>`
        : `<div class="field"><label>${t('restock.perUnit')}<span class="hint">${t('restock.perUnitHint')}</span></label>${stepper('perUnit')}</div>`}` : ''}
      <div id="plan"><p class="note">${t('restock.working')}</p></div>
    </div>
    ${waitlist.length ? `${sect(t('waitlist.title'), waitlist.length)}<div class="group">${waitlist.map((w) => `<div class="line"><span class="pos">${w.position}</span>
      <span>${esc(w.name ?? phone(w.wa_id))}<span class="q">${q(esc(w.consent_quote))} · ${t('waitlist.since', { when: when(w.joined_at) })}</span></span>${chip('whatsapp')}</div>`).join('')}</div>` : ''}
    ${sect(t('edit.title'))}
    <div class="group"><form class="form" data-form="edit-product" data-id="${esc(id)}">
      <div class="row2">
        <label>${t('edit.stock')}<input id="e-stock" type="number" inputmode="numeric" min="0" step="1" value="${p.stock}"></label>
        <label>${t('product.price', { cur: esc(S.seller.currency) })}<input id="e-price" type="number" inputmode="decimal" min="0" step="any" value="${toMajor(p.price_minor)}"></label>
      </div>
      <span class="hint" style="margin-top:-8px">${t('edit.stockHint')}</span>
      <label>${t('product.aliases')}<input id="e-aliases" value="${esc(p.aliases.join(', '))}"></label>
      <button class="btn block">${t('edit.save')}</button></form></div>
    ${restocks.length ? `${sect(t('past.title'))}<div class="group">${restocks.map((r) => `<a class="line" href="#/restock/${esc(r.id)}"><span class="pos">${r.units}×</span>
      <span>${when(r.created_at)} · ${r.mode === 'hold' ? t('past.holds') : t('past.race')}<span class="q">${t('past.counts', { sold: r.sold, messaged: r.messaged })}</span></span>${r.closed_at ? `<span class="pill expired">${t('past.done')}</span>` : `<span class="pill held">${t('past.running')}</span>`}</a>`).join('')}</div>` : ''}`;
  loadPlan(id, p);
};

async function loadPlan(id, p) {
  const f = S.restockForm;
  const plan = $('#plan');
  if (!plan) return;
  try {
    const pv = await api(`/api/products/${id}/restocks/preview`, { method: 'POST', body: { units: f.units, mode: f.mode, holdMinutes: f.holdMinutes, perUnit: f.perUnit } });
    if ($('#plan') !== plan) return;
    const what = pv.toMessage === 0
      ? t('restock.nobody', { n: f.units })
      : f.mode === 'hold'
        ? t('restock.planHold', { n: pv.toMessage, len: mins(f.holdMinutes) })
        : t('restock.planRace', { n: pv.toMessage, units: f.units });
    plan.innerHTML = `<p class="note" style="margin-top:4px">${what}</p>
      ${pv.toMessage ? `<p class="hint" style="margin:14px 0 8px;font-weight:650">${t('restock.previewLabel')}</p><div class="preview-wrap"><div class="preview">${esc(pv.preview)}</div></div>
      <p class="note">${t('restock.previewNote')}</p>
      <div class="cost" style="margin-top:16px"><span>${t('restock.alerts', { n: pv.toMessage })}</span><b class="num">${fee(pv.costUsdMicros.alerts)}</b>
        ${pv.soldOutNotes ? `<span>${t('restock.soldOutNotes', { n: pv.soldOutNotes })}</span><b class="num">${fee(pv.costUsdMicros.soldOutNotes)}</b>` : f.mode === 'hold' ? `<span>${t('restock.reoffer')}</span><b class="num">${fee(pv.perMessageUsdMicros.marketing)}</b>` : ''}
        <span class="tot">${t('restock.feesTotal')}</span><b class="tot num">${fee(pv.costUsdMicros.total)}</b></div>
      ${S.seller?.currency !== 'USD' ? `<p class="note">${t('restock.feesNote', { usd: usd(pv.costUsdMicros.total) })}</p>` : ''}` : ''}
      <div class="btns">${S.confirm
        ? `<div class="btns split" style="margin:0;width:100%"><button class="btn primary" data-act="restock-go">${t('restock.confirm', { n: pv.toMessage })}</button><button class="btn" data-act="restock-cancel">${t('restock.cancel')}</button></div>`
        : `<button class="btn primary block" data-act="restock-ask" ${pv.running ? 'disabled' : ''}>${pv.running ? t('restock.wait') : t('restock.go', { units: f.units, n: pv.toMessage })}</button>`}</div>`;
  } catch (e) {
    plan.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

views.restock = async ([id]) => {
  const { restock: r, offers } = await api(`/api/restocks/${id}`);
  const { product: p } = await api(`/api/products/${r.product_id}`);
  const sold = offers.filter((o) => o.status === 'paid').length;
  const held = offers.filter((o) => o.status === 'held').length;
  header(r.closed_at ? t('rs.finished') : t('rs.running'), { back: `#/product/${esc(p.id)}`, sub: `${label(p)} · ${when(r.created_at)}` });
  setNav('stock');
  const slots = Array.from({ length: Math.min(r.units, 12) }, (_, k) => (k < sold ? 'sold' : k < sold + held ? 'held' : ''));
  const pill = (o) => {
    if (o.refund_due) return `<span class="pill refund">${t('rs.paidLate')}</span>`;
    if (o.claimed_at && ['held', 'notified'].includes(o.status)) return `<span class="pill notified">${t('ord.claimed')}</span>`;
    if (o.status === 'held') return `<span class="pill held">${t('rs.held', { left: mins(Math.round((new Date(o.expires_at) - Date.now()) / 6e4)) })}</span>`;
    if (o.status === 'paid') return `<span class="pill paid">${t('rs.paid', { at: clock(o.paid_at) })}</span>`;
    if (o.status === 'expired') return `<span class="pill expired">${t('rs.holdEnded')}</span>`;
    if (o.status === 'missed') return `<span class="pill missed">${t('rs.soldOutNote')}</span>`;
    return `<span class="pill notified">${t('rs.messaged')}</span>`;
  };
  main.innerHTML = `
    <div class="units">${slots.map((s, k) => `<span class="${s}">${s === 'sold' ? t('rs.sold') : s === 'held' ? t('rs.heldSlot') : t('rs.unit', { n: k + 1 })}</span>`).join('')}${r.units > 12 ? `<span>+${r.units - 12}</span>` : ''}</div>
    <div class="stats"><div><span>${t('rs.sold')}</span><b class="num">${t('rs.soldOf', { sold, units: r.units })}</b></div><div><span>${t('rs.messagedCount')}</span><b class="num">${offers.length}</b></div><div><span>${t('rs.sales')}</span><b class="num">${money(sold * p.price_minor)}</b></div></div>
    ${r.closed_at ? banner(t('rs.doneBanner', { sold, left: r.units - sold }), 'ok') : ''}
    ${sect(t('rs.who'), offers.length)}
    <div class="group">${offers.map((o) => `<div class="line">${avatar(o.name ?? o.wa_id)}<span>${esc(o.name ?? phone(o.wa_id))}<span class="q">${phone(o.wa_id)} · ${clock(o.sent_at)}</span></span>
      <span class="end">${pill(o)}${o.claimed_at && ['held', 'notified'].includes(o.status)
        ? `<span class="btns" style="margin:0"><button class="btn primary sm" data-offer-paid="${esc(o.id)}">${t('ord.confirm')}</button><button class="btn sm" data-offer-unclaim="${esc(o.id)}" data-name="${esc(o.name ?? phone(o.wa_id))}">${t('ord.notReceived')}</button></span>`
        : S.dryRun && ['held', 'notified'].includes(o.status) ? `<button class="btn sm" data-pay="${esc(o.payment_ref)}">${t('rs.testPaid')}</button>` : ''}</span></div>
      ${o.claim_note && o.claim_note !== 'photo' && ['held', 'notified'].includes(o.status) ? `<div class="claim" style="margin:0 16px 12px">${ICON.money}<span>${t('ord.claimNote', { note: esc(o.claim_note) })}</span></div>` : ''}`).join('') || empty('user', t('rs.nobody'))}</div>
    ${!r.closed_at && r.mode === 'hold' ? `<p class="lead" style="padding-top:12px">${t('rs.holdsNote')}${S.dryRun ? ` <button class="btn sm" data-act="tick">${t('rs.testTick')}</button>` : ''}</p>` : ''}`;
};

views.insights = async () => {
  const [ins, consents] = await Promise.all([api(`/api/insights?sellerId=${sellerId()}`), api(`/api/consents?sellerId=${sellerId()}`)]);
  const month = new Date(ins.monthStart).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
  header(t('ins.title'), { sub: month.charAt(0).toUpperCase() + month.slice(1) });
  setNav('insights');
  const demand = ins.demand.filter((d) => d.waiting > 0);
  const q = (text) => (lang() === 'fr' ? `« ${text} »` : `“${text}”`);
  const tile = (icon, k, v, cls = '') => `<div class="tile"><span class="ico ${cls}">${ICON[icon]}</span><span class="k">${k}</span><b class="num">${v}</b></div>`;
  const total = Number(ins.chatSales?.revenue_minor ?? 0) + Number(ins.sales.revenue_minor ?? 0);
  main.innerHTML = `
    <div class="tiles">
      <div class="tile hero"><span class="ico">${ICON.trend}</span><span class="k">${t('ins.total')}</span><b class="num">${money(total)}</b>
        <small>${t('ins.totalNote', { orders: (ins.chatSales?.orders ?? 0) + ins.sales.orders })}</small></div>
      ${tile('chats', t('ins.chatSales'), money(ins.chatSales?.revenue_minor ?? 0))}
      ${tile('orders', t('ins.chatOrders'), ins.chatSales?.orders ?? 0)}
      ${tile('bell', t('ins.sales'), money(ins.sales.revenue_minor), 'gold')}
      ${tile('box', t('ins.orders'), ins.sales.orders, 'gold')}
    </div>
    ${sect(t('ins.activity'))}
    <div class="group">
      ${[['repeat', t('ins.followUps'), ins.followUps?.sent ?? 0], ['check', t('ins.followUpOrders'), ins.followUps?.ordered ?? 0], ['message', t('ins.messages'), ins.spend.messages], ['coins', t('ins.fees'), fee(ins.spend.cost_usd_micros)]]
        .map(([icon, k, v]) => `<div class="line"><span class="pos accent">${ICON[icon]}</span><span>${k}</span><b class="num stat">${v}</b></div>`).join('')}
    </div>
    ${S.seller?.currency !== 'USD' && ins.spend.cost_usd_micros ? `<p class="lead" style="padding-top:10px">${t('ins.feesNote', { usd: usd(ins.spend.cost_usd_micros) })}</p>` : ''}
    ${ins.refunds.length ? `${sect(t('ins.refunds'), ins.refunds.length)}<div class="group">${ins.refunds.map((r) => `<div class="line"><span class="pos no">${ICON.refund}</span><span>${esc(r.name ?? phone(r.wa_id))} · ${money(r.price_minor)}<span class="q">${label({ name: r.product, variant: r.variant })} · ${t('ins.ref', { ref: esc(r.payment_ref) })}</span></span><span class="pill refund">${t('ins.refundDue')}</span></div>`).join('')}</div>` : ''}
    ${sect(t('ins.reorder'))}
    ${demand.length ? `<div class="group"><div class="tablewrap"><table><thead><tr><th>${t('ins.item')}</th><th>${t('ins.waiting')}</th><th>${t('ins.bought')}</th><th>${t('ins.suggest')}</th></tr></thead><tbody>
      ${demand.map((d) => `<tr><td>${esc(d.name)}<span>${esc(variantText(d.variant))}</span></td><td class="num">${d.waiting}</td><td class="num">${d.bought_pct === null ? t('none') : pct(d.bought_pct)}</td>
        <td class="num">${d.bought_pct === null ? t('none') : `<b>${Math.max(1, Math.round((d.waiting * d.bought_pct) / 100))}</b>`}</td></tr>`).join('')}
    </tbody></table></div></div><p class="lead" style="padding-top:10px">${t('ins.reorderNote')}</p>`
      : `<div class="group">${empty('trend', '', t('ins.noWaitlist'))}</div>`}
    ${sect(t('ins.consents'), consents.length || undefined)}
    <div class="group">${consents.map((k) => `<div class="line"><span class="pos ${k.revoked_at ? 'no' : 'ok'}">${k.revoked_at ? ICON.x : ICON.check}</span><span>${esc(k.name ?? phone(k.wa_id))}<span class="q">${t(`purpose.${k.purpose}`) === `purpose.${k.purpose}` ? '' : `${t(`purpose.${k.purpose}`)} · `}${q(esc(k.quote))} · ${label({ name: k.product ?? '', variant: k.variant ?? '' })} · ${when(k.granted_at)}</span></span>${k.revoked_at ? `<span class="pill expired">${t('ins.optedOut')}</span>` : chip(k.channel)}</div>`).join('') || empty('shield', '', t('ins.noConsents'))}</div>`;
};

views.settings = async () => {
  const mk = await markets();
  const s = S.seller;
  header(t('set.title'), { sub: esc(s?.name ?? '') });
  setNav('settings');
  const m = mk.countries.find((c) => c.code === s.country);
  const suggested = m?.providers ?? ['flutterwave', 'stripe'];
  const order = [...new Set([s.payment_provider, ...suggested, 'flutterwave', 'notchpay', 'paystack', 'stripe', 'test'])];
  const connected = (on) => (on ? `<span class="pill paid">${t('set.connected')}</span>` : `<span class="pill expired">${t('set.notConnected')}</span>`);
  const chRow = (ch, title, note, on) => `<div class="line">${brandIco(ch)}<span>${title}<span class="q">${note}</span></span>${connected(on)}</div>`;
  const owner = s.role === 'owner';
  const [members, me] = await Promise.all([api(`/api/sellers/${s.id}/members`), api('/api/me')]);
  // Back from Instagram or Facebook: confirm the sign-in here, where we know who is signed in.
  // An Instagram account or a single Page connects at once; several Pages need a pick.
  let pagePicker = null;
  if (S.pickPage) {
    const pending = await api(`/api/channels/pending/${S.pickPage}?sellerId=${s.id}`).catch((err) => { toast(err.message); return null; });
    if (!pending) S.pickPage = null;
    else if (pending.channel === 'instagram' || pending.pages.length === 1) {
      try {
        await api(`/api/channels/pending/${S.pickPage}`, { method: 'POST', body: { sellerId: s.id } });
        toast(t('ch.connected', { app: chName[pending.channel] }));
      } catch (err) { toast(err.message); }
      S.pickPage = null;
    } else pagePicker = pending.pages;
  }
  const channels = await api(`/api/channels?sellerId=${s.id}`);
  const team = `${sect(t('team.title'), members.length)}
    <div class="group">${members.map((mb) => `<div class="line"><span class="pos ${mb.role === 'owner' ? 'accent' : ''}">${mb.role === 'owner' ? ICON.crown : ICON.user}</span>
      <span>${me.user?.id === mb.user_id ? t('you') : esc(mb.name ?? '+' + mb.wa_id)}<span class="q">${mb.name || me.user?.id === mb.user_id ? `+${esc(mb.wa_id)} · ` : ''}${mb.role === 'owner' ? t('team.owner') : t('team.staff')}</span></span>
      ${owner && me.user?.id !== mb.user_id ? `<button class="btn sm" data-remove-member="${esc(mb.user_id)}">${t('team.remove')}</button>` : '<span></span>'}</div>`).join('')}
    ${owner ? `<form class="form" data-form="member">
      <label>${t('team.add')}<input id="m-phone" type="tel" required placeholder="${esc(samplePhone())}"><span class="hint">${t('team.addHint', { country: esc(countryName(s.country, m?.name)) })}</span></label>
      <label>${t('team.role')}<select id="m-role"><option value="staff">${t('team.staff')}</option><option value="owner">${t('team.ownerOpt')}</option></select></label>
      <p class="err" hidden></p>
      <button class="btn block">${ICON.plus}${t('team.addBtn')}</button></form>` : ''}</div>`;
  main.innerHTML = `
    ${S.dryRun ? banner(t('set.testBanner')) : ''}
    ${owner ? '' : banner(t('set.staffBanner'), 'info')}
    ${await deviceSection()}
    ${shopPage(s, owner)}
    ${owner ? `${sect(t('set.getPaid'))}
    ${directPaySection(s, m)}
    <h3 class="sub-sect">${t('dp.gateway')}</h3>
    <p class="lead">${t('dp.gatewayHint')}</p>
    <div class="group"><form class="form" data-form="payments">
      <label>${t('set.provider')}<select id="pay-provider" data-provider>${order.map((k) => `<option value="${k}" ${k === s.payment_provider ? 'selected' : ''}>${esc(t(`pv.${k}`))}${suggested.includes(k) ? ` · ${t('set.suggested')}` : ''}</option>`).join('')}</select>
        <span class="hint">${t('set.providerHint')}</span></label>
      <div id="pay-keys" style="display:grid;gap:16px">${payKeyFields(mk, s.payment_provider)}</div>
      <p class="note" id="pay-hook" style="margin:0">${s.payment_provider !== 'test' && s.payments_connected ? t('set.webhookUrl', { url: `${esc(API || location.origin)}/webhooks/payments/${esc(s.id)}` }) : ''}</p>
      <p class="err" hidden></p>
      <button class="btn primary block">${ICON.lock}${t('set.savePay')}</button>
    </form></div>
    ${sect(t('set.shop'))}
    <div class="group"><form class="form" data-form="shop">
      <label>${t('shop.name')}<input id="s-name" value="${esc(s.name)}" required></label>
      ${shopFields(mk, s)}
      <label>${t('stk.label')}<select id="s-stock" data-stock>${['exact', 'low', 'hidden'].map((k) => `<option value="${k}" ${(s.stock_display ?? 'exact') === k ? 'selected' : ''}>${t(`stk.${k}`)}</option>`).join('')}</select>
        <span class="hint" id="s-stock-hint">${stockHint(s.stock_display ?? 'exact', s.low_stock_at ?? 5)}</span></label>
      <label id="s-low-wrap" ${(s.stock_display ?? 'exact') === 'low' ? '' : 'hidden'}>${t('stk.lowAt')}<input id="s-low" type="number" inputmode="numeric" min="1" max="50" value="${s.low_stock_at ?? 5}"><span class="hint">${t('stk.lowAtHint')}</span></label>
      <label class="check"><input type="checkbox" id="s-followups" ${s.follow_ups !== false ? 'checked' : ''}><span>${t('fu.label')}<span class="hint">${t('fu.hint')}</span></span></label>
      <label id="s-rate-wrap" data-from="${esc(s.currency)}" hidden><span id="s-rate-label">${t('rate.title')}</span><input id="s-rate" type="number" min="0" step="any"><span class="hint" id="s-rate-hint"></span></label>
      <p class="err" hidden></p>
      <button class="btn block">${t('set.saveShop')}</button>
    </form></div>
    ${await deliverySection(s)}` : ''}
    ${team}
    ${sect(t('ch.title'))}
    <div class="group">
    ${S.dryRun
      ? `<div class="line">${brandIco('whatsapp')}<span>WhatsApp<span class="q">${t('ch.testWa')}</span></span><span class="pill held">${t('ch.testPill')}</span></div>`
      : chRow('whatsapp', 'WhatsApp', t('ch.numberId', { id: esc(s.wa_phone_number_id) }), true)}
    ${['instagram', 'facebook'].map((ch) => channelCard(ch, channels, s, owner)).join('')}
    <div class="line">${brandIco('tiktok')}<span>TikTok<span class="q">${t('ch.tiktok')}</span></span>${s.slug ? `<button class="btn sm" data-act="copy-shop">${ICON.copy}${t('ch.copyLink')}</button>` : '<span></span>'}</div>
    </div>
    <p class="lead" style="padding-top:10px">${t('ch.waNote')}</p>
    ${pagePicker?.length ? `<div class="card"><h2>${t('ch.whichPage')}</h2><p>${t('ch.whichPageText')}</p>
      <div class="btns">${pagePicker.map((p) => `<button class="btn" data-act="pick-page" data-page="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <div class="pad btns split" style="margin-top:12px"><a class="btn" href="#/setup">${ICON.swap}${t('set.switchShop')}</a><button class="btn danger" data-act="signout">${ICON.logout}${t('set.signOut')}</button></div>`;
};
/** What customers will read about stock, for the setting's hint. */
const stockHint = (mode, n) => (mode === 'low' ? t('stk.hintLow', { n }) : mode === 'hidden' ? t('stk.hintHidden') : t('stk.hintExact'));
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-stock], #s-low')) return;
  const form = e.target.closest('form');
  const mode = $('#s-stock', form).value;
  $('#s-low-wrap', form).hidden = mode !== 'low';
  $('#s-stock-hint', form).textContent = stockHint(mode, Number($('#s-low', form).value) || 5);
});

/** Direct payment: the seller's own mobile money numbers or bank accounts (owner only). */
function directPaySection(s, m) {
  const methods = s.pay_methods ?? [];
  const suggest = m?.payWith ?? ['Bank transfer'];
  return `<p class="lead">${t('dp.intro')}</p>
    <div class="group">${methods.map((x, i) => `<div class="line"><span class="pos accent">${ICON.money}</span><span>${esc(x.label)} · ${esc(x.account)}<span class="q">${[x.holder, x.note].filter(Boolean).map(esc).join(' · ') || t('dp.noHolder')}</span></span><button class="btn sm ghost" data-method-remove="${i}">${t('dp.remove')}</button></div>`).join('')
      || empty('money', t('dp.noneTitle'), t('dp.none'))}
    ${methods.length < 5 ? `<form class="form" data-form="paymethod">
      <div class="row2">
        <label>${t('dp.method')}<input id="pm-label" list="pm-list" required maxlength="40" placeholder="${esc(suggest[0])}"><datalist id="pm-list">${suggest.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>${t('dp.account')}<input id="pm-account" required maxlength="60" inputmode="tel" placeholder="${esc(samplePhone())}"></label>
      </div>
      <label>${t('dp.holder')}<input id="pm-holder" maxlength="60" placeholder="${esc(s.name)}"><span class="hint">${t('dp.holderHint')}</span></label>
      <label>${t('dp.note')}<input id="pm-note" maxlength="160" placeholder="${esc(t('dp.notePh'))}"></label>
      <p class="err" hidden></p>
      <button class="btn primary block">${ICON.plus}${t('dp.add')}</button></form>` : ''}</div>`;
}

/** Delivery areas and fees (owner only). */
async function deliverySection(s) {
  const zones = await api(`/api/delivery-zones?sellerId=${s.id}`);
  const fee = (z) => (z.fee_minor > 0 ? money(z.fee_minor) : t('dl.free'));
  return `${sect(t('dl.title'), zones.length || undefined)}
    <p class="lead">${t('dl.intro')}</p>
    <div class="group">${zones.map((z) => `<div class="line"><span class="pos accent">${z.fee_minor > 0 ? ICON.truck : ICON.store}</span><span>${esc(z.name)}<span class="q">${fee(z)}${z.aliases.length ? ` · ${esc(z.aliases.join(', '))}` : ''}</span></span><button class="btn sm ghost" data-zone-remove="${esc(z.id)}">${t('dl.remove')}</button></div>`).join('')
      || empty('truck', '', t('dl.none'))}
    <form class="form" data-form="zone">
      <div class="row2">
        <label>${t('dl.name')}<input id="z-name" required maxlength="60" placeholder="${esc(t('dl.namePh'))}"></label>
        <label>${t('dl.fee', { cur: esc(s.currency) })}<input id="z-fee" type="number" inputmode="decimal" min="0" step="any" required></label>
      </div>
      <label>${t('dl.aliases')}<input id="z-aliases"><span class="hint">${t('product.aliasesHint')}</span></label>
      <p class="err" hidden></p>
      <button class="btn block">${ICON.plus}${t('dl.add')}</button></form></div>`;
}

// ---------- this phone: install and notifications ----------
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
/** A computer with a mouse or trackpad, rather than a phone or tablet. */
const isComputer = () => window.matchMedia?.('(pointer: fine) and (hover: hover)').matches && !isIos();
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const swReady = () => (navigator.serviceWorker ? Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]) : Promise.resolve(null));
async function currentSub() {
  const reg = await swReady();
  return reg ? reg.pushManager.getSubscription() : null;
}
function urlKey(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function deviceSection() {
  const install = standalone()
    ? `<span class="pill paid">${t('dev.installed')}</span>`
    : S.installPrompt ? `<button class="btn sm" data-act="install">${t('dev.install')}</button>` : '<span></span>';
  const installHint = standalone() || S.installPrompt ? '' : ` ${isIos() ? t('dev.installIos') : isComputer() ? t('dev.installPc') : t('dev.installOther')}`;
  let notif = '';
  let action = '<span></span>';
  const me = await api('/api/me').catch(() => ({}));
  if (me.admin) notif = t('dev.adminOnly');
  else if (!pushSupported()) notif = isIos() && !standalone() ? t('dev.iosFirst') : t('dev.unsupported');
  else if (Notification.permission === 'denied') notif = t('dev.blocked');
  else {
    const sub = await currentSub();
    const st = await api(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''}`).catch(() => ({ available: false }));
    if (!st.available) notif = t('dev.notReady');
    else if (st.subscribed) {
      notif = `${t('dev.notifWhat')}`;
      action = `<span class="pill paid">${t('dev.notifOn')}</span>`;
      S.pushOn = true;
    } else {
      notif = t('dev.notifWhat');
      action = `<button class="btn sm" data-act="push-on">${t('dev.turnOn')}</button>`;
      S.pushOn = false;
    }
    S.pushKey = st.publicKey;
  }
  return `${sect(t('dev.title'))}
    <div class="group">
    <div class="line"><span class="pos accent">${isComputer() ? ICON.download : ICON.phone}</span><span>${t('dev.install')}<span class="q">${isComputer() ? t('dev.installWhatPc') : t('dev.installWhat')}${installHint}</span></span>${install}</div>
    <div class="line"><span class="pos accent">${ICON.bell}</span><span>${t('dev.notif')}<span class="q">${notif}</span></span>${action}</div>
    ${S.pushOn ? `<div class="pad btns" style="margin:0"><button class="btn sm" data-act="push-test">${t('dev.test')}</button><button class="btn sm ghost" data-act="push-off">${t('dev.turnOff')}</button></div>` : ''}
    </div>`;
}
async function pushOn() {
  if ((await Notification.requestPermission()) !== 'granted') { toast(t('dev.blocked')); return; }
  const reg = await swReady();
  if (!reg) { toast(t('dev.unsupported')); return; }
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(S.pushKey) }));
  await api('/api/push', { method: 'POST', body: sub.toJSON() });
  toast(t('dev.enabled'));
}
async function pushOff() {
  const sub = await currentSub();
  if (sub) {
    await api('/api/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  S.pushOn = false;
  toast(t('dev.disabled'));
}

/** One optional channel in Settings: connect it, or pause, turn comment replies on or off, and disconnect. */
function channelCard(ch, channels, s, owner) {
  const a = channels.accounts.find((x) => x.channel === ch);
  const title = ch === 'instagram' ? 'Instagram' : t('ch.messenger');
  if (!a) {
    const what = ch === 'instagram' ? t('ch.igWhat') : t('ch.fbWhat');
    const action = !owner ? '<span></span>'
      : channels.available[ch] ? `<button class="btn sm primary" data-act="ch-connect" data-ch="${ch}">${t('ch.connect')}</button>`
      : S.dryRun ? `<button class="btn sm" data-act="ch-sample" data-ch="${ch}">${t('ch.sample')}</button>`
      : `<span class="pill expired">${t('ch.notSetUp')}</span>`;
    return `<div class="line">${brandIco(ch)}<span>${title}<span class="q">${what}${!channels.available[ch] && !S.dryRun ? t('ch.serverNeeds', { what: ch === 'instagram' ? 'IG_APP_ID + IG_APP_SECRET' : 'META_APP_ID' }) : ''}</span></span>${action}</div>`;
  }
  const handle = a.username ? '@' + a.username : a.name ?? '';
  return `<div class="line">${brandIco(ch)}<span>${title}${handle ? ` · ${esc(handle)}` : ''}
      <span class="q">${a.enabled ? t('ch.answering') : t('ch.paused')}${a.comment_replies ? t('ch.commentsOn') : ''}${!s.wa_display_phone ? t('ch.needWa') : ''}</span></span>
      <span class="pill ${a.enabled ? 'paid' : 'held'}">${a.enabled ? t('ch.on') : t('ch.pausedPill')}</span></div>
    ${owner ? `<div class="pad btns" style="margin:0">
      <button class="btn sm" data-act="ch-set" data-id="${esc(a.id)}" data-field="enabled" data-on="${!a.enabled}">${a.enabled ? t('ch.pause') : t('ch.turnOn')}</button>
      <button class="btn sm" data-act="ch-set" data-id="${esc(a.id)}" data-field="commentReplies" data-on="${!a.comment_replies}">${a.comment_replies ? t('ch.stopComments') : t('ch.replyComments')}</button>
      <button class="btn sm danger" data-act="ch-remove" data-id="${esc(a.id)}" data-name="${esc(title)}">${t('ch.disconnect')}</button></div>` : ''}`;
}

/** The public page customers open from a link or a printed QR code. */
const shopUrl = (s) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}shop.html?s=${encodeURIComponent(s.slug)}`;
function shopPage(s, owner) {
  const ready = s.slug && s.wa_display_phone;
  let qr = '';
  if (ready && window.qrcode) {
    const code = window.qrcode(0, 'M');
    code.addData(shopUrl(s));
    code.make();
    qr = `<div class="qr">${code.createSvgTag({ cellSize: 5, margin: 2, scalable: true })}</div>`;
  }
  return `${sect(t('sp.title'))}
    <div class="group">
    <div class="card accent" style="margin:0;border:0;border-radius:0;box-shadow:none">
      <div class="head"><span class="ico">${ICON.store}</span><h2>${ready ? esc(s.name) : t('sp.title')}</h2></div>
      ${ready
        ? `<p>${t('sp.ready')}</p>
           <div class="linkbox">${ICON.link}<a href="${esc(shopUrl(s))}" target="_blank" rel="noopener">${esc(shopUrl(s).replace(/^https?:\/\//, ''))}</a></div>
           ${qr}
           <div class="btns"><button type="button" class="btn sm" data-act="copy-shop">${ICON.copy}${t('sp.copy')}</button>${qr ? `<button type="button" class="btn sm" data-act="qr-download">${ICON.qr}${t('sp.qr')}</button>` : ''}</div>`
        : `<p>${t('sp.notReady')}</p>`}
    </div>
    ${owner ? `<form class="form" data-form="shoppage">
      <label>${t('sp.phone')}<input id="sp-phone" type="tel" value="${s.wa_display_phone ? '+' + esc(s.wa_display_phone) : ''}" placeholder="${esc(samplePhone())}"><span class="hint">${t('sp.phoneHint')}</span></label>
      <label>${t('sp.slug')}<input id="sp-slug" value="${esc(s.slug ?? '')}" placeholder="${lang() === 'fr' ? 'ma-boutique' : 'my-shop'}"><span class="hint">${t('sp.slugHint')}</span></label>
      <p class="err" hidden></p>
      <button class="btn block">${t('sp.save')}</button></form>` : ''}
    </div>`;
}

function payKeyFields(mk, provider) {
  const info = mk.providers[provider];
  if (provider === 'test') return `<p class="note">${t('set.testCheckout')}</p>`;
  return `<label>${t('set.key', { provider: esc(info.label.split(' (')[0]) })}<input id="pay-secret" type="password" autocomplete="off" placeholder="${S.seller.payments_connected && S.seller.payment_provider === provider ? t('set.keySaved') : ''}"><span class="hint">${esc(t(`pv.${provider}.secret`))}</span></label>
    ${info.needsWebhookSecret ? `<label>${t('set.webhookSecret')}<input id="pay-hook-secret" type="password" autocomplete="off"><span class="hint">${esc(t(`pv.${provider}.webhook`))}</span></label>` : ''}`;
}
// Picking a photo on a product's page uploads it right away.
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-photo]') || !e.target.files?.[0]) return;
  toast(t('ph.saving'));
  try { await uploadPhoto(e.target.dataset.photo, e.target.files[0]); toast(t('ph.saved')); } catch (err) { toast(err.message); }
  route(true);
});
document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-provider]')) $('#pay-keys').innerHTML = payKeyFields(await markets(), e.target.value);
});

// ---------- router ----------
const routes = [
  [/^#\/login$/, 'login'], [/^#\/setup$/, 'setup'], [/^#\/chats$/, 'chats'], [/^#\/chat\/([\w-]+)$/, 'chat'], [/^#\/products$/, 'products'],
  [/^#\/products\/new$/, 'newProduct'], [/^#\/product\/([\w-]+)$/, 'product'], [/^#\/restock\/([\w-]+)$/, 'restock'],
  [/^#\/insights$/, 'insights'], [/^#\/settings$/, 'settings'], [/^#\/orders$/, 'orders'],
];
async function route(quiet = false) {
  let hash = location.hash || '#/chats';
  if (!get('nkg.token')) hash = '#/login';
  else if (hash === '#/login' || (!sellerId() && hash !== '#/setup')) hash = '#/setup';
  const match = routes.map(([re, name]) => [hash.match(re), name]).find(([m]) => m);
  const [m, name] = match ?? [[], 'chats'];
  const key = `${name}:${m.slice(1).join('/')}`;
  if (!quiet) { S.confirm = false; }
  try {
    if (sellerId() && !S.seller && name !== 'setup' && name !== 'login') {
      setSeller((await api('/api/sellers')).find((s) => s.id === sellerId()) ?? null);
      if (!S.seller) { set('nkg.seller', null); location.hash = '#/setup'; return; }
    }
    if (name !== 'chat') main.classList.remove('is-chat');
    main.classList.toggle('quiet', quiet);
    await views[name](m.slice(1));
    main.dataset.view = key;
    if (!quiet) { if (name !== 'chat') window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  } catch (e) {
    if (e.status === 401) { set('nkg.token', null); set('nkg.seller', null); setSeller(null); S.login = null; await views.login([], t('signInAgain')); return; }
    if (e.status === 404 && name !== 'setup' && sellerId() && !S.seller) { set('nkg.seller', null); location.hash = '#/setup'; return; }
    if (!quiet) main.innerHTML = `<div class="group" style="margin-top:12px">${empty('alert', '', esc(e.message))}</div>`;
  }
}
window.addEventListener('hashchange', () => route());

// Refresh only screens that change on their own (new messages, holds counting down), and only
// while the tab is visible: every refresh is a round trip to the database.
setInterval(() => {
  const busy = document.activeElement?.matches('input, textarea, select') || S.confirm;
  const live = /^#\/(chats|chat\/|restock\/|orders)/.test(location.hash);
  if (live && !busy && document.visibilityState === 'visible' && sellerId() && get('nkg.token')) route(true);
}, 15000);

// ---------- actions ----------
// The FR/EN switch: remember the choice on this device and redraw the current screen in it.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (!b || b.dataset.lang === lang()) return;
  setLang(b.dataset.lang);
  route(true);
  // Notifications on this phone switch language too.
  if (S.pushOn) currentSub().then((sub) => sub && api('/api/push', { method: 'POST', body: sub.toJSON() })).catch(() => {});
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-order-unclaim],[data-offer-paid],[data-offer-unclaim],[data-method-remove],[data-photo-remove],[data-zone-remove],[data-pick],[data-filter],[data-ofilter],[data-order-paid],[data-order-cancel],[data-cfg],[data-mode],[data-hold],[data-act],[data-pay],[data-remove-member]');
  if (!el) return;
  if (el.dataset.orderUnclaim || el.dataset.offerUnclaim) {
    if (!confirm(t('ord.notReceivedAsk', { name: el.dataset.name }))) return;
    try { await api(el.dataset.orderUnclaim ? `/api/orders/${el.dataset.orderUnclaim}/unclaim` : `/api/offers/${el.dataset.offerUnclaim}/unclaim`, { method: 'POST' }); toast(t('ord.notReceivedDone')); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.offerPaid) {
    try { const r = await api(`/api/offers/${el.dataset.offerPaid}/paid`, { method: 'POST' }); toast(r.outcome === 'paid' ? t('rs.markedPaid') : t('rs.payResult', { r: t(`pay.${r.outcome}`) })); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.methodRemove !== undefined) {
    const methods = (S.seller.pay_methods ?? []).filter((_, i) => String(i) !== el.dataset.methodRemove);
    try { setSeller({ ...S.seller, ...await api(`/api/sellers/${sellerId()}/pay-methods`, { method: 'PUT', body: { methods } }) }); toast(t('dp.saved')); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.photoRemove) {
    try { await api(`/api/products/${el.dataset.photoRemove}/photo`, { method: 'DELETE' }); toast(t('ph.removed')); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.zoneRemove) {
    try { await api(`/api/delivery-zones/${el.dataset.zoneRemove}`, { method: 'DELETE' }); toast(t('dl.removed')); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.ofilter) { S.orderFilter = el.dataset.ofilter; return route(true); }
  if (el.dataset.orderPaid) {
    if (!el.dataset.claimed && !confirm(t('ord.markPaidAsk', { name: el.dataset.name }))) return;
    try { await api(`/api/orders/${el.dataset.orderPaid}/paid`, { method: 'POST' }); toast(t('ord.markedPaid')); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.orderCancel) {
    if (!confirm(t('ord.cancelAsk'))) return;
    try { await api(`/api/orders/${el.dataset.orderCancel}/cancel`, { method: 'POST' }); toast(t('ord.cancelledToast')); } catch (err) { toast(err.message); }
    return route(true);
  }
  if (el.dataset.pick) { set('nkg.seller', el.dataset.pick); setSeller(null); return; }
  if (el.dataset.filter) { S.chatFilter = el.dataset.filter; return route(true); }
  if (el.dataset.removeMember) {
    try { await api(`/api/sellers/${sellerId()}/members/${el.dataset.removeMember}`, { method: 'DELETE' }); toast(t('team.removed')); }
    catch (err) { toast(err.message); }
    return route(true);
  }
  const f = S.restockForm;
  if (el.dataset.cfg) {
    const [k, d] = el.dataset.cfg.split(':');
    const max = { units: 500, perUnit: 20 }[k];
    f[k] = Math.max(1, Math.min(max, f[k] + Number(d)));
    el.parentElement.querySelector('output').textContent = f[k];
    S.confirm = false;
    clearTimeout(loadPlan.h);
    loadPlan.h = setTimeout(() => loadPlan(f.id), 200);
    return;
  }
  if (el.dataset.mode) { f.mode = el.dataset.mode; S.confirm = false; return route(true); }
  if (el.dataset.hold) { f.holdMinutes = Number(el.dataset.hold); S.confirm = false; return route(true); }
  if (el.dataset.pay) {
    el.disabled = true;
    const r = await api(`/dev/pay/${el.dataset.pay}`, { method: 'POST' });
    toast(r.outcome === 'paid' ? t('rs.markedPaid') : t('rs.payResult', { r: t(`pay.${r.outcome}`) }));
    return route(true);
  }
  const act = el.dataset.act;
  try {
    if (act === 'restock-ask') { S.confirm = true; return loadPlan(f.id); }
    if (act === 'restock-cancel') { S.confirm = false; return loadPlan(f.id); }
    if (act === 'restock-go') {
      el.disabled = true;
      const r = await api(`/api/products/${f.id}/restocks`, { method: 'POST', body: { units: f.units, mode: f.mode, holdMinutes: f.holdMinutes, perUnit: f.perUnit } });
      S.confirm = false;
      toast(r.offered ? t('restock.sent', { n: r.offered }) : t('restock.added'));
      location.hash = r.offered ? `#/restock/${r.restockId}` : `#/product/${f.id}`;
      if (!r.offered) route(true);
      return;
    }
    if (act === 'ch-connect') {
      const { url } = await api(`/api/channels/${el.dataset.ch}/connect`, { method: 'POST', body: { sellerId: sellerId() } });
      location.href = url;
      return;
    }
    if (act === 'ch-sample') {
      await api('/dev/channels', { method: 'POST', body: { sellerId: sellerId(), channel: el.dataset.ch } });
      toast(t('ch.sampleAdded', { app: chName[el.dataset.ch] }));
      return route(true);
    }
    if (act === 'ch-set') {
      await api(`/api/channels/${el.dataset.id}`, { method: 'PATCH', body: { [el.dataset.field]: el.dataset.on === 'true' } });
      return route(true);
    }
    if (act === 'ch-remove') {
      if (!confirm(t('ch.disconnectAsk', { name: el.dataset.name }))) return;
      await api(`/api/channels/${el.dataset.id}`, { method: 'DELETE' });
      toast(t('ch.disconnected', { name: el.dataset.name }));
      return route(true);
    }
    if (act === 'pick-page') {
      await api(`/api/channels/pending/${S.pickPage}`, { method: 'POST', body: { sellerId: sellerId(), pageId: el.dataset.page } });
      S.pickPage = null;
      toast(t('ch.messengerConnected'));
      return route(true);
    }
    if (act === 'copy-shop') {
      try { await navigator.clipboard.writeText(shopUrl(S.seller)); toast(t('sp.copied')); } catch { toast(t('sp.copyFail')); }
      return;
    }
    if (act === 'qr-download') {
      const code = window.qrcode(0, 'M');
      code.addData(shopUrl(S.seller));
      code.make();
      const a = document.createElement('a');
      a.href = code.createDataURL(12, 24);
      a.download = `${S.seller.slug}-qr.gif`;
      a.click();
      return;
    }
    if (act === 'price-drop') {
      el.disabled = true;
      const r = await api(`/api/products/${S.priceDrop.id}/price-drop`, { method: 'POST' });
      S.priceDrop = null;
      toast(t('pd.sent', { n: r.sent }));
      return route(true);
    }
    if (act === 'price-drop-later') { S.priceDrop = null; return route(true); }
    if (act === 'install') {
      const p = S.installPrompt;
      S.installPrompt = null;
      if (p) { await p.prompt(); await p.userChoice.catch(() => null); }
      return route(true);
    }
    if (act === 'push-on') { el.disabled = true; await pushOn(); return route(true); }
    if (act === 'push-off') { await pushOff(); return route(true); }
    if (act === 'push-test') { await api('/api/push/test', { method: 'POST' }); toast(t('dev.testSent')); return; }
    if (act === 'tick') { await api('/api/tick', { method: 'POST' }); toast(t('rs.checked')); return route(true); }
    if (act === 'signout') {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
      set('nkg.token', null); set('nkg.seller', null); setSeller(null); S.login = null; location.hash = '#/login'; return route();
    }
    if (act === 'login-back') { S.login = { country: S.login?.country, phone: S.login?.phone }; return views.login(); }
    if (act === 'demo') { el.disabled = true; el.textContent = t('loading'); await loadDemo(); return; }
  } catch (err) {
    toast(err.message);
    if (act === 'restock-go') { el.disabled = false; }
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button:not([type=button])');
  const val = (id) => $(`#${id}`, form)?.value.trim() ?? '';
  if (btn) btn.disabled = true;
  try {
    switch (form.dataset.form) {
      case 'login-phone': {
        S.login = { country: val('l-country'), phone: val('l-phone') };
        const r = await api('/auth/start', { method: 'POST', body: { phone: S.login.phone, country: S.login.country } });
        S.login = { ...S.login, sent: true, devCode: r.devCode };
        return views.login();
      }
      case 'login-code': {
        const r = await api('/auth/verify', { method: 'POST', body: { phone: S.login.phone, country: S.login.country, code: val('l-code') } });
        set('nkg.token', r.token);
        S.login = null;
        location.hash = '#/setup';
        return route();
      }
      case 'member':
        await api(`/api/sellers/${sellerId()}/members`, { method: 'POST', body: { phone: val('m-phone'), role: val('m-role') } });
        toast(t('team.added'));
        return route(true);
      case 'seller': {
        const s = await api('/api/sellers', { method: 'POST', body: { name: val('s-name'), waPhoneNumberId: val('s-phone'), ...shopValues(form) } });
        set('nkg.seller', s.id); setSeller(s);
        location.hash = '#/products';
        return;
      }
      case 'shop': {
        const rateWrap = $('#s-rate-wrap', form);
        const rate = rateWrap && !rateWrap.hidden ? Number(val('s-rate')) : undefined;
        setSeller({ ...S.seller, ...await api(`/api/sellers/${sellerId()}`, { method: 'PATCH', body: { name: val('s-name'), ...shopValues(form), rate, followUps: $('#s-followups', form).checked, stockDisplay: val('s-stock'), lowStockAt: Number(val('s-low')) || 5 } }) });
        toast(rate ? t('set.shopConverted') : t('set.shopSaved'));
      }
        return route(true);
      case 'shoppage':
        setSeller({ ...S.seller, ...await api(`/api/sellers/${sellerId()}`, { method: 'PATCH', body: { slug: val('sp-slug'), waDisplayPhone: val('sp-phone') } }) });
        toast(t('sp.saved'));
        return route(true);
      case 'payments': {
        const provider = val('pay-provider');
        const r = await api(`/api/sellers/${sellerId()}/payments`, { method: 'PUT', body: { provider, secretKey: val('pay-secret') || undefined, webhookSecret: val('pay-hook-secret') || undefined } });
        setSeller({ ...S.seller, ...r });
        toast(provider === 'test' ? t('set.payTest') : t('set.payConnected'));
        await route(true);
        if (provider !== 'test') $('#pay-hook').innerHTML = t('set.webhookUrl', { url: esc(r.webhookUrl) });
        return;
      }
      case 'paymethod': {
        const methods = [...(S.seller.pay_methods ?? []), { label: val('pm-label'), account: val('pm-account'), holder: val('pm-holder'), note: val('pm-note') }];
        setSeller({ ...S.seller, ...await api(`/api/sellers/${sellerId()}/pay-methods`, { method: 'PUT', body: { methods } }) });
        toast(t('dp.saved'));
        return route(true);
      }
      case 'zone':
        await api('/api/delivery-zones', { method: 'POST', body: { sellerId: sellerId(), name: val('z-name'), fee: Number(val('z-fee')), aliases: val('z-aliases').split(',').map((a) => a.trim()).filter(Boolean) } });
        toast(t('dl.added'));
        return route(true);
      case 'product': {
        const p = await api('/api/products', {
          method: 'POST',
          body: { sellerId: sellerId(), name: val('p-name'), variant: val('p-variant'), price: Number(val('p-price')), stock: Number(val('p-stock') || 0), aliases: val('p-aliases').split(',').map((a) => a.trim()).filter(Boolean) },
        });
        const file = $('#p-photo', form)?.files?.[0];
        if (file) { toast(t('ph.saving')); await uploadPhoto(p.id, file).catch((err) => toast(err.message)); }
        toast(t('product.saved'));
        location.hash = `#/product/${p.id}`;
        return;
      }
      case 'edit-product': {
        const r = await api(`/api/products/${form.dataset.id}`, {
          method: 'PATCH',
          body: { stock: Number(val('e-stock')), price: Number(val('e-price')), aliases: val('e-aliases').split(',').map((a) => a.trim()).filter(Boolean) },
        });
        // A price cut with customers waiting for it: offer to tell them, at the top of the page.
        S.priceDrop = r.priceDrop ? { id: form.dataset.id, fromMinor: r.priceDrop.fromMinor } : null;
        toast(t('saved'));
        await route(true);
        if (S.priceDrop) window.scrollTo(0, 0);
        return;
      }
      case 'reply':
        if (!val('reply')) return;
        await api(`/api/chats/${form.dataset.id}/reply`, { method: 'POST', body: { body: val('reply') } });
        $('#reply', form).value = '';
        return route(true);
      case 'as-customer': {
        const [channel, kind] = ($('#tc-channel', form)?.value ?? 'whatsapp').split(':');
        const r = await api('/dev/inbound', { method: 'POST', body: { sellerId: sellerId(), from: val('tc-from'), name: val('tc-name') || undefined, text: val('tc-text'), channel, comment: kind === 'comment' } });
        toast(outcome(r.action));
        return route(true);
      }
      case 'as-this-customer': {
        if (!val('as-cust')) return;
        const r = await api('/dev/inbound', { method: 'POST', body: { sellerId: sellerId(), from: form.dataset.wa, name: form.dataset.name || undefined, text: val('as-cust'), channel: form.dataset.channel } });
        $('#as-cust', form).value = '';
        toast(outcome(r.action));
        return route(true);
      }
    }
  } catch (err) {
    if (form.dataset.form === 'login-phone' || form.dataset.form === 'login-code') { if (btn) btn.disabled = false; return views.login([], err.message); }
    const box = $('.err', form);
    if (box) { box.textContent = err.message; box.hidden = false; } else toast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/** What NKAPGUARD did with a test message, in words. */
const outcome = (action) => { const text = t(`out.${action}`); return text === `out.${action}` ? action : text; };

async function loadDemo() {
  const form = $('form[data-form="seller"]');
  const shop = shopValues(form);
  const fr = shop.language !== 'en';
  const s = await api('/api/sellers', { method: 'POST', body: { name: $('#s-name', form).value.trim() || (fr ? 'Douala Hair Plug' : 'Hair Plug'), waPhoneNumberId: 'demo-' + Date.now(), ...shop } });
  set('nkg.seller', s.id); setSeller(s);
  // Sample prices in the shop's currency: [clip, bonnet, wig]
  const prices = { XAF: [15000, 5000, 85000], XOF: [15000, 5000, 85000], NGN: [18500, 6500, 145000], GHS: [250, 90, 1800], KES: [2500, 900, 18000], ZAR: [350, 120, 2400] }[s.currency] ?? [25, 9, 180];
  const add = (name, variant, price, stock, aliases = []) => api('/api/products', { method: 'POST', body: { sellerId: s.id, name, variant, price, stock, aliases } });
  const both = shop.language === 'fr+en';
  await add('Claw Clip Ponytail', both ? 'Marron / Brown' : fr ? 'Marron' : 'Brown', prices[0], 0, ['ponytail']);
  await add('Claw Clip Ponytail', both ? 'Noir / Black' : fr ? 'Noir' : 'Jet black', prices[0], 6, ['ponytail']);
  await add(fr ? 'Bonnet satin' : 'Satin Bonnet', fr ? 'Bordeaux' : 'Wine', prices[1], 0, fr ? ['bonnet en soie'] : ['silk bonnet']);
  await add(fr ? 'Perruque lisse 20 pouces' : 'Bone Straight Wig 20"', fr ? 'Noir naturel' : 'Natural black', prices[2], 2, fr ? ['perruque'] : ['bone straight']);
  // Sample delivery areas for the country picked, plus free pickup.
  const zoneSets = {
    CM: [['Akwa', 1000], ['Bonamoussadi', 1500, ['bonamou']], ['Bonabéri', 2000]],
    CI: [['Cocody', 1000], ['Yopougon', 1500, ['yop']]], SN: [['Plateau', 1000], ['Almadies', 1500]],
    NG: [['Lekki', 2500], ['Ikeja', 2000], ['Outside Lagos (waybill)', 6000, ['waybill', 'interstate']]],
    GH: [['East Legon', 30], ['Osu', 25]], KE: [['Westlands', 300], ['Kilimani', 250]],
  }[s.country] ?? [['Local delivery', prices[1]], ['Nationwide', prices[1] * 2]];
  for (const [name, fee, aliases = []] of [...zoneSets, fr ? ['Retrait en boutique', 0, ['retrait', 'je passe']] : ['Pickup at the shop', 0, ['pickup', 'pick up', 'collect']]]) {
    await api('/api/delivery-zones', { method: 'POST', body: { sellerId: s.id, name, fee, aliases } });
  }
  const chat = async (name, ...texts) => { const from = samplePhone(); for (const text of texts) await api('/dev/inbound', { method: 'POST', body: { sellerId: s.id, from, name, text } }); };
  if (fr) {
    await chat('Nadège Mballa', 'Bonsoir, vous avez encore la claw clip ponytail marron ?', "Oui d'accord");
    await chat('Brice Nkotto', 'la claw clip ponytail marron est dispo ?', 'oui');
    await chat('Aïcha Bello', 'y a encore la claw clip ponytail marron?', 'ok');
    await chat('Carine Fouda', 'Le bonnet satin bordeaux est disponible ?', 'oui svp');
    await chat('Junior Tchoupo', 'vous avez la claw clip noir ?', 'La livraison à Bonamoussadi c’est combien ?');
    await chat('Paul Eto', 'Il reste la claw clip ponytail marron ?');
  } else {
    await chat('Amaka Obi', 'Hi! Do you have the claw clip ponytail in brown?', 'Yes please');
    await chat('Halima Musa', 'una get the brown claw clip ponytail?', 'yes');
    await chat('Ngozi Eze', 'do you still have the brown claw clip ponytail', 'ok');
    await chat('Blessing Eze', 'Is the wine satin bonnet available?', 'yes o');
    await chat('Tunde Bakare', 'una get the jet black claw clip?', 'How much is delivery?');
    await chat('Chioma Nwosu', 'Do you have the brown claw clip ponytail?');
  }
  toast(t('demo.loaded'));
  location.hash = '#/chats';
}

// ---------- start ----------
// The background worker shows notifications and keeps the app's files for quick opening.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installPrompt = e;
  if (location.hash === '#/settings') route(true);
});
/** Open a chat or Orders from a notification, switching shop first if it came from another one. */
function openFrom(url, shop) {
  if (shop && shop !== sellerId()) { set('nkg.seller', shop); setSeller(null); }
  if (url) location.hash = url.replace(/^#/, '');
  route();
}
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open') openFrom(e.data.url, e.data.sellerId); });
try { S.dryRun = (await api('/health')).dryRun; } catch { /* server down: views will show the error */ }
// Coming back from Instagram or Facebook sign-in: say what happened, then tidy the address.
{
  const q = new URLSearchParams(location.search);
  if (q.get('connected')) setTimeout(() => toast(t('ch.connected', { app: chName[q.get('connected')] ?? q.get('connected') })), 300);
  if (q.get('channel_error')) setTimeout(() => toast(q.get('channel_error')), 300);
  if (q.get('confirm_channel')) S.pickPage = q.get('confirm_channel');
  if (q.get('shop') && q.get('shop') !== sellerId()) { set('nkg.seller', q.get('shop')); }
  if ([...q.keys()].length) history.replaceState(null, '', location.pathname + location.hash);
}
route();
