// Oja seller app. Plain JavaScript modules, no build step; talks to the /api routes.

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
const top = $('#top');
const nav = $('#nav');
let TZ = 'UTC';

// ---------- small helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const exponent = (cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
const toMajor = (minor) => (minor ?? 0) / 10 ** exponent(S.seller?.currency ?? 'USD');
const LANG_NAMES = { en: 'English', fr: 'French', 'fr+en': 'French and English (both in every message)' };
/** The first language of the shop, used for names, prices and times in the app. */
const baseLang = () => ((S.seller?.language ?? 'en').startsWith('fr') ? 'fr' : 'en');
/** A price in the shop's currency and language: "15 000 FCFA", "FCFA 15,000", "₦18,500". */
function money(minor) {
  const cur = S.seller?.currency ?? 'USD';
  const major = toMajor(minor);
  const opts = { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(major) ? 0 : undefined };
  try { return new Intl.NumberFormat(`${baseLang()}-${S.seller?.country ?? 'US'}`, opts).format(major); }
  catch { return new Intl.NumberFormat('en', opts).format(major); }
}
/** Meta fees are billed in USD. */
const usd = (micros) => { const v = (micros ?? 0) / 1e6; return '$' + v.toFixed(v !== 0 && v < 1 ? 4 : 2); };
const initials = (name) => esc((name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
const phone = (wa) => (wa ? '+' + esc(wa) : '');
const chName = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
const chip = (ch) => `<span class="ch ${esc(ch)}"><i></i>${chName[ch] ?? esc(ch)}</span>`;
/** "Brown Claw Clip" in English, "Claw Clip marron" in French, following the shop's language. */
const variantFor = (v) => { const [a, b] = (v ?? '').split('/').map((x) => x.trim()); return baseLang() === 'fr' ? a : (b || a); };
const label = (p) => esc(baseLang() === 'fr' ? [p.name, (variantFor(p.variant) ?? '').toLowerCase()].filter(Boolean).join(' ') : [variantFor(p.variant), p.name].filter(Boolean).join(' '));
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString('en-GB', { timeZone: TZ }) === new Date().toLocaleDateString('en-GB', { timeZone: TZ });
  if (sameDay) return d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toUpperCase();
  if (Date.now() - d.getTime() < 6 * 864e5) return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
}
const clock = (iso) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toUpperCase();
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.max(0, m)}m`);

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
  const headers = { 'Content-Type': 'application/json' };
  const token = get('oja.token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`);
  return data;
}

// ---------- app state ----------
const S = { dryRun: false, seller: null, markets: null, chatFilter: 'all', restockForm: null, confirm: false };
const setSeller = (s) => { S.seller = s; TZ = s?.timezone ?? 'UTC'; };
async function markets() { return (S.markets ??= await api('/markets')); }
const sellerId = () => get('oja.seller');

// ---------- chrome ----------
const ICON = {
  chats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/></svg>',
  insights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};
function header(title, { back, sub } = {}) {
  top.innerHTML = `${back ? `<a class="back" href="${back}" aria-label="Back">‹</a>` : ''}<h1>${title}${sub ? `<span class="sub">${sub}</span>` : ''}</h1>`;
}
function setNav(active, unread = 0) {
  if (!active) { nav.hidden = true; return; }
  nav.hidden = false;
  const item = (k, href, text, extra = '') => `<a href="${href}" class="${active === k ? 'on' : ''}">${ICON[k]}<span>${text}</span>${extra}</a>`;
  nav.innerHTML =
    item('chats', '#/chats', 'Chats', unread ? `<span class="dot">${unread}</span>` : '') +
    item('stock', '#/products', 'Stock') + item('insights', '#/insights', 'Insights') + item('settings', '#/settings', 'Settings');
}

// ---------- views ----------
const views = {};

