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
const thumb = (p) => (photoOf(p) ? `<img class="prodicon" src="${esc(photoOf(p))}" alt="" loading="lazy">` : `<span class="prodicon">${initials(p.name)}</span>`);
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
const ICON = {
  chats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/></svg>',
  insights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};
function header(title, { back, sub } = {}) {
  // The language switch is on every screen, sign-in included.
  const toggle = `<div class="langtog" role="group" aria-label="Langue / Language">${['fr', 'en'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${lang() === l}">${l.toUpperCase()}</button>`).join('')}</div>`;
  top.innerHTML = `${back ? `<a class="back" href="${back}" aria-label="${t('back')}">‹</a>` : ''}<h1>${title}${sub ? `<span class="sub">${sub}</span>` : ''}</h1>${toggle}`;
}
function setNav(active, unread = 0) {
  if (!active) { nav.hidden = true; return; }
  nav.hidden = false;
  const item = (k, href, text, extra = '') => `<a href="${href}" class="${active === k ? 'on' : ''}">${ICON[k]}<span>${text}</span>${extra}</a>`;
  nav.innerHTML =
    item('chats', '#/chats', t('nav.chats'), unread ? `<span class="dot">${unread}</span>` : '') +
    item('orders', '#/orders', t('nav.orders')) +
    item('stock', '#/products', t('nav.stock')) + item('insights', '#/insights', t('nav.insights')) + item('settings', '#/settings', t('nav.settings'));
}

// ---------- views ----------
const views = {};

/** Sign in with a WhatsApp number: step 1 asks for the number, step 2 for the code. */
views.login = async (_p, msg) => {
  header(t('app.name'), { sub: t('login.sub') });
  setNav(null);
  const mk = await markets();
  const guess = (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[1] ?? '').toUpperCase();
  const country = S.login?.country ?? (mk.countries.some((c) => c.code === guess) ? guess : 'CM');
  if (S.login?.sent) {
    main.innerHTML = `<form class="form" data-form="login-code">
      <p style="margin:0">${t('login.sent', { phone: esc(S.login.phone) })}</p>
      ${S.login.devCode ? `<div class="banner" style="margin:0">${t('login.testCode', { code: esc(S.login.devCode) })}</div>` : ''}
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <label>${t('login.code')}<input id="l-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required value="${esc(S.login.devCode ?? '')}"></label>
      <button class="btn primary block">${t('login.signIn')}</button>
      <button type="button" class="btn block" data-act="login-back">${t('login.otherNumber')}</button></form>`;
    return;
  }
  main.innerHTML = `<form class="form" data-form="login-phone">
    <p style="margin:0">${t('login.intro')}</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <label>${t('login.country')}<select id="l-country">${countryOptions(mk, country)}</select>
      <span class="hint">${t('login.countryHint')}</span></label>
    <label>${t('login.phone')}<input id="l-phone" type="tel" autocomplete="tel" required value="${esc(S.login?.phone ?? '')}" placeholder="6 77 12 34 56"></label>
    <button class="btn primary block">${t('login.send')}</button></form>`;
};

views.setup = async () => {
  header(t('app.name'), { sub: t('setup.sub') });
  setNav(null);
  const sellers = await api('/api/sellers');
  const [mk, me] = await Promise.all([markets(), api('/api/me')]);
  // Default to the country of the seller's own WhatsApp number, then the browser's.
  const guess = me.user?.country ?? (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[1] ?? '').toUpperCase();
  const def = mk.countries.some((c) => c.code === guess) ? guess : 'CM';
  main.innerHTML = `
    ${sellers.length ? `<div class="sect">${t('setup.choose')}</div>${sellers.map((s) => `<a class="row" href="#/chats" data-pick="${esc(s.id)}">
      <span class="av">${initials(s.name)}</span><span><span class="name"><span class="n">${esc(s.name)}</span></span><span class="last">${esc(countryName(s.country))} · ${esc(s.currency)} · ${langName(s.language)}</span></span><span></span></a>`).join('')}` : ''}
    <div class="sect">${sellers.length ? t('setup.addAnother') : t('setup.add')}</div>
    <form class="form" data-form="seller">
      <label>${t('shop.name')}<input id="s-name" required placeholder="${t('shop.namePh')}"></label>
      ${shopFields(mk, { country: def })}
      <label>${t('shop.phoneId')}<input id="s-phone" required placeholder="${t('shop.phoneIdPh')}" value="${S.dryRun ? 'demo-' + Math.floor(Math.random() * 1e6) : ''}">
        <span class="hint">${t('shop.phoneIdHint')}</span></label>
      <p class="err" hidden></p>
      <button class="btn primary block">${t('shop.addBtn')}</button>
    </form>
    ${S.dryRun && !sellers.length ? `<div class="card"><h2>${t('demo.title')}</h2><p>${t('demo.text')}</p><button class="btn block" data-act="demo">${t('demo.btn')}</button></div>` : ''}`;
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
  const f = (k, t) => `<button class="chip ${S.chatFilter === k ? 'on' : ''}" data-filter="${k}">${t}</button>`;
  main.innerHTML = `
    ${S.dryRun ? testCustomerForm(channels?.accounts.filter((a) => a.enabled)) : ''}
    <div class="chips">${f('all', t('chats.all'))}${f('unread', `${t('chats.unread')}${unread ? ` · ${unread}` : ''}`)}${f('waiting', t('chats.waiting'))}</div>
    ${list.map((c) => {
      const tags = c.waiting_for.map((w) => `<span class="tag">${t('chats.waitingFor', { item: label(w) })}</span>`);
      if (c.awaiting_consent) tags.push(`<span class="tag hold">${t('chats.askedAlert')}</span>`);
      if (c.order_status === 'held') tags.push(`<span class="tag hold">${t('chats.orderHeld')}</span>`);
      if (c.order_status === 'paid') tags.push(`<span class="tag">${t('chats.orderPaid')}</span>`);
      return `<a class="row" href="#/chat/${esc(c.id)}">
        <span class="av">${initials(c.name ?? c.wa_id)}</span>
        <span style="min-width:0"><span class="name"><span class="n">${esc(who(c))}</span>${chip(c.channel)}</span>
          <span class="last">${c.last_direction === 'out' ? t('chats.youPrefix') : ''}${esc(c.last_body ?? '')}</span>
          ${tags.length ? `<span class="tagline">${tags.join('')}</span>` : ''}</span>
        <span class="meta"><span>${when(c.last_at)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</span></a>`;
    }).join('') || `<p class="empty">${chats.length ? t('chats.nothing') : t('chats.empty')}</p>`}`;
};

function testCustomerForm(accounts = []) {
  const opts = [['whatsapp', 'WhatsApp'], ...accounts.map((a) => [a.channel, chName[a.channel]]), ...accounts.map((a) => [`${a.channel}:comment`, t('test.comment', { app: chName[a.channel] })])];
  return `<details class="test"><summary>${t('test.summary')}</summary>
    <form class="form" data-form="as-customer">
      ${accounts.length ? `<label>${t('test.channel')}<select id="tc-channel">${opts.map(([v, text]) => `<option value="${v}">${esc(text)}</option>`).join('')}</select></label>` : ''}
      <label>${t('test.from')}<input id="tc-from" value="${esc(samplePhone())}" required><span class="hint">${t('test.fromHint')}</span></label>
      <label>${t('test.name')}<input id="tc-name" value="${lang() === 'fr' ? 'Nadège Mballa' : 'Amaka Obi'}"></label>
      <label>${t('test.message')}<input id="tc-text" value="${esc(t('test.sampleText'))}" required></label>
      <button class="btn block">${t('test.send')}</button>
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
  main.innerHTML = `
    ${c.channel !== 'whatsapp'
      ? c.window_open
        ? `<div class="banner ok">${t('chat.openOther', { h: hoursLeft, app: app_ })}</div>`
        : `<div class="banner">${t('chat.closedOther', { app: app_ })}</div>`
      : c.window_open
        ? `<div class="banner ok">${t('chat.openWa', { h: hoursLeft })}</div>`
        : `<div class="banner">${t('chat.closedWa')}</div>`}
    ${waitingFor.length || live ? `<div class="pad" style="padding-bottom:0"><span class="tagline">
      ${waitingFor.map((w) => `<span class="tag">${t('chat.waitingTag', { item: label(w), pos: w.position })}</span>`).join('')}
      ${live ? `<span class="tag muted">${t('chat.consentTag', { quote: esc(live.quote), when: when(live.granted_at) })}</span>` : consents.length ? `<span class="tag muted">${t('chat.optedOut')}</span>` : ''}
    </span></div>` : ''}
    <div class="msgs">${messages.map((m) => `<div class="b ${m.direction}">${m.image_url ? `<img class="bimg" src="${esc(m.image_url)}" alt="" loading="lazy">` : ''}${m.kind === 'template' ? `<span class="tpl">${t('chat.template')}${m.cost_usd_micros ? ` · ${fee(m.cost_usd_micros)}` : ''}</span>` : ''}${esc(m.body)}${m.error ? `<span class="fail">${t('chat.notSent', { why: esc(m.error) })}</span>` : ''}<small>${when(m.created_at)}</small></div>`).join('')}</div>
    <form class="composer" data-form="reply" data-id="${esc(id)}">
      <input id="reply" placeholder="${c.window_open ? t('chat.reply') : t('chat.replyOff')}" autocomplete="off" ${c.window_open ? '' : 'disabled'}>
      <button ${c.window_open ? '' : 'disabled'}>${t('chat.send')}</button></form>
    ${S.dryRun ? `<form class="composer test" data-form="as-this-customer" data-wa="${esc(c.wa_id)}" data-name="${esc(c.name ?? '')}" data-channel="${esc(c.channel)}">
      <input id="as-cust" placeholder="${esc(t('test.replyAs', { name: c.name ? c.name.split(' ')[0] : t('test.customer') }))}" autocomplete="off"><button>${t('chat.send')}</button></form>` : ''}`;
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
  const f = (k, text) => `<button class="chip ${S.orderFilter === k ? 'on' : ''}" data-ofilter="${k}">${text}</button>`;
  const pill = (o) => {
    if (o.status === 'held') return `<span class="pill held">${t('ord.held', { left: mins(Math.round((new Date(o.expires_at) - Date.now()) / 6e4)) })}</span>`;
    if (o.status === 'paid') return `<span class="pill paid">${t('ord.paid', { at: when(o.paid_at) })}${o.paid_via === 'manual' ? ` · ${t('ord.byHand')}` : ''}</span>`;
    if (o.status === 'refund_due') return `<span class="pill refund">${t('ord.refund')}</span>`;
    if (o.status === 'cancelled') return `<span class="pill expired">${t('ord.cancelled')}</span>`;
    return `<span class="pill expired">${t('ord.expired')}</span>`;
  };
  const customer = (o) => who({ channel: o.contact_channel, name: o.name, username: o.username, wa_id: o.wa_id });
  main.innerHTML = `
    <p class="note pad" style="margin:0">${t('ord.how')}</p>
    ${!S.dryRun && !S.seller?.payments_connected ? `<div class="banner">${t('ord.manualNote')}</div>` : ''}
    <div class="chips">${f('toPay', `${t('ord.toPay')}${toPay.length ? ` · ${toPay.length}` : ''}`)}${f('paid', t('ord.paidTab'))}${f('all', t('ord.all'))}</div>
    ${shown.map((o) => `<div class="order">
      <div class="order-top"><a href="#/chat/${esc(o.contact_id)}" class="order-who">${esc(customer(o))}</a>${chip(o.contact_channel)}<span class="order-pill">${pill(o)}</span></div>
      <div class="order-what"><b>${o.quantity} × ${label({ name: o.product, variant: o.variant })}</b><span class="num">${money(o.amount_minor)}</span></div>
      <div class="order-when">${when(o.created_at)}${o.delivery_zone ? ` · ${t('ord.delivery', { zone: esc(o.delivery_zone), fee: o.delivery_fee_minor > 0 ? money(o.delivery_fee_minor) : t('dl.free') })}` : ''}</div>
      ${['held', 'expired'].includes(o.status) ? `<div class="btns"><button class="btn sm" data-order-paid="${esc(o.id)}" data-name="${esc(customer(o))}">${t('ord.markPaid')}</button><button class="btn sm" data-order-cancel="${esc(o.id)}">${t('ord.cancel')}</button></div>` : ''}
    </div>`).join('')
      || `<p class="empty">${list.length ? t('ord.nothing') : t('ord.empty')}</p>`}`;
};

