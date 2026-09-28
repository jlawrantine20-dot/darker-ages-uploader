/**
 * Messages the seller app shows when a request fails, in English and French. Errors carry a
 * key and its values; the response is written in the language the app asked for (X-Lang), so
 * a seller using the app in French never sees an English sentence. `message` stays English
 * for logs and tests.
 */
export type UiLang = 'en' | 'fr';
type P = Record<string, string | number>;

const MESSAGES = {
  units_range: { en: () => 'Enter between 1 and 10,000 units.', fr: () => 'Indiquez entre 1 et 10 000 unités.' },
  mode_invalid: { en: () => 'Choose whether to hold one per unit or open a race.', fr: () => 'Choisissez entre réserver une unité par personne et le premier qui paie.' },
  hold_range: { en: () => 'A hold must last between 5 minutes and 7 days.', fr: () => 'Une réservation dure entre 5 minutes et 7 jours.' },
  per_unit_range: { en: () => 'Message between 1 and 50 people per unit.', fr: () => 'Prévenez entre 1 et 50 personnes par unité.' },
  product_not_found: { en: () => "This product doesn't exist or was deleted.", fr: () => "Ce produit n'existe pas ou a été supprimé." },
  restock_running: {
    en: () => 'A restock for this item is still running. Wait for it to finish before adding more.',
    fr: () => "Un arrivage est encore en cours pour cet article. Attendez qu'il se termine avant d'en ajouter un autre.",
  },
  oauth_invalid: { en: () => 'This sign-in link is not valid. Start again from Settings.', fr: () => "Ce lien de connexion n'est pas valide. Recommencez depuis les Réglages." },
  oauth_expired: { en: () => 'This sign-in took too long. Start again from Settings.', fr: () => 'La connexion a pris trop de temps. Recommencez depuis les Réglages.' },
  channel_unavailable: { en: (p: P) => `${p.channel} isn't set up on the server yet.`, fr: (p: P) => `${p.channel} n'est pas encore configuré sur le serveur.` },
  meta_refused: { en: (p: P) => `Meta refused the connection: ${p.why}`, fr: (p: P) => `Meta a refusé la connexion : ${p.why}` },
  channel_taken: { en: (p: P) => `This ${p.channel} account is already connected to another shop.`, fr: (p: P) => `Ce compte ${p.channel} est déjà relié à une autre boutique.` },
  channel_not_connected: { en: (p: P) => `${p.channel} was not connected. Try again.`, fr: (p: P) => `${p.channel} n'a pas été connecté. Réessayez.` },
  no_pages: {
    en: () => "This Facebook account doesn't manage any Page. Create a Page for your shop first.",
    fr: () => "Ce compte Facebook ne gère aucune Page. Créez d'abord une Page pour votre boutique.",
  },
  page_choice_expired: { en: () => 'That choice expired. Connect Messenger again from Settings.', fr: () => 'Ce choix a expiré. Reconnectez Messenger depuis les Réglages.' },
  pick_listed_page: { en: () => 'Pick one of the Pages listed.', fr: () => "Choisissez l'une des Pages proposées." },
  phone_invalid: {
    en: () => 'Enter your WhatsApp number, with the country code if it is not a local number.',
    fr: () => "Saisissez votre numéro WhatsApp, avec l'indicatif du pays s'il ne s'agit pas d'un numéro local.",
  },
  too_many_codes: { en: () => 'Too many codes requested for this number. Try again in an hour.', fr: () => 'Trop de codes demandés pour ce numéro. Réessayez dans une heure.' },
  code_wrong: { en: () => 'That code is wrong or has expired. Request a new one.', fr: () => 'Ce code est incorrect ou a expiré. Demandez-en un nouveau.' },
  not_found: { en: () => 'Not found.', fr: () => 'Introuvable.' },
  owner_only: { en: () => 'Only the shop owner can do this.', fr: () => 'Seul le propriétaire de la boutique peut faire cela.' },
  role_invalid: { en: () => 'Choose owner or staff.', fr: () => 'Choisissez propriétaire ou employé.' },
  last_owner: {
    en: () => 'A shop needs at least one owner. Make someone else owner first.',
    fr: () => "Une boutique doit avoir au moins un propriétaire. Nommez d'abord quelqu'un d'autre propriétaire.",
  },
  country_code: { en: () => 'The country must be a two-letter code, like CM or NG.', fr: () => 'Le pays doit être un code à deux lettres, comme CM ou NG.' },
  currency_for: { en: (p: P) => `Choose a currency for ${p.country}, like XAF or USD.`, fr: (p: P) => `Choisissez une devise pour ${p.country}, comme XAF ou USD.` },
  language_invalid: { en: () => 'Choose French, English or both.', fr: () => "Choisissez le français, l'anglais ou les deux." },
  timezone_for: { en: (p: P) => `Choose a time zone for ${p.country}, like Africa/Douala.`, fr: (p: P) => `Choisissez un fuseau horaire pour ${p.country}, comme Africa/Douala.` },
  shop_name: { en: () => 'Give the shop a name.', fr: () => 'Donnez un nom à la boutique.' },
  slug_invalid: {
    en: () => 'The shop link can use lowercase letters, numbers and dashes, 3 to 40 characters, like hair-plug.',
    fr: () => 'Le lien de la boutique peut contenir des lettres minuscules, des chiffres et des tirets, de 3 à 40 caractères, comme hair-plug.',
  },
  wa_display_invalid: {
    en: () => "That WhatsApp number doesn't look right. Include the country code, like +237 6 77 12 34 56.",
    fr: () => "Ce numéro WhatsApp ne semble pas correct. Ajoutez l'indicatif du pays, comme +237 6 77 12 34 56.",
  },
  provider_unknown: { en: (p: P) => `Unknown payment provider: ${p.provider}`, fr: (p: P) => `Moyen de paiement inconnu : ${p.provider}` },
  paste_secret: { en: (p: P) => `Paste your ${p.provider} secret key.`, fr: (p: P) => `Collez votre clé secrète ${p.provider}.` },
  needs_webhook_secret: { en: (p: P) => `${p.provider} also needs its webhook secret.`, fr: (p: P) => `${p.provider} a aussi besoin de son secret de webhook.` },
  shop_required: { en: () => 'Choose a shop first.', fr: () => "Choisissez d'abord une boutique." },
  no_shop: { en: () => 'No shop with that id.', fr: () => 'Aucune boutique ne correspond.' },
  wa_phone_id: { en: () => 'Add the WhatsApp phone number id from Meta.', fr: () => "Ajoutez l'identifiant du numéro WhatsApp fourni par Meta." },
  rate_needed: {
    en: (p: P) => `Enter how many ${p.to} make 1 ${p.from}, so your prices can be converted.`,
    fr: (p: P) => `Indiquez combien de ${p.to} valent 1 ${p.from}, pour convertir vos prix.`,
  },
  slug_taken: { en: (p: P) => `The link "${p.slug}" is taken. Try another.`, fr: (p: P) => `Le lien « ${p.slug} » est déjà pris. Essayez-en un autre.` },
  product_required: { en: () => 'A product needs a name and a price.', fr: () => 'Un produit doit avoir un nom et un prix.' },
  stock_whole: { en: () => 'Stock must be a whole number, 0 or more.', fr: () => 'Le stock doit être un nombre entier, 0 ou plus.' },
  price_min: { en: () => 'The price must be 0 or more.', fr: () => 'Le prix doit être de 0 ou plus.' },
  type_message: { en: () => 'Type a message first.', fr: () => "Écrivez d'abord un message." },
  message_too_long: {
    en: (p: P) => `${p.app} messages can be at most ${p.limit} characters.`,
    fr: (p: P) => `Un message ${p.app} ne peut pas dépasser ${p.limit} caractères.`,
  },
  channel_param: { en: () => 'The channel must be Instagram or Messenger.', fr: () => 'Le canal doit être Instagram ou Messenger.' },
  waba_param: {
    en: () => 'Pass ?wabaId=, the WhatsApp Business Account id from API Setup.',
    fr: () => "Indiquez ?wabaId=, l'identifiant du compte WhatsApp Business affiché dans API Setup.",
  },
  from_text_required: { en: () => 'Enter who is writing and their message.', fr: () => "Indiquez qui écrit et son message." },
  connect_first: { en: (p: P) => `Connect ${p.channel} in Settings first.`, fr: (p: P) => `Connectez d'abord ${p.channel} dans les Réglages.` },
  phone_for_country: { en: (p: P) => `That doesn't look like a valid phone number for ${p.country}.`, fr: (p: P) => `Ce numéro ne semble pas valide pour ${p.country}.` },
  order_not_found: { en: () => "This order doesn't exist or was deleted.", fr: () => "Cette commande n'existe pas ou a été supprimée." },
  order_closed: { en: () => 'This order is already closed.', fr: () => 'Cette commande est déjà clôturée.' },
  push_invalid: { en: () => "This browser didn't give a valid notification address. Try again.", fr: () => "Ce navigateur n'a pas fourni d'adresse de notification valable. Réessayez." },
  zone_required: { en: () => 'An area needs a name and a fee (0 for free).', fr: () => 'Une zone doit avoir un nom et un tarif (0 si gratuit).' },
  server_error: { en: () => 'Something went wrong on our side. Try again in a moment.', fr: () => 'Un problème est survenu de notre côté. Réessayez dans un instant.' },
} satisfies Record<string, Record<UiLang, (p: P) => string>>;

export type MessageKey = keyof typeof MESSAGES;

export function render(lang: UiLang, key: MessageKey, params: P = {}): string {
  return MESSAGES[key][lang](params);
}

/** The language the app asked for; English when it didn't say. */
export const uiLang = (v: string | undefined | null): UiLang => (v?.toLowerCase().startsWith('fr') ? 'fr' : 'en');

/** A failure the seller can act on. Shown in the language of the app. */
export class AppError extends Error {
  constructor(readonly key: MessageKey, readonly params: P = {}) {
    super(render('en', key, params));
  }
  in(lang: UiLang) {
    return render(lang, this.key, this.params);
  }
}

/** A problem with what the seller sent. */
export class InputError extends AppError {}