/** Sign in with a WhatsApp number: step 1 asks for the number, step 2 for the code. */
views.login = async (_p, msg) => {
  header('Oja', { sub: 'Sign in with WhatsApp' });
  setNav(null);
  const mk = await markets();
  const guess = (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[1] ?? '').toUpperCase();
  const country = S.login?.country ?? (mk.countries.some((c) => c.code === guess) ? guess : 'CM');
  if (S.login?.sent) {
    main.innerHTML = `<form class="form" data-form="login-code">
      <p style="margin:0">We sent a 6-digit code to <b>${esc(S.login.phone)}</b> on WhatsApp.</p>
      ${S.login.devCode ? `<div class="banner" style="margin:0"><b>Test mode.</b> Nothing is sent, so here is your code: <b>${esc(S.login.devCode)}</b></div>` : ''}
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <label>Code<input id="l-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required value="${esc(S.login.devCode ?? '')}"></label>
      <button class="btn primary block">Sign in</button>
      <button type="button" class="btn block" data-act="login-back">Use a different number</button></form>`;
    return;
  }
  main.innerHTML = `<form class="form" data-form="login-phone">
    <p style="margin:0">Enter your WhatsApp number. We'll send you a code to sign in. No password needed.</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <label>Country<select id="l-country">${mk.countries.map((c) => `<option value="${c.code}" ${c.code === country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <span class="hint">Only used to read a local number. International numbers with + work from anywhere.</span></label>
    <label>WhatsApp number<input id="l-phone" type="tel" autocomplete="tel" required value="${esc(S.login?.phone ?? '')}" placeholder="6 77 12 34 56"></label>
    <button class="btn primary block">Send code</button></form>`;
};

views.setup = async () => {
  header('Oja', { sub: 'Your shops' });
  setNav(null);
  const sellers = await api('/api/sellers');
  const mk = await markets();
  const guess = (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[1] ?? '').toUpperCase();
  const def = mk.countries.some((c) => c.code === guess) ? guess : 'CM';
  main.innerHTML = `
    ${sellers.length ? `<div class="sect">Choose a shop</div>${sellers.map((s) => `<a class="row" href="#/chats" data-pick="${esc(s.id)}">
      <span class="av">${initials(s.name)}</span><span><span class="name"><span class="n">${esc(s.name)}</span></span><span class="last">${esc(s.country)} · ${esc(s.currency)} · ${LANG_NAMES[s.language] ?? s.language}</span></span><span></span></a>`).join('')}` : ''}
    <div class="sect">${sellers.length ? 'Or add another shop' : 'Add your shop'}</div>
    <form class="form" data-form="seller">
      <label>Shop name<input id="s-name" required placeholder="Douala Hair Plug"></label>
      ${shopFields(mk, { country: def })}
      <label>WhatsApp phone number id<input id="s-phone" required placeholder="From Meta: WhatsApp › API setup" value="${S.dryRun ? 'demo-' + Math.floor(Math.random() * 1e6) : ''}">
        <span class="hint">The id Meta gives your WhatsApp number, not the phone number itself.</span></label>
      <p class="err" hidden></p>
      <button class="btn primary block">Add shop</button>
    </form>
    ${S.dryRun && !sellers.length ? `<div class="card"><h2>Just looking around?</h2><p>Load a sample hair shop in the country you picked, with products and a few customer chats. Nothing is sent in test mode.</p><button class="btn block" data-act="demo">Load sample shop</button></div>` : ''}`;
};

/** Country, language, currency and time zone. Picking a country fills in the rest. */
function shopFields(mk, cur) {
  const m = mk.countries.find((c) => c.code === cur.country);
  const known = mk.countries.map((c) => `<option value="${c.code}" ${c.code === cur.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const other = m ? '' : `<option value="${esc(cur.country)}" selected>${esc(cur.country)}</option>`;
  return `<label>Country<select id="s-country" data-country>${known}${other}<option value="__other">Another country…</option></select></label>
    <label id="s-other-wrap" hidden>Country code<input id="s-other" maxlength="2" placeholder="Two letters, like PH"></label>
    <label>Talk to customers in<select id="s-lang">${mk.languages.map((l) => `<option value="${l}" ${l === (cur.language ?? m?.language) ? 'selected' : ''}>${LANG_NAMES[l] ?? l}</option>`).join('')}</select></label>
    <label>Currency<input id="s-currency" maxlength="3" value="${esc(cur.currency ?? m?.currency ?? '')}" required><span class="hint">Three letters, like XAF, NGN or USD.</span></label>
    <label>Time zone<input id="s-tz" value="${esc(cur.timezone ?? m?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><span class="hint">Like Africa/Douala. Hold deadlines are shown in this time.</span></label>`;
}
function shopValues(form) {
  const v = (id) => $(`#${id}`, form).value.trim();
  const country = v('s-country') === '__other' ? v('s-other').toUpperCase() : v('s-country');
  return { country, language: v('s-lang'), currency: v('s-currency').toUpperCase(), timezone: v('s-tz') };
}
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-country]')) return;
  const form = e.target.closest('form');
  const other = e.target.value === '__other';
  $('#s-other-wrap', form).hidden = !other;
  const m = (await markets()).countries.find((c) => c.code === e.target.value);
  if (m) { $('#s-currency', form).value = m.currency; $('#s-tz', form).value = m.timezone; $('#s-lang', form).value = m.language; }
  if (other) { $('#s-currency', form).value = ''; $('#s-other', form).focus(); }
});