views.products = async () => {
  const products = await api(`/api/products?sellerId=${sellerId()}`);
  header(t('stock.title'), { sub: t('stock.peopleWaiting', { n: products.reduce((a, p) => a + p.waiting, 0) }) });
  setNav('stock');
  const row = (p) => `<a class="row" href="#/product/${esc(p.id)}">${thumb(p)}
    <span style="min-width:0"><span class="name"><span class="n">${esc(p.name)}</span></span><span class="last">${esc(variantText(p.variant) || t('stock.noVariant'))} · ${t('stock.inStockN', { n: p.stock })} · ${money(p.price_minor)}</span></span>
    <span class="r"><b>${p.waiting}</b>${t('stock.waitingLabel')}</span></a>`;
  const out = products.filter((p) => p.stock === 0);
  const inStock = products.filter((p) => p.stock > 0);
  main.innerHTML = `<div class="pad"><a class="btn block" href="#/products/new">${t('stock.add')}</a></div>
    ${out.length ? `<div class="sect">${t('stock.soldOut')}</div>${out.map(row).join('')}` : ''}
    ${inStock.length ? `<div class="sect">${t('stock.inStock')}</div>${inStock.map(row).join('')}` : ''}
    ${products.length ? '' : `<p class="empty">${t('stock.empty')}</p>`}`;
};

