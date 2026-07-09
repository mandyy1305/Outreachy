// The ONLY module that touches chrome.storage. Owns the data schema, defaults,
// the history cap, and migration of older saved settings.
//
// chrome.storage.local (never .sync) so API keys never roam to other machines.
// Keys are plaintext at rest, protected only by the OS user profile — fine for
// a personal tool.

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';
const HISTORY_CAP = 500;

// A sensible baseline voice (the user chose "casual & conversational"). The
// Settings page pre-fills this and the user can edit it — and paste their own
// example messages — to capture their exact style.
export const DEFAULT_STYLE =
  "Write like you're messaging a peer you already know — relaxed and conversational, not formal or corporate. Use contractions and everyday words, and keep sentences short and natural. A light, sparing emoji is fine (one at most, and only when it genuinely fits). Open with a casual, genuine reaction to something specific about them, give quick context on RemoteStar in plain language, and close low-pressure (something like \"would love to swap notes this week if you're up for it?\"). Never sound salesy, never use buzzwords, no \"I hope this finds you well\", no hype.";

// Hard rules applied to EVERY generated message, overriding templates/examples.
// Editable in Settings.
export const DEFAULT_GLOBAL_RULES =
  "use extremely simple, layman english. short, common, everyday words only, no jargon or fancy vocabulary.\nnever use em-dashes (the — character). use commas, periods, or parentheses instead.\nwrite everything in all lowercase, including names and the first word of every sentence.";

// Seed templates — the kinds of messages the user sends. Each has a name, an
// instructions line (the goal/approach), and an `examples` array where EACH
// element is one full past message (which may contain paragraphs/newlines).
// The user edits these and pastes their own examples per template.
export const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-sales',
    name: 'Sales pitch — book a call',
    instructions:
      'Pitch RemoteStar and invite them to a short call. Confident but not pushy. Open with a specific hook from their profile, tie it to one or two RemoteStar differentiators (CTO-led screening, the AI interview platform, speed, or pay-only-on-hire), and end with a soft call ask. Vary the angle across the variants — e.g. their recent post, their role and likely hiring needs, or speed / pay-on-hire.',
    examples: [],
  },
  {
    id: 'tpl-feedback',
    name: 'Ask for a feedback call',
    instructions:
      'Politely ask if they would be open to a short call to give feedback on what RemoteStar is building. Humble and low-pressure — you are asking for their expertise, not selling. Reference something specific about them that makes their perspective valuable, and make it easy to say yes.',
    examples: [],
  },
  {
    id: 'tpl-help',
    name: 'Ask for help / intro',
    instructions:
      'Ask for help or an introduction in a warm, genuine, no-pressure way. Keep the ask small and specific, acknowledge their time, and give a clear reason you are reaching out to them in particular.',
    examples: [],
  },
];

export const DEFAULT_SETTINGS = {
  provider: 'openai', // 'openai' | 'anthropic'
  // Per-provider so switching providers doesn't lose the other key/model.
  keys: { openai: '', anthropic: '' },
  // Free-text on purpose — model names drift; confirm in the provider dashboard.
  models: { openai: 'gpt-4o-mini', anthropic: 'claude-opus-4-8' },
  temperature: 0.8, // OpenAI only; the Anthropic adapter ignores it.
  signalhireKey: '', // SignalHire Person API key (for email/phone lookup)
  defaultChannel: 'linkedin', // linkedin | whatsapp | email
  globalRules: DEFAULT_GLOBAL_RULES, // hard rules applied to every message
  styleDescription: DEFAULT_STYLE, // base voice applied under every template
  templates: DEFAULT_TEMPLATES,
  defaultTemplateId: 'tpl-sales',
  promptTemplate: '', // optional full override of the built-in system prompt
  remoteStarContext: '', // optional override of the built-in RemoteStar context
  // Email appearance (see lib/email-designs.js).
  emailDesign: 'plain', // 'plain' (natural) | 'clean' | 'card' (designed)
  senderName: '', // shown in the styled email signature
  senderRole: 'Founding Engineer', // who the messages speak as ("<role> at RemoteStar")
  ctaUrl: '', // booking link for the "card" design's button (e.g. Calendly)
  // Outreach mode: 'sell' pitches the service; 'feedback' asks founders/CEOs
  // for product feedback (soft-sell — the showcase happens by itself).
  outreachMode: 'sell',
  // Company people finder: one search per line, run on the /people/ tab.
  peopleKeywords: ['founder OR CEO', 'CTO OR VP engineering', 'talent acquisition OR recruiter', 'HR OR people operations'],
};

export async function getSettings() {
  const obj = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = obj[SETTINGS_KEY] || {};

  const s = {
    ...DEFAULT_SETTINGS,
    ...stored,
    keys: { ...DEFAULT_SETTINGS.keys, ...(stored.keys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(stored.models || {}) },
  };

  // Migrate Phase 1 flat fields (apiKey / model) into the per-provider shape.
  if (stored.apiKey && !s.keys.openai) s.keys.openai = stored.apiKey;
  if (stored.model && !(stored.models && stored.models.openai)) s.models.openai = stored.model;

  return s;
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getHistory() {
  const obj = await chrome.storage.local.get(HISTORY_KEY);
  return obj[HISTORY_KEY] || [];
}

export async function addHistoryEntry(entry) {
  const hist = await getHistory();
  hist.unshift(entry); // newest first
  if (hist.length > HISTORY_CAP) hist.length = HISTORY_CAP;
  await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  return entry;
}

export async function updateHistoryEntry(id, patch) {
  const hist = await getHistory();
  const i = hist.findIndex((e) => e.id === id);
  if (i < 0) return null;
  hist[i] = { ...hist[i], ...patch };
  await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  return hist[i];
}

export async function deleteHistoryEntry(id) {
  const hist = (await getHistory()).filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  return hist;
}

export async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

// Merge imported entries with existing history, de-duplicating by id and
// keeping newest first (by scrapedAt). Respects the cap.
export async function mergeHistory(entries) {
  const hist = await getHistory();
  const existingIds = new Set(hist.map((e) => e.id));
  const incoming = (entries || []).filter((e) => e && e.id && !existingIds.has(e.id));
  const merged = [...incoming, ...hist];
  merged.sort((a, b) => String(b.scrapedAt || '').localeCompare(String(a.scrapedAt || '')));
  if (merged.length > HISTORY_CAP) merged.length = HISTORY_CAP;
  await chrome.storage.local.set({ [HISTORY_KEY]: merged });
  return merged;
}