views.chats = async () => {
  const chats = await api(`/api/chats?sellerId=${sellerId()}`);
  const unread = chats.reduce((a, c) => a + (c.unread > 0 ? 1 : 0), 0);
  header('Chats', { sub: esc(S.seller?.name ?? '') });
  setNav('chats', unread);
  const list = S.chatFilter === 'unread' ? chats.filter((c) => c.unread > 0) : S.chatFilter === 'waiting' ? chats.filter((c) => c.waiting_for.length) : chats;
  const f = (k, t) => `<button class="chip ${S.chatFilter === k ? 'on' : ''}" data-filter="${k}">${t}</button>`;
  main.innerHTML = `
    ${S.dryRun ? testCustomerForm() : ''}
    <div class="chips">${f('all', 'All')}${f('unread', `Unread${unread ? ` · ${unread}` : ''}`)}${f('waiting', 'On a waitlist')}</div>
    ${list.map((c) => {
      const tags = c.waiting_for.map((w) => `<span class="tag">Waiting: ${esc(w)}</span>`);
      if (c.awaiting_consent) tags.push('<span class="tag hold">Asked for alert</span>');
      return `<a class="row" href="#/chat/${esc(c.id)}">
        <span class="av">${initials(c.name ?? c.wa_id)}</span>
        <span style="min-width:0"><span class="name"><span class="n">${esc(c.name ?? phone(c.wa_id))}</span>${chip(c.channel)}</span>
          <span class="last">${c.last_direction === 'out' ? 'You: ' : ''}${esc(c.last_body ?? '')}</span>
          ${tags.length ? `<span class="tagline">${tags.join('')}</span>` : ''}</span>
        <span class="meta"><span>${when(c.last_at)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</span></a>`;
    }).join('') || `<p class="empty">${chats.length ? 'Nothing here.' : 'No chats yet. When customers message your WhatsApp number, they show up here.'}</p>`}`;
};

function testCustomerForm() {
  return `<details class="test"><summary>Test mode: message the shop as a customer</summary>
    <form class="form" data-form="as-customer">
      <label>Customer's WhatsApp number<input id="tc-from" value="${esc(samplePhone())}" required><span class="hint">Local or international format.</span></label>
      <label>Name<input id="tc-name" value="Amaka Obi"></label>
      <label>Message<input id="tc-text" value="Do you have the brown claw clip ponytail?" required></label>
      <button class="btn block">Send as customer</button>
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
  header(esc(c.name ?? phone(c.wa_id)), { back: '#/chats', sub: `${phone(c.wa_id)} · ${chName[c.channel] ?? ''}` });
  setNav('chats');
  const hoursLeft = c.last_inbound_at ? Math.max(0, 24 - Math.floor((Date.now() - new Date(c.last_inbound_at)) / 36e5)) : 0;
  const live = consents.find((k) => !k.revoked_at);
  const stickToBottom = !main.dataset.view || main.dataset.view !== `chat:${id}` || window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
  main.innerHTML = `
    ${c.window_open
      ? `<div class="banner ok"><b>Reply window open</b> for about ${hoursLeft}h. After that, WhatsApp only allows approved templates.</div>`
      : `<div class="banner"><b>Reply window closed.</b> It's been over 24 hours since they last messaged, so free replies are off until they message again. Restock alerts still reach them as templates.</div>`}
    ${waitingFor.length || live ? `<div class="pad" style="padding-bottom:0"><span class="tagline">
      ${waitingFor.map((w) => `<span class="tag">Waiting: ${label(w)} · #${w.position}</span>`).join('')}
      ${live ? `<span class="tag muted">Consent: “${esc(live.quote)}” · ${when(live.granted_at)}</span>` : consents.length ? '<span class="tag muted">Opted out</span>' : ''}
    </span></div>` : ''}
    <div class="msgs">${messages.map((m) => `<div class="b ${m.direction}">${m.kind === 'template' ? `<span class="tpl">Template${m.cost_usd_micros ? ` · ${usd(m.cost_usd_micros)}` : ''}</span>` : ''}${esc(m.body)}<small>${when(m.created_at)}</small></div>`).join('')}</div>
    <form class="composer" data-form="reply" data-id="${esc(id)}">
      <input id="reply" placeholder="${c.window_open ? 'Reply' : 'Replies are off until they message again'}" autocomplete="off" ${c.window_open ? '' : 'disabled'}>
      <button ${c.window_open ? '' : 'disabled'}>Send</button></form>
    ${S.dryRun ? `<form class="composer test" data-form="as-this-customer" data-wa="${esc(c.wa_id)}" data-name="${esc(c.name ?? '')}">
      <input id="as-cust" placeholder="Test mode: reply as ${esc((c.name ?? 'customer').split(' ')[0])}" autocomplete="off"><button>Send</button></form>` : ''}`;
  if (stickToBottom) window.scrollTo(0, document.body.scrollHeight);
};

views.products = async () => {
  const products = await api(`/api/products?sellerId=${sellerId()}`);
  header('Stock', { sub: `${products.reduce((a, p) => a + p.waiting, 0)} people waiting` });
  setNav('stock');
  const row = (p) => `<a class="row" href="#/product/${esc(p.id)}"><span class="prodicon">${initials(p.name)}</span>
    <span style="min-width:0"><span class="name"><span class="n">${esc(p.name)}</span></span><span class="last">${esc(p.variant || 'No variant')} · ${p.stock} in stock · ${money(p.price_minor)}</span></span>
    <span class="r"><b>${p.waiting}</b>waiting</span></a>`;
  const out = products.filter((p) => p.stock === 0);
  const inStock = products.filter((p) => p.stock > 0);
  main.innerHTML = `<div class="pad"><a class="btn block" href="#/products/new">Add a product</a></div>
    ${out.length ? `<div class="sect">Sold out</div>${out.map(row).join('')}` : ''}
    ${inStock.length ? `<div class="sect">In stock</div>${inStock.map(row).join('')}` : ''}
    ${products.length ? '' : '<p class="empty">No products yet. Add what you sell so Oja can recognise it in chats.</p>'}`;
};

views.newProduct = async () => {
  header('Add a product', { back: '#/products' });
  setNav('stock');
  main.innerHTML = `<form class="form" data-form="product">
    <label>Name<input id="p-name" required placeholder='12" Claw Clip Ponytail'></label>
    <label>Colour or variant<input id="p-variant" placeholder="${S.seller.language === 'fr+en' ? 'Marron / Brown' : 'Brown'}"><span class="hint">Oja uses this to tell variants apart in chats. Leave empty if there's only one.${S.seller.language === 'fr+en' ? ' Write both languages as “Marron / Brown” so each half of a message reads naturally.' : ''}</span></label>
    <label>Price (${esc(S.seller.currency)})<input id="p-price" type="number" min="0" step="any" required></label>
    <label>In stock now<input id="p-stock" type="number" min="0" step="1" value="0"></label>
    <label>Other words customers use<input id="p-aliases" placeholder="ponytail extension, claw ponytail"><span class="hint">Separate with commas.</span></label>
    <p class="err" id="p-err" hidden></p>
    <button class="btn primary block">Save product</button></form>`;
};

views.product = async ([id]) => {
  const [{ product: p, restocks }, waitlist] = await Promise.all([api(`/api/products/${id}`), api(`/api/products/${id}/waitlist`)]);
  if (!S.restockForm || S.restockForm.id !== id) S.restockForm = { id, units: 3, mode: 'hold', holdMinutes: 120, perUnit: 5 };
  const f = S.restockForm;
  const past = restocks.filter((r) => r.messaged > 0);
  const bought = past.length ? Math.round((100 * past.reduce((a, r) => a + r.sold, 0)) / past.reduce((a, r) => a + r.messaged, 0)) : null;
  const running = restocks.find((r) => !r.closed_at);
  header(label(p), { back: '#/products', sub: money(p.price_minor) });
  setNav('stock');
  const stepper = (k) => `<span class="step"><button type="button" data-cfg="${k}:-1" aria-label="Fewer">−</button><output>${f[k]}</output><button type="button" data-cfg="${k}:1" aria-label="More">+</button></span>`;
  main.innerHTML = `
    <div class="kv"><div><span>In stock</span><b>${p.stock}</b></div><div><span>Waiting</span><b>${p.waiting}</b></div><div><span>Bought when alerted</span><b>${bought === null ? '—' : bought + '%'}</b></div></div>
    ${running ? `<div class="banner"><b>Restock running.</b> <a href="#/restock/${esc(running.id)}">See who's been messaged</a></div>` : ''}
    <div class="card"><h2>${p.waiting ? 'Log a restock' : 'Add stock'}</h2>
      <div class="field"><label>Units that came in</label>${stepper('units')}</div>
      ${p.waiting ? `<div class="field"><div class="seg"><button type="button" data-mode="hold" class="${f.mode === 'hold' ? 'on' : ''}">Hold one per unit</button><button type="button" data-mode="race" class="${f.mode === 'race' ? 'on' : ''}">Open race</button></div></div>
      ${f.mode === 'hold'
        ? `<div class="field"><label>Hold length</label><div class="seg" style="width:auto;min-width:220px">${[60, 120, 240, 1440].map((m) => `<button type="button" data-hold="${m}" class="${f.holdMinutes === m ? 'on' : ''}">${mins(m)}</button>`).join('')}</div></div>`
        : `<div class="field"><label>People per unit<span class="hint">More people sells faster but costs more</span></label>${stepper('perUnit')}</div>`}` : ''}
      <div id="plan"><p class="note">Working out who to message…</p></div>
    </div>
    ${waitlist.length ? `<div class="sect">Waitlist</div>${waitlist.map((w) => `<div class="line"><span class="pos">#${w.position}</span>
      <span>${esc(w.name ?? phone(w.wa_id))}<span class="q">“${esc(w.consent_quote)}” · since ${when(w.joined_at)}</span></span><span class="ch whatsapp"><i></i>WhatsApp</span></div>`).join('')}` : ''}
    <div class="sect">Edit</div>
    <form class="form" data-form="edit-product" data-id="${esc(id)}" style="padding-top:4px">
      <label>Set stock count<input id="e-stock" type="number" min="0" step="1" value="${p.stock}"><span class="hint">For sales outside Oja. To announce new stock, use the restock above.</span></label>
      <label>Price (${esc(S.seller.currency)})<input id="e-price" type="number" min="0" step="any" value="${toMajor(p.price_minor)}"></label>
      <label>Other words customers use<input id="e-aliases" value="${esc(p.aliases.join(', '))}"></label>
      <button class="btn block">Save changes</button></form>
    ${restocks.length ? `<div class="sect">Past restocks</div>${restocks.map((r) => `<a class="line" href="#/restock/${esc(r.id)}" style="text-decoration:none;color:inherit"><span class="pos">${r.units}×</span>
      <span>${when(r.created_at)} · ${r.mode === 'hold' ? 'holds' : 'race'}<span class="q">${r.sold} sold · ${r.messaged} messaged</span></span>${r.closed_at ? '<span class="pill expired">Done</span>' : '<span class="pill held">Running</span>'}</a>`).join('')}` : ''}`;
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
      ? `Nobody is waiting, so ${f.units} unit${f.units === 1 ? '' : 's'} go straight into stock. No messages are sent.`
      : f.mode === 'hold'
        ? `Message the first ${pv.toMessage} on the list. Each gets one unit held for ${mins(f.holdMinutes)}. If they don't pay, it passes to the next person.`
        : `Message the first ${pv.toMessage} on the list at once. The first ${f.units} to pay get one; everyone else gets a “sold out, you keep your place” note.`;
    plan.innerHTML = `<p class="note" style="margin-top:4px">${what}</p>
      ${pv.toMessage ? `<p class="hint" style="margin:12px 0 6px">What the first person on the list will read</p><div class="preview">${esc(pv.preview)}</div>
      <p class="note">Numbers come from your stock and waitlist, so every count is true.</p>
      <div class="cost" style="margin-top:12px"><span>${pv.toMessage} alert${pv.toMessage === 1 ? '' : 's'}</span><b class="num">${usd(pv.costUsdMicros.alerts)}</b>
        ${pv.soldOutNotes ? `<span>${pv.soldOutNotes} sold-out notes</span><b class="num">${usd(pv.costUsdMicros.soldOutNotes)}</b>` : f.mode === 'hold' ? `<span>Each re-offer if a hold lapses</span><b class="num">${usd(pv.perMessageUsdMicros.marketing)}</b>` : ''}
        <span class="tot">Estimated WhatsApp fees (Meta bills in USD)</span><b class="tot num">${usd(pv.costUsdMicros.total)}</b></div>` : ''}
      <div class="btns">${S.confirm
        ? `<button class="btn primary" data-act="restock-go">Yes, ${pv.toMessage ? `send ${pv.toMessage} alert${pv.toMessage === 1 ? '' : 's'}` : 'add to stock'}</button><button class="btn" data-act="restock-cancel">Cancel</button>`
        : `<button class="btn primary block" data-act="restock-ask" ${pv.running ? 'disabled' : ''}>${pv.running ? 'Wait for the running restock to finish' : `Add ${f.units} to stock${pv.toMessage ? ` and message ${pv.toMessage}` : ''}`}</button>`}</div>`;
  } catch (e) {
    plan.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

views.restock = async ([id]) => {
  const { restock: r, offers } = await api(`/api/restocks/${id}`);
  const { product: p } = await api(`/api/products/${r.product_id}`);
  const sold = offers.filter((o) => o.status === 'paid').length;
  const held = offers.filter((o) => o.status === 'held').length;
  header(r.closed_at ? 'Restock finished' : 'Restock running', { back: `#/product/${esc(p.id)}`, sub: `${label(p)} · ${when(r.created_at)}` });
  setNav('stock');
  const slots = Array.from({ length: Math.min(r.units, 12) }, (_, k) => (k < sold ? 'sold' : k < sold + held ? 'held' : ''));
  const pill = (o) => {
    if (o.refund_due) return '<span class="pill refund">Paid late · refund</span>';
    if (o.status === 'held') return `<span class="pill held">Held · ${mins(Math.round((new Date(o.expires_at) - Date.now()) / 6e4))} left</span>`;
    if (o.status === 'paid') return `<span class="pill paid">Paid ${clock(o.paid_at)}</span>`;
    if (o.status === 'expired') return '<span class="pill expired">Hold ended</span>';
    if (o.status === 'missed') return '<span class="pill missed">Sold-out note</span>';
    return '<span class="pill notified">Messaged</span>';
  };
  main.innerHTML = `
    <div class="units">${slots.map((s, k) => `<span class="${s}">${s === 'sold' ? 'Sold' : s === 'held' ? 'Held' : 'Unit ' + (k + 1)}</span>`).join('')}${r.units > 12 ? `<span>+${r.units - 12}</span>` : ''}</div>
    <div class="stats"><div><span>Sold</span><b class="num">${sold} of ${r.units}</b></div><div><span>Messaged</span><b class="num">${offers.length}</b></div><div><span>Sales</span><b class="num">${money(sold * p.price_minor)}</b></div></div>
    ${r.closed_at ? `<div class="banner ok"><b>Finished.</b> ${sold ? `${sold} sold.` : 'Nothing sold through alerts.'} ${r.units - sold > 0 ? `${r.units - sold} unit${r.units - sold === 1 ? '' : 's'} stay in stock for anyone who asks.` : ''} People who didn't buy keep their place.</div>` : ''}
    <div class="sect">Who was messaged</div>
    ${offers.map((o) => `<div class="line"><span class="pos">${clock(o.sent_at)}</span><span>${esc(o.name ?? phone(o.wa_id))}<span class="q">${phone(o.wa_id)}</span></span>
      <span style="display:grid;gap:4px;justify-items:end">${pill(o)}${S.dryRun && ['held', 'notified'].includes(o.status) ? `<button class="btn sm" data-pay="${esc(o.payment_ref)}">Test: mark paid</button>` : ''}</span></div>`).join('') || '<p class="empty">Nobody was waiting, so no one was messaged.</p>'}
    ${!r.closed_at && r.mode === 'hold' ? `<p class="note pad">Holds are checked every minute. Unpaid ones pass to the next person automatically.${S.dryRun ? ' <button class="btn sm" data-act="tick">Test: check holds now</button>' : ''}</p>` : ''}`;
};

views.insights = async () => {
  const [ins, consents] = await Promise.all([api(`/api/insights?sellerId=${sellerId()}`), api(`/api/consents?sellerId=${sellerId()}`)]);
  header('Insights', { sub: new Date(ins.monthStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) });
  setNav('insights');
  const demand = ins.demand.filter((d) => d.waiting > 0);
  main.innerHTML = `
    <div class="tiles">
      <div><span>Sales from alerts</span><b class="num">${money(ins.sales.revenue_minor)}</b></div>
      <div><span>Orders from alerts</span><b class="num">${ins.sales.orders}</b></div>
      <div><span>Messages sent</span><b class="num">${ins.spend.messages}</b></div>
      <div><span>WhatsApp fees (est.)</span><b class="num">${usd(ins.spend.cost_usd_micros)}</b></div>
    </div>
    ${ins.refunds.length ? `<div class="sect">Refunds to send</div>${ins.refunds.map((r) => `<div class="line"><span class="pos">↩</span><span>${esc(r.name ?? phone(r.wa_id))} · ${money(r.price_minor)}<span class="q">${label({ name: r.product, variant: r.variant })} · Paystack ref ${esc(r.payment_ref)}</span></span><span class="pill refund">Refund due</span></div>`).join('')}` : ''}
    <div class="sect">What to reorder</div>
    ${demand.length ? `<div class="tablewrap"><table><thead><tr><th>Item</th><th>Waiting</th><th>Bought when alerted</th><th>Suggest</th></tr></thead><tbody>
      ${demand.map((d) => `<tr><td>${esc(d.name)}<span>${esc(d.variant)}</span></td><td class="num">${d.waiting}</td><td class="num">${d.bought_pct === null ? '—' : d.bought_pct + '%'}</td>
        <td class="num"><b>${d.bought_pct === null ? '—' : Math.max(1, Math.round((d.waiting * d.bought_pct) / 100))}</b></td></tr>`).join('')}
    </tbody></table></div><p class="note pad" style="margin:0">Suggested units = people waiting × share who bought at past restocks. Shown once an item has had one restock.</p>`
      : '<p class="empty">Nobody is on a waitlist yet.</p>'}
    <div class="sect">Consent log</div>
    ${consents.map((k) => `<div class="line"><span class="pos">${k.revoked_at ? '✕' : '✓'}</span><span>${esc(k.name ?? phone(k.wa_id))}<span class="q">“${esc(k.quote)}” · ${label({ name: k.product ?? '', variant: k.variant ?? '' })} · ${when(k.granted_at)}</span></span>${k.revoked_at ? '<span class="pill expired">Opted out</span>' : chip(k.channel)}</div>`).join('') || '<p class="empty">No consents yet.</p>'}`;
};

views.settings = async () => {
  const mk = await markets();
  const s = S.seller;
  header('Settings', { sub: esc(s?.name ?? '') });
  setNav('settings');
  const m = mk.countries.find((c) => c.code === s.country);
  const suggested = m?.providers ?? ['flutterwave', 'stripe'];
  const order = [...new Set([s.payment_provider, ...suggested, 'flutterwave', 'notchpay', 'paystack', 'stripe', 'test'])];
  const connected = (on) => (on ? '<span class="pill paid">Connected</span>' : '<span class="pill expired">Not connected yet</span>');
  const chRow = (ch, title, note, on) => `<div class="line"><span class="pos"><span class="ch ${ch}" style="padding:4px"><i></i></span></span><span>${title}<span class="q">${note}</span></span>${connected(on)}</div>`;
  const owner = s.role === 'owner';
  const [members, me] = await Promise.all([api(`/api/sellers/${s.id}/members`), api('/api/me')]);
  const team = `<div class="sect">Team</div>
    ${members.map((mb) => `<div class="line"><span class="pos">${mb.role === 'owner' ? '★' : '·'}</span>
      <span>${esc(mb.name ?? '+' + mb.wa_id)}${me.user?.id === mb.user_id ? ' (you)' : ''}<span class="q">+${esc(mb.wa_id)} · ${mb.role === 'owner' ? 'Owner: everything' : 'Staff: chats, stock and restocks'}</span></span>
      ${owner && me.user?.id !== mb.user_id ? `<button class="btn sm" data-remove-member="${esc(mb.user_id)}">Remove</button>` : '<span></span>'}</div>`).join('')}
    ${owner ? `<form class="form" data-form="member">
      <label>Add someone by WhatsApp number<input id="m-phone" type="tel" required placeholder="${esc(samplePhone())}"><span class="hint">They sign in with this number. Local numbers are read as ${esc(m?.name ?? s.country)}.</span></label>
      <label>Role<select id="m-role"><option value="staff">Staff: chats, stock and restocks</option><option value="owner">Owner: also payments and the team</option></select></label>
      <p class="err" hidden></p>
      <button class="btn block">Add to team</button></form>` : ''}`;
  main.innerHTML = `
    ${S.dryRun ? '<div class="banner"><b>Test mode.</b> Nothing is sent to WhatsApp and payments are simulated. Set DRY_RUN=false on the server to go live.</div>' : ''}
    ${owner ? '' : '<div class="banner">You are <b>staff</b> in this shop. The owner manages payments, shop details and the team.</div>'}
    <div class="sect"${owner ? '' : ' hidden'}>Get paid</div>
    <form class="form" data-form="payments" style="padding-top:4px"${owner ? '' : ' hidden'}>
      <label>Payment provider<select id="pay-provider" data-provider>${order.map((k) => `<option value="${k}" ${k === s.payment_provider ? 'selected' : ''}>${esc(mk.providers[k].label)}${suggested.includes(k) ? ' · suggested' : ''}</option>`).join('')}</select>
        <span class="hint">Money goes straight to your own account. Oja never holds it.</span></label>
      <div id="pay-keys">${payKeyFields(mk, s.payment_provider)}</div>
      <p class="note" id="pay-hook">${s.payment_provider !== 'test' && s.payments_connected ? `Webhook URL to paste in your provider dashboard: <code>${esc(location.origin)}/webhooks/payments/${esc(s.id)}</code>` : ''}</p>
      <p class="err" hidden></p>
      <button class="btn block">Save payment settings</button>
    </form>
    <div class="sect"${owner ? '' : ' hidden'}>Shop</div>
    <form class="form" data-form="shop" style="padding-top:4px"${owner ? '' : ' hidden'}>
      <label>Shop name<input id="s-name" value="${esc(s.name)}" required></label>
      ${shopFields(mk, s)}
      <p class="err" hidden></p>
      <button class="btn block">Save shop</button>
    </form>
    ${team}
    <div class="sect">Channels</div>
    ${chRow('whatsapp', 'WhatsApp', `Number id ${esc(s.wa_phone_number_id)}`, true)}
    ${chRow('instagram', 'Instagram DMs', 'Needs Meta app review for Instagram messaging', false)}
    ${chRow('facebook', 'Facebook Messenger', 'Needs Meta app review for Messenger', false)}
    ${chRow('tiktok', 'TikTok DMs', 'Needs TikTok Business Messaging API access', false)}
    <div class="pad btns" style="margin:0"><a class="btn" href="#/setup">Switch or add shop</a><button class="btn danger" data-act="signout">Sign out</button></div>`;
};
function payKeyFields(mk, provider) {
  const info = mk.providers[provider];
  if (provider === 'test') return '<p class="note">Customers see a test checkout. Nothing is charged.</p>';
  return `<label>${esc(info.label.split(' (')[0])} key<input id="pay-secret" type="password" autocomplete="off" placeholder="${S.seller.payments_connected && S.seller.payment_provider === provider ? 'Saved. Paste a new key to replace it.' : ''}"><span class="hint">${esc(info.secretHint)}</span></label>
    ${info.needsWebhookSecret ? `<label>Webhook secret<input id="pay-hook-secret" type="password" autocomplete="off"><span class="hint">${esc(info.webhookHint ?? '')}</span></label>` : ''}`;
}
document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-provider]')) $('#pay-keys').innerHTML = payKeyFields(await markets(), e.target.value);
});

// ---------- router ----------
const routes = [
  [/^#\/login$/, 'login'], [/^#\/setup$/, 'setup'], [/^#\/chats$/, 'chats'], [/^#\/chat\/([\w-]+)$/, 'chat'], [/^#\/products$/, 'products'],
  [/^#\/products\/new$/, 'newProduct'], [/^#\/product\/([\w-]+)$/, 'product'], [/^#\/restock\/([\w-]+)$/, 'restock'],
  [/^#\/insights$/, 'insights'], [/^#\/settings$/, 'settings'],
];
async function route(quiet = false) {
  let hash = location.hash || '#/chats';
  if (!get('oja.token')) hash = '#/login';
  else if (hash === '#/login' || (!sellerId() && hash !== '#/setup')) hash = '#/setup';
  const match = routes.map(([re, name]) => [hash.match(re), name]).find(([m]) => m);
  const [m, name] = match ?? [[], 'chats'];
  const key = `${name}:${m.slice(1).join('/')}`;
  if (!quiet) { S.confirm = false; }
  try {
    if (sellerId() && !S.seller && name !== 'setup' && name !== 'login') {
      setSeller((await api('/api/sellers')).find((s) => s.id === sellerId()) ?? null);
      if (!S.seller) { set('oja.seller', null); location.hash = '#/setup'; return; }
    }
    await views[name](m.slice(1));
    main.dataset.view = key;
    if (!quiet) { if (name !== 'chat') window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  } catch (e) {
    if (e.status === 401) { set('oja.token', null); set('oja.seller', null); setSeller(null); S.login = null; await views.login([], 'Please sign in again.'); return; }
    if (e.status === 404 && name !== 'setup' && sellerId() && !S.seller) { set('oja.seller', null); location.hash = '#/setup'; return; }
    if (!quiet) main.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}
window.addEventListener('hashchange', () => route());

// Keep chats, waitlists and running restocks fresh without interrupting typing.
setInterval(() => {
  const busy = document.activeElement?.matches('input, textarea, select') || S.confirm;
  if (!busy && document.visibilityState === 'visible' && sellerId() && get('oja.token') && !/setup|new|login/.test(location.hash)) route(true);
}, 5000);

// ---------- actions ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-pick],[data-filter],[data-cfg],[data-mode],[data-hold],[data-act],[data-pay],[data-remove-member]');
  if (!t) return;
  if (t.dataset.pick) { set('oja.seller', t.dataset.pick); setSeller(null); return; }
  if (t.dataset.filter) { S.chatFilter = t.dataset.filter; return route(true); }
  if (t.dataset.removeMember) {
    try { await api(`/api/sellers/${sellerId()}/members/${t.dataset.removeMember}`, { method: 'DELETE' }); toast('Removed from the team'); }
    catch (err) { toast(err.message); }
    return route(true);
  }
  const f = S.restockForm;
  if (t.dataset.cfg) {
    const [k, d] = t.dataset.cfg.split(':');
    const max = { units: 500, perUnit: 20 }[k];
    f[k] = Math.max(1, Math.min(max, f[k] + Number(d)));
    t.parentElement.querySelector('output').textContent = f[k];
    S.confirm = false;
    clearTimeout(loadPlan.h);
    loadPlan.h = setTimeout(() => loadPlan(f.id), 200);
    return;
  }
  if (t.dataset.mode) { f.mode = t.dataset.mode; S.confirm = false; return route(true); }
  if (t.dataset.hold) { f.holdMinutes = Number(t.dataset.hold); S.confirm = false; return route(true); }
  if (t.dataset.pay) {
    t.disabled = true;
    const r = await api(`/dev/pay/${t.dataset.pay}`, { method: 'POST' });
    toast(r.outcome === 'paid' ? 'Marked as paid' : `Payment result: ${r.outcome.replace('_', ' ')}`);
    return route(true);
  }
  const act = t.dataset.act;
  try {
    if (act === 'restock-ask') { S.confirm = true; return loadPlan(f.id); }
    if (act === 'restock-cancel') { S.confirm = false; return loadPlan(f.id); }
    if (act === 'restock-go') {
      t.disabled = true;
      const r = await api(`/api/products/${f.id}/restocks`, { method: 'POST', body: { units: f.units, mode: f.mode, holdMinutes: f.holdMinutes, perUnit: f.perUnit } });
      S.confirm = false;
      toast(r.offered ? `${r.offered} alert${r.offered === 1 ? '' : 's'} sent` : 'Added to stock');
      location.hash = r.offered ? `#/restock/${r.restockId}` : `#/product/${f.id}`;
      if (!r.offered) route(true);
      return;
    }
    if (act === 'tick') { await api('/api/tick', { method: 'POST' }); toast('Holds checked'); return route(true); }
    if (act === 'signout') {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
      set('oja.token', null); set('oja.seller', null); setSeller(null); S.login = null; location.hash = '#/login'; return route();
    }
    if (act === 'login-back') { S.login = { country: S.login?.country, phone: S.login?.phone }; return views.login(); }
    if (act === 'demo') { t.disabled = true; t.textContent = 'Loading…'; await loadDemo(); return; }
  } catch (err) {
    toast(err.message);
    if (act === 'restock-go') { t.disabled = false; }
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
        set('oja.token', r.token);
        S.login = null;
        location.hash = '#/setup';
        return route();
      }
      case 'member':
        await api(`/api/sellers/${sellerId()}/members`, { method: 'POST', body: { phone: val('m-phone'), role: val('m-role') } });
        toast('Added to the team. They can sign in with that number now.');
        return route(true);
      case 'seller': {
        const s = await api('/api/sellers', { method: 'POST', body: { name: val('s-name'), waPhoneNumberId: val('s-phone'), ...shopValues(form) } });
        set('oja.seller', s.id); setSeller(s);
        location.hash = '#/products';
        return;
      }
      case 'shop':
        setSeller(await api(`/api/sellers/${sellerId()}`, { method: 'PATCH', body: { name: val('s-name'), ...shopValues(form) } }));
        toast('Shop saved');
        return route(true);
      case 'payments': {
        const provider = val('pay-provider');
        const r = await api(`/api/sellers/${sellerId()}/payments`, { method: 'PUT', body: { provider, secretKey: val('pay-secret') || undefined, webhookSecret: val('pay-hook-secret') || undefined } });
        setSeller(r);
        toast(provider === 'test' ? 'Using test payments' : 'Payments connected');
        await route(true);
        if (provider !== 'test') $('#pay-hook').innerHTML = `Webhook URL to paste in your provider dashboard: <code>${esc(r.webhookUrl)}</code>`;
        return;
      }
      case 'product': {
        const p = await api('/api/products', {
          method: 'POST',
          body: { sellerId: sellerId(), name: val('p-name'), variant: val('p-variant'), price: Number(val('p-price')), stock: Number(val('p-stock') || 0), aliases: val('p-aliases').split(',').map((a) => a.trim()).filter(Boolean) },
        });
        toast('Product saved');
        location.hash = `#/product/${p.id}`;
        return;
      }
      case 'edit-product':
        await api(`/api/products/${form.dataset.id}`, {
          method: 'PATCH',
          body: { stock: Number(val('e-stock')), price: Number(val('e-price')), aliases: val('e-aliases').split(',').map((a) => a.trim()).filter(Boolean) },
        });
        toast('Saved');
        return route(true);
      case 'reply':
        if (!val('reply')) return;
        await api(`/api/chats/${form.dataset.id}/reply`, { method: 'POST', body: { body: val('reply') } });
        $('#reply', form).value = '';
        return route(true);
      case 'as-customer': {
        const r = await api('/dev/inbound', { method: 'POST', body: { sellerId: sellerId(), from: val('tc-from'), name: val('tc-name') || undefined, text: val('tc-text') } });
        toast(outcomeText[r.action] ?? r.action);
        return route(true);
      }
      case 'as-this-customer': {
        if (!val('as-cust')) return;
        const r = await api('/dev/inbound', { method: 'POST', body: { sellerId: sellerId(), from: form.dataset.wa, name: form.dataset.name || undefined, text: val('as-cust') } });
        $('#as-cust', form).value = '';
        toast(outcomeText[r.action] ?? r.action);
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

const outcomeText = {
  offered: 'Oja offered a restock alert',
  joined: 'Customer joined the waitlist',
  already_waiting: 'Already on the waitlist',
  in_stock: 'Oja said it’s in stock',
  stopped: 'Customer opted out',
  unhandled: 'Left for you to reply',
};

async function loadDemo() {
  const form = $('form[data-form="seller"]');
  const shop = shopValues(form);
  const fr = shop.language !== 'en';
  const s = await api('/api/sellers', { method: 'POST', body: { name: $('#s-name', form).value.trim() || (fr ? 'Douala Hair Plug' : 'Hair Plug'), waPhoneNumberId: 'demo-' + Date.now(), ...shop } });
  set('oja.seller', s.id); setSeller(s);
  // Sample prices in the shop's currency: [clip, bonnet, wig]
  const prices = { XAF: [15000, 5000, 85000], XOF: [15000, 5000, 85000], NGN: [18500, 6500, 145000], GHS: [250, 90, 1800], KES: [2500, 900, 18000], ZAR: [350, 120, 2400] }[s.currency] ?? [25, 9, 180];
  const add = (name, variant, price, stock, aliases = []) => api('/api/products', { method: 'POST', body: { sellerId: s.id, name, variant, price, stock, aliases } });
  const both = shop.language === 'fr+en';
  await add('Claw Clip Ponytail', both ? 'Marron / Brown' : fr ? 'Marron' : 'Brown', prices[0], 0, ['ponytail']);
  await add('Claw Clip Ponytail', both ? 'Noir / Black' : fr ? 'Noir' : 'Jet black', prices[0], 6, ['ponytail']);
  await add(fr ? 'Bonnet satin' : 'Satin Bonnet', fr ? 'Bordeaux' : 'Wine', prices[1], 0, fr ? ['bonnet en soie'] : ['silk bonnet']);
  await add(fr ? 'Perruque lisse 20 pouces' : 'Bone Straight Wig 20"', fr ? 'Noir naturel' : 'Natural black', prices[2], 2, fr ? ['perruque'] : ['bone straight']);
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
  toast('Sample shop loaded');
  location.hash = '#/chats';
}

// ---------- start ----------
try { S.dryRun = (await api('/health')).dryRun; } catch { /* server down: views will show the error */ }
route();