views.newProduct = async () => {
  header(t('product.addTitle'), { back: '#/products' });
  setNav('stock');
  const both = S.seller.language === 'fr+en';
  main.innerHTML = `<form class="form" data-form="product">
    <label>${t('product.name')}<input id="p-name" required placeholder="${esc(t('product.namePh'))}"></label>
    <label>${t('product.variant')}<input id="p-variant" placeholder="${both ? t('product.variantPhBoth') : shopLang() === 'fr' ? 'Marron' : 'Brown'}"><span class="hint">${t('product.variantHint')}${both ? t('product.variantHintBoth') : ''}</span></label>
    <label>${t('product.price', { cur: esc(S.seller.currency) })}<input id="p-price" type="number" min="0" step="any" required></label>
    <label>${t('product.stockNow')}<input id="p-stock" type="number" min="0" step="1" value="0"></label>
    <label>${t('product.aliases')}<input id="p-aliases" placeholder="${esc(t('product.aliasesPh'))}"><span class="hint">${t('product.aliasesHint')}</span></label>
    <label>${t('ph.title')}<input id="p-photo" type="file" accept="image/*"><span class="hint">${t('ph.optional')}</span></label>
    <p class="err" id="p-err" hidden></p>
    <button class="btn primary block">${t('product.save')}</button></form>`;
};

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
      ${pic ? `<img src="${esc(pic)}" alt="">` : `<span class="prodicon big">${initials(p.name)}</span>`}
      <div><p class="note" style="margin:0 0 8px">${t('ph.why')}</p>
        <div class="btns" style="margin:0"><label class="btn sm">${pic ? t('ph.change') : t('ph.add')}<input type="file" accept="image/*" data-photo="${esc(p.id)}" hidden></label>
        ${pic ? `<button class="btn sm" data-photo-remove="${esc(p.id)}">${t('ph.remove')}</button>` : ''}</div></div>
    </div>
    <div class="kv"><div><span>${t('product.inStock')}</span><b>${p.stock}</b></div><div><span>${t('product.waiting')}</span><b>${p.waiting}</b></div><div><span>${t('product.bought')}</span><b>${bought === null ? t('none') : pct(bought)}</b></div></div>
    ${running ? `<div class="banner">${t('product.running', { href: `#/restock/${esc(running.id)}` })}</div>` : ''}
    ${S.priceDrop?.id === id && drop?.watchers ? `<div class="card"><h2>${t('pd.title')}</h2>
      <p>${t('pd.text', { n: drop.watchers, to: money(p.price_minor), from: money(S.priceDrop.fromMinor) })}</p>
      <div class="cost"><span class="tot">${t('restock.feesTotal')}</span><b class="tot num">${fee(drop.costUsdMicros)}</b></div>
      <div class="btns"><button class="btn primary" data-act="price-drop">${t('pd.send', { n: drop.watchers })}</button><button class="btn" data-act="price-drop-later">${t('pd.later')}</button></div></div>`
      : drop?.watchers ? `<p class="note pad" style="margin:0">${t('pd.waiting', { n: drop.watchers })}</p>` : ''}
    <div class="card"><h2>${p.waiting ? t('restock.logTitle') : t('restock.addStock')}</h2>
      <div class="field"><label>${t('restock.units')}</label>${stepper('units')}</div>
      ${p.waiting ? `<div class="field"><div class="seg"><button type="button" data-mode="hold" class="${f.mode === 'hold' ? 'on' : ''}">${t('restock.hold')}</button><button type="button" data-mode="race" class="${f.mode === 'race' ? 'on' : ''}">${t('restock.race')}</button></div></div>
      ${f.mode === 'hold'
        ? `<div class="field"><label>${t('restock.holdLength')}</label><div class="seg" style="width:auto;min-width:220px">${[60, 120, 240, 1440].map((m) => `<button type="button" data-hold="${m}" class="${f.holdMinutes === m ? 'on' : ''}">${mins(m)}</button>`).join('')}</div></div>`
        : `<div class="field"><label>${t('restock.perUnit')}<span class="hint">${t('restock.perUnitHint')}</span></label>${stepper('perUnit')}</div>`}` : ''}
      <div id="plan"><p class="note">${t('restock.working')}</p></div>
    </div>
    ${waitlist.length ? `<div class="sect">${t('waitlist.title')}</div>${waitlist.map((w) => `<div class="line"><span class="pos">#${w.position}</span>
      <span>${esc(w.name ?? phone(w.wa_id))}<span class="q">${q(esc(w.consent_quote))} · ${t('waitlist.since', { when: when(w.joined_at) })}</span></span><span class="ch whatsapp"><i></i>WhatsApp</span></div>`).join('')}` : ''}
    <div class="sect">${t('edit.title')}</div>
    <form class="form" data-form="edit-product" data-id="${esc(id)}" style="padding-top:4px">
      <label>${t('edit.stock')}<input id="e-stock" type="number" min="0" step="1" value="${p.stock}"><span class="hint">${t('edit.stockHint')}</span></label>
      <label>${t('product.price', { cur: esc(S.seller.currency) })}<input id="e-price" type="number" min="0" step="any" value="${toMajor(p.price_minor)}"></label>
      <label>${t('product.aliases')}<input id="e-aliases" value="${esc(p.aliases.join(', '))}"></label>
      <button class="btn block">${t('edit.save')}</button></form>
    ${restocks.length ? `<div class="sect">${t('past.title')}</div>${restocks.map((r) => `<a class="line" href="#/restock/${esc(r.id)}" style="text-decoration:none;color:inherit"><span class="pos">${r.units}×</span>
      <span>${when(r.created_at)} · ${r.mode === 'hold' ? t('past.holds') : t('past.race')}<span class="q">${t('past.counts', { sold: r.sold, messaged: r.messaged })}</span></span>${r.closed_at ? `<span class="pill expired">${t('past.done')}</span>` : `<span class="pill held">${t('past.running')}</span>`}</a>`).join('')}` : ''}`;
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
      ${pv.toMessage ? `<p class="hint" style="margin:12px 0 6px">${t('restock.previewLabel')}</p><div class="preview">${esc(pv.preview)}</div>
      <p class="note">${t('restock.previewNote')}</p>
      <div class="cost" style="margin-top:12px"><span>${t('restock.alerts', { n: pv.toMessage })}</span><b class="num">${fee(pv.costUsdMicros.alerts)}</b>
        ${pv.soldOutNotes ? `<span>${t('restock.soldOutNotes', { n: pv.soldOutNotes })}</span><b class="num">${fee(pv.costUsdMicros.soldOutNotes)}</b>` : f.mode === 'hold' ? `<span>${t('restock.reoffer')}</span><b class="num">${fee(pv.perMessageUsdMicros.marketing)}</b>` : ''}
        <span class="tot">${t('restock.feesTotal')}</span><b class="tot num">${fee(pv.costUsdMicros.total)}</b></div>
      ${S.seller?.currency !== 'USD' ? `<p class="note">${t('restock.feesNote', { usd: usd(pv.costUsdMicros.total) })}</p>` : ''}` : ''}
      <div class="btns">${S.confirm
        ? `<button class="btn primary" data-act="restock-go">${t('restock.confirm', { n: pv.toMessage })}</button><button class="btn" data-act="restock-cancel">${t('restock.cancel')}</button>`
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
    if (o.status === 'held') return `<span class="pill held">${t('rs.held', { left: mins(Math.round((new Date(o.expires_at) - Date.now()) / 6e4)) })}</span>`;
    if (o.status === 'paid') return `<span class="pill paid">${t('rs.paid', { at: clock(o.paid_at) })}</span>`;
    if (o.status === 'expired') return `<span class="pill expired">${t('rs.holdEnded')}</span>`;
    if (o.status === 'missed') return `<span class="pill missed">${t('rs.soldOutNote')}</span>`;
    return `<span class="pill notified">${t('rs.messaged')}</span>`;
  };
  main.innerHTML = `
    <div class="units">${slots.map((s, k) => `<span class="${s}">${s === 'sold' ? t('rs.sold') : s === 'held' ? t('rs.heldSlot') : t('rs.unit', { n: k + 1 })}</span>`).join('')}${r.units > 12 ? `<span>+${r.units - 12}</span>` : ''}</div>
    <div class="stats"><div><span>${t('rs.sold')}</span><b class="num">${t('rs.soldOf', { sold, units: r.units })}</b></div><div><span>${t('rs.messagedCount')}</span><b class="num">${offers.length}</b></div><div><span>${t('rs.sales')}</span><b class="num">${money(sold * p.price_minor)}</b></div></div>
    ${r.closed_at ? `<div class="banner ok">${t('rs.doneBanner', { sold, left: r.units - sold })}</div>` : ''}
    <div class="sect">${t('rs.who')}</div>
    ${offers.map((o) => `<div class="line"><span class="pos">${clock(o.sent_at)}</span><span>${esc(o.name ?? phone(o.wa_id))}<span class="q">${phone(o.wa_id)}</span></span>
      <span style="display:grid;gap:4px;justify-items:end">${pill(o)}${S.dryRun && ['held', 'notified'].includes(o.status) ? `<button class="btn sm" data-pay="${esc(o.payment_ref)}">${t('rs.testPaid')}</button>` : ''}</span></div>`).join('') || `<p class="empty">${t('rs.nobody')}</p>`}
    ${!r.closed_at && r.mode === 'hold' ? `<p class="note pad">${t('rs.holdsNote')}${S.dryRun ? ` <button class="btn sm" data-act="tick">${t('rs.testTick')}</button>` : ''}</p>` : ''}`;
};

views.insights = async () => {
  const [ins, consents] = await Promise.all([api(`/api/insights?sellerId=${sellerId()}`), api(`/api/consents?sellerId=${sellerId()}`)]);
  const month = new Date(ins.monthStart).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
  header(t('ins.title'), { sub: month.charAt(0).toUpperCase() + month.slice(1) });
  setNav('insights');
  const demand = ins.demand.filter((d) => d.waiting > 0);
  const q = (text) => (lang() === 'fr' ? `« ${text} »` : `“${text}”`);
  main.innerHTML = `
    <div class="tiles">
      <div><span>${t('ins.chatSales')}</span><b class="num">${money(ins.chatSales?.revenue_minor ?? 0)}</b></div>
      <div><span>${t('ins.chatOrders')}</span><b class="num">${ins.chatSales?.orders ?? 0}</b></div>
      <div><span>${t('ins.sales')}</span><b class="num">${money(ins.sales.revenue_minor)}</b></div>
      <div><span>${t('ins.orders')}</span><b class="num">${ins.sales.orders}</b></div>
      <div><span>${t('ins.followUps')}</span><b class="num">${ins.followUps?.sent ?? 0}</b></div>
      <div><span>${t('ins.followUpOrders')}</span><b class="num">${ins.followUps?.ordered ?? 0}</b></div>
      <div><span>${t('ins.messages')}</span><b class="num">${ins.spend.messages}</b></div>
      <div><span>${t('ins.fees')}</span><b class="num">${fee(ins.spend.cost_usd_micros)}</b></div>
    </div>
    ${S.seller?.currency !== 'USD' && ins.spend.cost_usd_micros ? `<p class="note pad" style="margin:0;padding-top:0">${t('ins.feesNote', { usd: usd(ins.spend.cost_usd_micros) })}</p>` : ''}
    ${ins.refunds.length ? `<div class="sect">${t('ins.refunds')}</div>${ins.refunds.map((r) => `<div class="line"><span class="pos">↩</span><span>${esc(r.name ?? phone(r.wa_id))} · ${money(r.price_minor)}<span class="q">${label({ name: r.product, variant: r.variant })} · ${t('ins.ref', { ref: esc(r.payment_ref) })}</span></span><span class="pill refund">${t('ins.refundDue')}</span></div>`).join('')}` : ''}
    <div class="sect">${t('ins.reorder')}</div>
    ${demand.length ? `<div class="tablewrap"><table><thead><tr><th>${t('ins.item')}</th><th>${t('ins.waiting')}</th><th>${t('ins.bought')}</th><th>${t('ins.suggest')}</th></tr></thead><tbody>
      ${demand.map((d) => `<tr><td>${esc(d.name)}<span>${esc(variantText(d.variant))}</span></td><td class="num">${d.waiting}</td><td class="num">${d.bought_pct === null ? t('none') : pct(d.bought_pct)}</td>
        <td class="num"><b>${d.bought_pct === null ? t('none') : Math.max(1, Math.round((d.waiting * d.bought_pct) / 100))}</b></td></tr>`).join('')}
    </tbody></table></div><p class="note pad" style="margin:0">${t('ins.reorderNote')}</p>`
      : `<p class="empty">${t('ins.noWaitlist')}</p>`}
    <div class="sect">${t('ins.consents')}</div>
    ${consents.map((k) => `<div class="line"><span class="pos">${k.revoked_at ? '✕' : '✓'}</span><span>${esc(k.name ?? phone(k.wa_id))}<span class="q">${t(`purpose.${k.purpose}`) === `purpose.${k.purpose}` ? '' : `${t(`purpose.${k.purpose}`)} · `}${q(esc(k.quote))} · ${label({ name: k.product ?? '', variant: k.variant ?? '' })} · ${when(k.granted_at)}</span></span>${k.revoked_at ? `<span class="pill expired">${t('ins.optedOut')}</span>` : chip(k.channel)}</div>`).join('') || `<p class="empty">${t('ins.noConsents')}</p>`}`;
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
  const chRow = (ch, title, note, on) => `<div class="line"><span class="pos"><span class="ch ${ch}" style="padding:4px"><i></i></span></span><span>${title}<span class="q">${note}</span></span>${connected(on)}</div>`;
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
  const team = `<div class="sect">${t('team.title')}</div>
    ${members.map((mb) => `<div class="line"><span class="pos">${mb.role === 'owner' ? '★' : '·'}</span>
      <span>${me.user?.id === mb.user_id ? t('you') : esc(mb.name ?? '+' + mb.wa_id)}<span class="q">${mb.name || me.user?.id === mb.user_id ? `+${esc(mb.wa_id)} · ` : ''}${mb.role === 'owner' ? t('team.owner') : t('team.staff')}</span></span>
      ${owner && me.user?.id !== mb.user_id ? `<button class="btn sm" data-remove-member="${esc(mb.user_id)}">${t('team.remove')}</button>` : '<span></span>'}</div>`).join('')}
    ${owner ? `<form class="form" data-form="member">
      <label>${t('team.add')}<input id="m-phone" type="tel" required placeholder="${esc(samplePhone())}"><span class="hint">${t('team.addHint', { country: esc(countryName(s.country, m?.name)) })}</span></label>
      <label>${t('team.role')}<select id="m-role"><option value="staff">${t('team.staff')}</option><option value="owner">${t('team.ownerOpt')}</option></select></label>
      <p class="err" hidden></p>
      <button class="btn block">${t('team.addBtn')}</button></form>` : ''}`;
  main.innerHTML = `
    ${S.dryRun ? `<div class="banner">${t('set.testBanner')}</div>` : ''}
    ${owner ? '' : `<div class="banner">${t('set.staffBanner')}</div>`}
    ${await deviceSection()}
    ${shopPage(s, owner)}
    <div class="sect"${owner ? '' : ' hidden'}>${t('set.getPaid')}</div>
    <form class="form" data-form="payments" style="padding-top:4px"${owner ? '' : ' hidden'}>
      <label>${t('set.provider')}<select id="pay-provider" data-provider>${order.map((k) => `<option value="${k}" ${k === s.payment_provider ? 'selected' : ''}>${esc(t(`pv.${k}`))}${suggested.includes(k) ? ` · ${t('set.suggested')}` : ''}</option>`).join('')}</select>
        <span class="hint">${t('set.providerHint')}</span></label>
      <div id="pay-keys">${payKeyFields(mk, s.payment_provider)}</div>
      <p class="note" id="pay-hook">${s.payment_provider !== 'test' && s.payments_connected ? t('set.webhookUrl', { url: `${esc(API || location.origin)}/webhooks/payments/${esc(s.id)}` }) : ''}</p>
      <p class="err" hidden></p>
      <button class="btn block">${t('set.savePay')}</button>
    </form>
    <div class="sect"${owner ? '' : ' hidden'}>${t('set.shop')}</div>
    <form class="form" data-form="shop" style="padding-top:4px"${owner ? '' : ' hidden'}>
      <label>${t('shop.name')}<input id="s-name" value="${esc(s.name)}" required></label>
      ${shopFields(mk, s)}
      <label class="check"><input type="checkbox" id="s-followups" ${s.follow_ups !== false ? 'checked' : ''}><span>${t('fu.label')}<span class="hint">${t('fu.hint')}</span></span></label>
      <label id="s-rate-wrap" data-from="${esc(s.currency)}" hidden><span id="s-rate-label">${t('rate.title')}</span><input id="s-rate" type="number" min="0" step="any"><span class="hint" id="s-rate-hint"></span></label>
      <p class="err" hidden></p>
      <button class="btn block">${t('set.saveShop')}</button>
    </form>
    ${owner ? await deliverySection(s) : ''}
    ${team}
    <div class="sect">${t('ch.title')}</div>
    ${S.dryRun
      ? `<div class="line"><span class="pos"><span class="ch whatsapp" style="padding:4px"><i></i></span></span><span>WhatsApp<span class="q">${t('ch.testWa')}</span></span><span class="pill held">${t('ch.testPill')}</span></div>`
      : chRow('whatsapp', 'WhatsApp', t('ch.numberId', { id: esc(s.wa_phone_number_id) }), true)}
    <p class="note pad" style="padding-top:0">${t('ch.waNote')}</p>
    ${pagePicker?.length ? `<div class="card"><h2>${t('ch.whichPage')}</h2><p>${t('ch.whichPageText')}</p>
      <div class="btns">${pagePicker.map((p) => `<button class="btn" data-act="pick-page" data-page="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    ${['instagram', 'facebook'].map((ch) => channelCard(ch, channels, s, owner)).join('')}
    <div class="line"><span class="pos"><span class="ch tiktok" style="padding:4px"><i></i></span></span><span>TikTok<span class="q">${t('ch.tiktok')}</span></span>${s.slug ? `<button class="btn sm" data-act="copy-shop">${t('ch.copyLink')}</button>` : '<span></span>'}</div>
    <div class="pad btns" style="margin:0"><a class="btn" href="#/setup">${t('set.switchShop')}</a><button class="btn danger" data-act="signout">${t('set.signOut')}</button></div>`;
};
/** Delivery areas and fees (owner only). */
async function deliverySection(s) {
  const zones = await api(`/api/delivery-zones?sellerId=${s.id}`);
  const fee = (z) => (z.fee_minor > 0 ? money(z.fee_minor) : t('dl.free'));
  return `<div class="sect">${t('dl.title')}</div>
    <p class="note pad" style="margin:0">${t('dl.intro')}</p>
    ${zones.map((z) => `<div class="line"><span class="pos">⌂</span><span>${esc(z.name)}<span class="q">${fee(z)}${z.aliases.length ? ` · ${esc(z.aliases.join(', '))}` : ''}</span></span><button class="btn sm" data-zone-remove="${esc(z.id)}">${t('dl.remove')}</button></div>`).join('')
      || `<p class="note pad" style="margin:0;padding-top:0">${t('dl.none')}</p>`}
    <form class="form" data-form="zone">
      <label>${t('dl.name')}<input id="z-name" required maxlength="60" placeholder="${esc(t('dl.namePh'))}"></label>
      <label>${t('dl.fee', { cur: esc(s.currency) })}<input id="z-fee" type="number" min="0" step="any" required></label>
      <label>${t('dl.aliases')}<input id="z-aliases"><span class="hint">${t('product.aliasesHint')}</span></label>
      <p class="err" hidden></p>
      <button class="btn block">${t('dl.add')}</button></form>`;
}

// ---------- this phone: install and notifications ----------
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
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
  const installHint = standalone() || S.installPrompt ? '' : ` ${isIos() ? t('dev.installIos') : t('dev.installOther')}`;
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
  return `<div class="sect">${t('dev.title')}</div>
    <div class="line"><span class="pos">⤓</span><span>${t('dev.install')}<span class="q">${t('dev.installWhat')}${installHint}</span></span>${install}</div>
    <div class="line"><span class="pos">🔔</span><span>${t('dev.notif')}<span class="q">${notif}</span></span>${action}</div>
    ${S.pushOn ? `<div class="pad btns" style="margin:0;padding-top:0"><button class="btn sm" data-act="push-test">${t('dev.test')}</button><button class="btn sm" data-act="push-off">${t('dev.turnOff')}</button></div>` : ''}`;
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
  const icon = `<span class="pos"><span class="ch ${ch}" style="padding:4px"><i></i></span></span>`;
  if (!a) {
    const what = ch === 'instagram' ? t('ch.igWhat') : t('ch.fbWhat');
    const action = !owner ? '<span></span>'
      : channels.available[ch] ? `<button class="btn sm" data-act="ch-connect" data-ch="${ch}">${t('ch.connect')}</button>`
      : S.dryRun ? `<button class="btn sm" data-act="ch-sample" data-ch="${ch}">${t('ch.sample')}</button>`
      : `<span class="pill expired">${t('ch.notSetUp')}</span>`;
    return `<div class="line">${icon}<span>${title}<span class="q">${what}${!channels.available[ch] && !S.dryRun ? t('ch.serverNeeds', { what: ch === 'instagram' ? 'IG_APP_ID + IG_APP_SECRET' : 'META_APP_ID' }) : ''}</span></span>${action}</div>`;
  }
  const handle = a.username ? '@' + a.username : a.name ?? '';
  return `<div class="line">${icon}<span>${title}${handle ? ` · ${esc(handle)}` : ''}
      <span class="q">${a.enabled ? t('ch.answering') : t('ch.paused')}${a.comment_replies ? t('ch.commentsOn') : ''}${!s.wa_display_phone ? t('ch.needWa') : ''}</span></span>
      <span class="pill ${a.enabled ? 'paid' : 'held'}">${a.enabled ? t('ch.on') : t('ch.pausedPill')}</span></div>
    ${owner ? `<div class="pad btns" style="margin:0;padding-top:0">
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
  return `<div class="sect">${t('sp.title')}</div>
    <div class="card">
      ${ready
        ? `<p>${t('sp.ready')}</p>
           <p><a href="${esc(shopUrl(s))}" target="_blank" rel="noopener"><code>${esc(shopUrl(s))}</code></a></p>
           ${qr}
           <div class="btns"><button type="button" class="btn sm" data-act="copy-shop">${t('sp.copy')}</button>${qr ? `<button type="button" class="btn sm" data-act="qr-download">${t('sp.qr')}</button>` : ''}</div>`
        : `<p>${t('sp.notReady')}</p>`}
    </div>
    ${owner ? `<form class="form" data-form="shoppage">
      <label>${t('sp.phone')}<input id="sp-phone" type="tel" value="${s.wa_display_phone ? '+' + esc(s.wa_display_phone) : ''}" placeholder="${esc(samplePhone())}"><span class="hint">${t('sp.phoneHint')}</span></label>
      <label>${t('sp.slug')}<input id="sp-slug" value="${esc(s.slug ?? '')}" placeholder="${lang() === 'fr' ? 'ma-boutique' : 'my-shop'}"><span class="hint">${t('sp.slugHint')}</span></label>
      <p class="err" hidden></p>
      <button class="btn block">${t('sp.save')}</button></form>` : ''}`;
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
    await views[name](m.slice(1));
    main.dataset.view = key;
    if (!quiet) { if (name !== 'chat') window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  } catch (e) {
    if (e.status === 401) { set('nkg.token', null); set('nkg.seller', null); setSeller(null); S.login = null; await views.login([], t('signInAgain')); return; }
    if (e.status === 404 && name !== 'setup' && sellerId() && !S.seller) { set('nkg.seller', null); location.hash = '#/setup'; return; }
    if (!quiet) main.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
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
  const el = e.target.closest('[data-photo-remove],[data-zone-remove],[data-pick],[data-filter],[data-ofilter],[data-order-paid],[data-order-cancel],[data-cfg],[data-mode],[data-hold],[data-act],[data-pay],[data-remove-member]');
  if (!el) return;
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
    if (!confirm(t('ord.markPaidAsk', { name: el.dataset.name }))) return;
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
        setSeller({ ...S.seller, ...await api(`/api/sellers/${sellerId()}`, { method: 'PATCH', body: { name: val('s-name'), ...shopValues(form), rate, followUps: $('#s-followups', form).checked } }) });
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
