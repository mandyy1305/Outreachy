import { MSG } from '../lib/messages.js';
import { renderEmailHtml } from '../lib/email-designs.js';
import {
  getSettings,
  getHistory,
  addHistoryEntry,
  updateHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  mergeHistory,
} from '../lib/storage.js';

const PROFILE_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\//i;
const COMPANY_RE = /^https?:\/\/(www\.)?linkedin\.com\/company\/[^/?#]+/i;

// ---- element refs --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  tabCompose: $('tab-compose'),
  tabHistory: $('tab-history'),
  openOptions: $('open-options'),
  viewCompose: $('view-compose'),
  viewHistory: $('view-history'),
  pageStatus: $('page-status'),
  btnScrape: $('btn-scrape'),
  reviewDetails: $('review-details'),
  companyBlock: $('company-block'),
  btnFindPeople: $('btn-find-people'),
  peopleStatus: $('people-status'),
  peopleList: $('people-list'),
  stageDetect: $('stage-detect'),
  stageCompose: $('stage-compose'),
  stageResults: $('stage-results'),
  prospectAvatar: $('prospect-avatar'),
  prospectName: $('prospect-name'),
  prospectHeadline: $('prospect-headline'),
  btnRestart: $('btn-restart'),
  scrapeSummary: $('scrape-summary'),
  researchDetails: $('research-details'),
  btnBack: $('btn-back'),
  resultsContext: $('results-context'),
  channelPills: $('channel-pills'),
  fName: $('f-name'),
  fHeadline: $('f-headline'),
  fExperience: $('f-experience'),
  fAbout: $('f-about'),
  fActivity: $('f-activity'),
  btnActivity: $('btn-activity'),
  fResearch: $('f-research'),
  btnResearch: $('btn-research'),
  researchStatus: $('research-status'),
  fTemplate: $('f-template'),
  designField: $('design-field'),
  designPills: $('design-pills'),
  contactBlock: $('contact-block'),
  btnFindContact: $('btn-find-contact'),
  contactStatus: $('contact-status'),
  emailList: $('email-list'),
  phoneList: $('phone-list'),
  emailCount: $('email-count'),
  phoneCount: $('phone-count'),
  btnGenerate: $('btn-generate'),
  btnCallNotes: $('btn-callnotes'),
  genStatus: $('gen-status'),
  variants: $('variants'),
  callnotes: $('callnotes'),
  historySearch: $('history-search'),
  historyList: $('history-list'),
  historyCount: $('history-count'),
  btnExport: $('btn-export'),
  btnImport: $('btn-import'),
  importFile: $('import-file'),
  btnClearHistory: $('btn-clear-history'),
  accountStatus: $('account-status'),
  accountAction: $('account-action'),
  toast: $('toast'),
};

// ---- module state --------------------------------------------------------
let currentProfileUrl = '';
let currentEntryId = null;
let toastTimer = null;
let lastVariants = []; // kept so we can re-render when the channel changes
let foundEmails = []; // [{value, rating, subType}]
let foundPhones = [];
let currentChannel = 'linkedin';
let resultsOrigin = 'compose'; // where the back button returns to

// ---- stages ---------------------------------------------------------------
// The compose view is a 3-stage flow — detect (pick a page), compose (review +
// choose what to make), results (one result set, full focus, back to edit).
// Exactly one stage is visible at a time; nothing accumulates.
function setStage(stage) {
  document.body.dataset.stage = stage;
  els.stageDetect.classList.toggle('hidden', stage !== 'detect');
  els.stageCompose.classList.toggle('hidden', stage !== 'compose');
  els.stageResults.classList.toggle('hidden', stage !== 'results');
  els.genStatus.textContent = '';
}

const CHANNEL_LABELS = { linkedin: 'LinkedIn DM', whatsapp: 'WhatsApp', email: 'Email' };

function setChannel(ch) {
  currentChannel = ch;
  els.channelPills.querySelectorAll('.pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.channel === ch);
  });
  applyChannelUI();
}

// Show ONE result set (variants | callnotes | people) with a context line.
function showResults(kind, context, origin) {
  els.variants.classList.toggle('hidden', kind !== 'variants');
  els.callnotes.classList.toggle('hidden', kind !== 'callnotes');
  els.peopleList.classList.toggle('hidden', kind !== 'people');
  els.resultsContext.textContent = context;
  resultsOrigin = origin;
  setStage('results');
}

// ---- helpers -------------------------------------------------------------
// Never throws: a dead message port (e.g. the service worker got killed while
// we waited on a long interactive flow) resolves to {ok:false} instead of
// leaving the caller's UI stuck on its "busy" text.
async function sendMsg(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (e) {
    return { ok: false, error: e?.message || 'Extension messaging failed — try reloading the extension.' };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
}

function wordCount(s) {
  const t = (s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function toText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join('\n');
  return String(value);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

// ---- tab switching -------------------------------------------------------
function showView(which) {
  const compose = which === 'compose';
  els.viewCompose.classList.toggle('hidden', !compose);
  els.viewHistory.classList.toggle('hidden', compose);
  els.tabCompose.classList.toggle('active', compose);
  els.tabHistory.classList.toggle('active', !compose);
  if (compose) {
    detectPage();
    populateTemplates();
    populateDesigns();
  } else {
    renderHistory();
  }
}

// ---- page detection ------------------------------------------------------
async function detectPage() {
  // Only the detect stage reacts to tab changes — never yank the user out of
  // an in-progress compose or results view because they switched tabs.
  if (document.body.dataset.stage !== 'detect') return;
  const tab = await getActiveTab();
  const url = tab?.url || '';
  const isCompany = COMPANY_RE.test(url);
  els.companyBlock.classList.toggle('hidden', !isCompany);
  els.btnScrape.classList.toggle('hidden', isCompany);
  if (PROFILE_RE.test(url)) {
    els.pageStatus.textContent = 'LinkedIn profile detected.';
    els.pageStatus.classList.remove('error');
    els.btnScrape.disabled = false;
  } else if (isCompany) {
    els.pageStatus.textContent = 'LinkedIn company page detected.';
    els.pageStatus.classList.remove('error');
  } else {
    els.pageStatus.textContent = 'Open a LinkedIn profile or company page to begin.';
    els.pageStatus.classList.remove('error');
    els.btnScrape.disabled = true;
  }
}

// ---- company people finder -------------------------------------------------
async function doFindPeople() {
  const tab = await getActiveTab();
  if (!tab || !COMPANY_RE.test(tab.url || '')) {
    showToast('Open a LinkedIn company page first');
    return;
  }
  els.btnFindPeople.disabled = true;
  els.peopleStatus.className = 'status busy';
  els.peopleStatus.textContent = 'Searching people… (opens background tabs, one search at a time — this takes a minute)';
  els.peopleList.innerHTML = '';

  const resp = await sendMsg({
    type: MSG.FIND_PEOPLE,
    payload: { tabId: tab.id, companyUrl: tab.url },
  });

  els.btnFindPeople.disabled = false;
  if (!resp?.ok) {
    els.peopleStatus.className = 'status error';
    els.peopleStatus.textContent = resp?.error || 'People search failed.';
    return;
  }

  const people = resp.people || [];
  els.peopleStatus.className = 'status';
  els.peopleStatus.textContent = '';
  els.variants.innerHTML = '';
  els.callnotes.innerHTML = '';
  lastVariants = [];
  renderPeople(people);
  showResults('people', `${resp.company?.name || 'Company'} · ${people.length} people, ranked`, 'detect');

  await addHistoryEntry({
    id: crypto.randomUUID(),
    kind: 'people',
    name: resp.company?.name || '(company)',
    profileUrl: tab.url,
    headline: resp.company?.tagline || '',
    scrapedAt: new Date().toISOString(),
    company: resp.company,
    people,
  });
}

function renderPeople(people) {
  els.peopleList.innerHTML = '';
  for (const p of people) {
    const card = document.createElement('div');
    card.className = 'person';

    const head = document.createElement('div');
    head.className = 'person-head';
    const score = document.createElement('span');
    score.className = 'badge ' + ((p.score || 0) >= 7 ? 'ok' : 'empty');
    score.textContent = `${p.score ?? '?'}/10`;
    const name = document.createElement('span');
    name.className = 'person-name';
    name.textContent = p.name;
    head.append(score, name);
    card.append(head);

    if (p.title) {
      const title = document.createElement('div');
      title.className = 'person-title';
      title.textContent = p.title;
      card.append(title);
    }
    if (p.why) {
      const why = document.createElement('div');
      why.className = 'person-why';
      why.textContent = p.why;
      card.append(why);
    }
    if (p.angle) {
      const angle = document.createElement('div');
      angle.className = 'person-angle';
      angle.textContent = `Angle: ${p.angle}`;
      card.append(angle);
    }

    const actions = document.createElement('div');
    actions.className = 'variant-actions';
    const open = document.createElement('button');
    open.className = 'copy';
    open.textContent = 'Open profile →';
    open.onclick = () => chrome.tabs.create({ url: p.url });
    actions.append(open);
    card.append(actions);

    els.peopleList.append(card);
  }
}

// ---- scrape --------------------------------------------------------------
function setBadge(key, status) {
  const el = document.querySelector(`[data-badge="${key}"]`);
  if (!el) return;
  el.className = 'badge ' + status;
  el.textContent = status === 'ok' ? 'read' : status === 'empty' ? 'not found' : 'error';
}

async function doScrape() {
  const tab = await getActiveTab();
  if (!tab || !PROFILE_RE.test(tab.url || '')) {
    els.pageStatus.textContent = 'This is not a LinkedIn profile page.';
    els.pageStatus.classList.add('error');
    return;
  }
  els.btnScrape.disabled = true;
  els.pageStatus.textContent = 'Reading profile…';
  els.pageStatus.classList.remove('error');

  const resp = await sendMsg({ type: MSG.SCRAPE_PROFILE, tabId: tab.id });

  els.btnScrape.disabled = false;
  if (!resp?.ok) {
    els.pageStatus.textContent = resp?.error || 'Scrape failed.';
    els.pageStatus.classList.add('error');
    return;
  }

  const { fields, url } = resp.data;
  currentProfileUrl = url || tab.url;

  els.fName.value = toText(fields.name?.value);
  els.fHeadline.value = toText(fields.headline?.value);
  els.fExperience.value = toText(fields.experience?.value);
  els.fAbout.value = toText(fields.about?.value);
  els.fActivity.value = toText(fields.activity?.value);
  els.fResearch.value = '';
  els.researchStatus.textContent = '';

  setBadge('name', fields.name?.status || 'failed');
  setBadge('headline', fields.headline?.status || 'failed');
  setBadge('experience', fields.experience?.status || 'failed');
  setBadge('about', fields.about?.status || 'failed');
  setBadge('activity', fields.activity?.status || 'failed');

  await populateTemplates();
  applyChannelUI();

  // Prospect identity card + read-count; raw fields stay behind the accordion.
  updateProspectCard();
  const read = ['name', 'headline', 'experience', 'about', 'activity'].filter(
    (k) => fields[k]?.status === 'ok',
  ).length;
  els.scrapeSummary.textContent = `${read}/5 read · edit`;
  els.reviewDetails.open = false;
  els.researchDetails.open = false;

  currentEntryId = null;
  lastVariants = [];
  foundEmails = [];
  foundPhones = [];
  renderContacts();
  els.variants.innerHTML = '';
  els.callnotes.innerHTML = '';
  els.peopleList.innerHTML = '';
  els.genStatus.textContent = '';
  els.contactStatus.textContent = '';
  setStage('compose');
}

function updateProspectCard() {
  const name = els.fName.value.trim() || 'Unknown prospect';
  els.prospectName.textContent = name;
  els.prospectHeadline.textContent = els.fHeadline.value.trim();
  els.prospectAvatar.textContent = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

// ---- channel + contact lookup -------------------------------------------
function applyChannelUI() {
  els.contactBlock.classList.toggle('hidden', currentChannel === 'linkedin');
  els.designField.classList.toggle('hidden', currentChannel !== 'email');
  // Re-render any existing variants so subject fields / action buttons match.
  if (lastVariants.length) renderVariants(lastVariants, currentEntryId, currentChannel);
}

// Email look (natural vs designed). Rendering needs the signature/CTA
// settings, so keep the latest settings snapshot around.
let designSettings = { senderName: '', ctaUrl: '' };
let currentDesign = 'plain';

function setDesign(d) {
  currentDesign = d;
  els.designPills.querySelectorAll('.pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.design === d);
  });
  // Re-render so any open previews pick up the new look.
  if (lastVariants.length) renderVariants(lastVariants, currentEntryId, currentChannel);
}

async function populateDesigns() {
  const s = await getSettings();
  designSettings = { senderName: s.senderName || '', ctaUrl: s.ctaUrl || '' };
  setDesign(s.emailDesign || 'plain');
}

function currentEmailHtml(bodyText) {
  // 'plain' (natural) returns null -> gmail.js sends text/plain only.
  return renderEmailHtml(currentDesign, {
    bodyText,
    senderName: designSettings.senderName,
    ctaText: 'Book a quick call',
    ctaUrl: designSettings.ctaUrl,
  });
}

async function doFindContact() {
  if (!currentProfileUrl) {
    showToast('Scrape a profile first');
    return;
  }
  els.btnFindContact.disabled = true;
  els.contactStatus.textContent = 'Looking up…';

  const resp = await sendMsg({ type: MSG.FIND_CONTACT, profileUrl: currentProfileUrl });

  els.btnFindContact.disabled = false;
  if (!resp?.ok) {
    els.contactStatus.textContent =
      resp?.code === 'NO_KEY' ? 'No SignalHire key — add one in Settings (⚙).' : resp?.error || 'Lookup failed.';
    return;
  }

  foundEmails = resp.emails || [];
  foundPhones = resp.phones || [];
  renderContacts();
  els.contactStatus.textContent =
    foundEmails.length || foundPhones.length
      ? `Found ${foundEmails.length} email(s), ${foundPhones.length} phone(s) — pick one.`
      : 'No contacts found for this profile.';
}

// Renders every found email/phone as a selectable radio row, plus a "type your
// own" row. The selected row is read at send time.
function renderContacts() {
  renderContactGroup(els.emailList, 'email', foundEmails, 'type an email…');
  renderContactGroup(els.phoneList, 'phone', foundPhones, 'type a phone (with country code)…');
  els.emailCount.textContent = foundEmails.length ? `· ${foundEmails.length}` : '';
  els.phoneCount.textContent = foundPhones.length ? `· ${foundPhones.length}` : '';
}

function renderContactGroup(container, kind, items, placeholder) {
  container.innerHTML = '';
  const group = `rs-${kind}`;

  items.forEach((it, idx) => {
    const row = document.createElement('label');
    row.className = 'contact-opt';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = group;
    radio.value = it.value;
    if (idx === 0) radio.checked = true;
    const val = document.createElement('span');
    val.className = 'contact-opt-value';
    val.textContent = it.value;
    row.append(radio, val);
    const tag = [it.subType, it.rating ? `${it.rating}%` : ''].filter(Boolean).join(' · ');
    if (tag) {
      const b = document.createElement('span');
      b.className = 'badge ' + (it.rating >= 100 ? 'ok' : 'empty');
      b.textContent = tag;
      row.append(b);
    }
    container.append(row);
  });

  // "Other" / custom row.
  const customRow = document.createElement('label');
  customRow.className = 'contact-opt';
  const customRadio = document.createElement('input');
  customRadio.type = 'radio';
  customRadio.name = group;
  customRadio.value = '__custom__';
  if (!items.length) customRadio.checked = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'contact-custom';
  input.placeholder = placeholder;
  input.addEventListener('focus', () => (customRadio.checked = true));
  input.addEventListener('input', () => (customRadio.checked = true));
  customRow.append(customRadio, input);
  container.append(customRow);
}

function getSelectedContact(kind) {
  const checked = document.querySelector(`input[name="rs-${kind}"]:checked`);
  if (!checked) return '';
  if (checked.value === '__custom__') {
    const input = checked.parentElement.querySelector('.contact-custom');
    return input ? input.value.trim() : '';
  }
  return checked.value;
}

function openWhatsApp(body) {
  const digits = getSelectedContact('phone').replace(/[^\d]/g, '');
  if (!digits) {
    showToast('Pick or type a phone number first');
    return;
  }
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(body || '')}`;
  chrome.tabs.create({ url });
}

async function sendEmailMessage(subject, body, btn) {
  const to = getSelectedContact('email');
  if (!to) {
    showToast('Pick or type a recipient email first');
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const html = currentEmailHtml(body); // null for the plain design
  const resp = await sendMsg({ type: MSG.SEND_EMAIL, payload: { to, subject, body, html } });
  btn.disabled = false;
  btn.textContent = original;
  showToast(resp?.ok ? `Email sent to ${to}` : resp?.error || 'Send failed');
}

// ---- fetch full activity (Phase 2, opt-in) -------------------------------
async function doFetchActivity() {
  if (!currentProfileUrl) {
    showToast('Scrape a profile first');
    return;
  }
  els.btnActivity.disabled = true;
  const original = els.btnActivity.textContent;
  els.btnActivity.textContent = 'Fetching… (background tab)';

  const resp = await sendMsg({ type: MSG.FETCH_ACTIVITY, profileUrl: currentProfileUrl });

  els.btnActivity.disabled = false;
  els.btnActivity.textContent = original;

  if (!resp?.ok) {
    showToast(resp?.error || 'Could not fetch activity');
    return;
  }
  const posts = resp.posts || [];
  if (!posts.length) {
    showToast('No posts found on the activity page');
    return;
  }

  // Merge into the activity field, skipping anything already present.
  const existing = els.fActivity.value.trim();
  const fresh = posts.filter((p) => !existing.includes(p));
  const combined = [existing, ...fresh].filter(Boolean).join('\n\n');
  els.fActivity.value = combined;
  setBadge('activity', 'ok');
  showToast(`Added ${fresh.length} post(s)`);
}

// ---- template picker -----------------------------------------------------
async function populateTemplates() {
  const s = await getSettings();
  const tpls = s.templates || [];
  const cur = els.fTemplate.value;
  els.fTemplate.innerHTML = '';

  if (!tpls.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(No templates — base style only)';
    els.fTemplate.append(o);
    return;
  }

  for (const t of tpls) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name || '(untitled)';
    els.fTemplate.append(o);
  }
  const ids = tpls.map((t) => t.id);
  els.fTemplate.value = ids.includes(cur)
    ? cur
    : ids.includes(s.defaultTemplateId)
      ? s.defaultTemplateId
      : tpls[0].id;
}

// ---- generate ------------------------------------------------------------
async function doGenerate() {
  const scraped = currentScraped();
  const templateId = els.fTemplate.value;
  const channel = currentChannel;

  els.btnGenerate.disabled = true;
  els.genStatus.className = 'status busy';
  els.genStatus.textContent = 'Generating messages…';
  els.variants.innerHTML = '';

  const resp = await sendMsg({ type: MSG.GENERATE, payload: { scraped, templateId, channel } });

  els.btnGenerate.disabled = false;

  if (!resp?.ok) {
    els.genStatus.className = 'status error';
    if (resp?.code === 'NO_KEY') {
      els.genStatus.innerHTML = '';
      els.genStatus.append('No API key set. ');
      const link = document.createElement('button');
      link.className = 'row-link';
      link.textContent = 'Open Settings';
      link.onclick = () => chrome.runtime.openOptionsPage();
      els.genStatus.append(link);
    } else {
      els.genStatus.textContent = resp?.error || 'Generation failed.';
    }
    return;
  }

  els.genStatus.className = 'status';
  els.genStatus.textContent = '';

  const variants = resp.variants || [];
  if (!variants.length) {
    els.genStatus.className = 'status error';
    els.genStatus.textContent = 'No variants were returned. Try again.';
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    name: scraped.name || '(unknown)',
    profileUrl: currentProfileUrl || '',
    headline: scraped.headline || '',
    scrapedSnapshot: scraped,
    scrapedAt: new Date().toISOString(),
    provider: resp.provider || '',
    model: resp.model || '',
    template: resp.templateName || '',
    channel,
    variants,
    chosenVariantIndex: null,
    copiedAt: null,
  };
  await addHistoryEntry(entry);
  currentEntryId = entry.id;
  lastVariants = variants;

  renderVariants(variants, entry.id, channel);
  showResults('variants', `${scraped.name || 'Prospect'} · ${CHANNEL_LABELS[channel]}`, 'compose');
}

// ---- call-prep notes -------------------------------------------------------
function currentScraped() {
  return {
    name: els.fName.value.trim(),
    headline: els.fHeadline.value.trim(),
    experience: els.fExperience.value.trim(),
    about: els.fAbout.value.trim(),
    activity: els.fActivity.value.trim(),
    research: els.fResearch.value.trim(),
  };
}

// ---- deep research ---------------------------------------------------------
async function doResearch() {
  const scraped = currentScraped();
  if (!scraped.name && !scraped.headline) {
    showToast('Scrape a profile first');
    return;
  }
  els.btnResearch.disabled = true;
  const original = els.btnResearch.textContent;
  els.btnResearch.textContent = 'Researching… (30-60s)';
  els.researchStatus.textContent = '';

  const resp = await sendMsg({ type: MSG.RESEARCH, payload: { scraped } });

  els.btnResearch.disabled = false;
  els.btnResearch.textContent = original;

  if (!resp?.ok) {
    els.researchStatus.textContent = '';
    showToast(
      resp?.code === 'NO_KEY' ? 'No API key set — add one in Settings (⚙)' : resp?.error || 'Research failed',
    );
    return;
  }
  els.fResearch.value = resp.brief || '';
  els.researchStatus.textContent = 'web-searched ✓';
  els.researchDetails.open = true;
  showToast('Research brief ready — review and edit');
}

function notesToMarkdown(name, n) {
  const lines = [`# Call notes — ${name || 'prospect'}`, '', n.snapshot || '', ''];
  if (n.hooks?.length) lines.push('## Hooks', ...n.hooks.map((h) => `- ${h}`), '');
  if (n.pitchAngles?.length) {
    lines.push('## Pitch angles');
    for (const p of n.pitchAngles) lines.push(`- **${p.angle}** — ${p.talkTrack}`);
    lines.push('');
  }
  if (n.discoveryQuestions?.length)
    lines.push('## Discovery questions', ...n.discoveryQuestions.map((q) => `- ${q}`), '');
  if (n.objections?.length) {
    lines.push('## Likely objections');
    for (const o of n.objections) lines.push(`- **"${o.objection}"** → ${o.response}`);
    lines.push('');
  }
  if (n.nextStep) lines.push('## Next step', n.nextStep);
  return lines.join('\n');
}

async function doGenerateNotes() {
  const scraped = currentScraped();

  els.btnCallNotes.disabled = true;
  els.genStatus.className = 'status busy';
  els.genStatus.textContent = 'Preparing call notes…';
  els.callnotes.classList.add('hidden');

  const resp = await sendMsg({ type: MSG.GENERATE, payload: { scraped, mode: 'callnotes' } });

  els.btnCallNotes.disabled = false;
  if (!resp?.ok) {
    els.genStatus.className = 'status error';
    els.genStatus.textContent =
      resp?.code === 'NO_KEY' ? 'No API key set — add one in Settings (⚙).' : resp?.error || 'Call notes failed.';
    return;
  }

  els.genStatus.className = 'status';
  els.genStatus.textContent = '';
  els.variants.innerHTML = ''; // notes replace messages — one result set at a time
  lastVariants = [];
  renderCallNotes(scraped.name, resp.notes);
  showResults('callnotes', `${scraped.name || 'Prospect'} · Call notes`, 'compose');

  await addHistoryEntry({
    id: crypto.randomUUID(),
    kind: 'callnotes',
    name: scraped.name || '(unknown)',
    profileUrl: currentProfileUrl || '',
    headline: scraped.headline || '',
    scrapedSnapshot: scraped,
    scrapedAt: new Date().toISOString(),
    provider: resp.provider || '',
    model: resp.model || '',
    notes: resp.notes,
  });
}

function notesSection(title, items, renderItem) {
  if (!items || !items.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'notes-section';
  const h = document.createElement('div');
  h.className = 'notes-heading';
  h.textContent = title;
  wrap.append(h);
  const ul = document.createElement('ul');
  ul.className = 'notes-list';
  for (const it of items) {
    const li = document.createElement('li');
    renderItem(li, it);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

function renderCallNotes(name, n) {
  els.callnotes.innerHTML = '';
  els.callnotes.classList.remove('hidden');

  const card = document.createElement('div');
  card.className = 'variant notes-card';

  const head = document.createElement('div');
  head.className = 'variant-head';
  const title = document.createElement('span');
  title.className = 'variant-angle';
  title.textContent = `📋 Call notes — ${name || 'prospect'}`;
  head.append(title);
  card.append(head);

  const snap = document.createElement('p');
  snap.className = 'notes-snapshot';
  snap.textContent = n.snapshot || '';
  card.append(snap);

  const sections = [
    notesSection('Hooks', n.hooks, (li, h) => (li.textContent = h)),
    notesSection('Pitch angles', n.pitchAngles, (li, p) => {
      const b = document.createElement('strong');
      b.textContent = p.angle;
      li.append(b, ` — ${p.talkTrack}`);
    }),
    notesSection('Discovery questions', n.discoveryQuestions, (li, q) => (li.textContent = q)),
    notesSection('Likely objections', n.objections, (li, o) => {
      const b = document.createElement('strong');
      b.textContent = `"${o.objection}"`;
      li.append(b, ` → ${o.response}`);
    }),
  ].filter(Boolean);
  sections.forEach((s) => card.append(s));

  if (n.nextStep) {
    const ns = document.createElement('div');
    ns.className = 'notes-section';
    const h = document.createElement('div');
    h.className = 'notes-heading';
    h.textContent = 'Next step';
    const p = document.createElement('p');
    p.className = 'notes-snapshot';
    p.textContent = n.nextStep;
    ns.append(h, p);
    card.append(ns);
  }

  const actions = document.createElement('div');
  actions.className = 'variant-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy';
  copyBtn.textContent = 'Copy as markdown';
  copyBtn.onclick = async () => {
    const ok = await copyToClipboard(notesToMarkdown(name, n));
    showToast(ok ? 'Notes copied' : 'Copy failed');
  };
  actions.append(copyBtn);
  card.append(actions);

  els.callnotes.append(card);
}

// Tabbed: one variant visible at a time (chips switch), so the panel never
// grows into an endless scroll. Edits write back into the variants array, so
// switching tabs / channels / designs never loses a tweak.
function renderVariants(variants, entryId, channel) {
  els.variants.innerHTML = '';
  if (!variants.length) return;

  const tabs = document.createElement('div');
  tabs.className = 'variant-tabs';
  const holder = document.createElement('div');

  const chips = variants.map((v, i) => {
    const chip = document.createElement('button');
    chip.className = 'variant-tab';
    chip.textContent = v.angle ? v.angle.slice(0, 26) : `Variant ${i + 1}`;
    chip.onclick = () => show(i);
    tabs.append(chip);
    return chip;
  });

  function show(i) {
    chips.forEach((c, j) => c.classList.toggle('active', j === i));
    holder.innerHTML = '';
    holder.append(buildVariantCard(variants[i], i, entryId, channel));
  }

  els.variants.append(tabs, holder);
  show(0);
}

function buildVariantCard(v, i, entryId, channel) {
  const card = document.createElement('div');
  card.className = 'variant';

  const head = document.createElement('div');
  head.className = 'variant-head';
  const angle = document.createElement('span');
  angle.className = 'variant-angle';
  angle.textContent = v.angle || `Variant ${i + 1}`;
  const words = document.createElement('span');
  words.className = 'variant-words';
  words.textContent = `${wordCount(v.message)} words`;
  head.append(angle, words);
  card.append(head);

  // Email subject (editable) when on the email channel.
  let subjectInput = null;
  if (channel === 'email') {
    subjectInput = document.createElement('input');
    subjectInput.type = 'text';
    subjectInput.className = 'variant-subject';
    subjectInput.value = v.subject || '';
    subjectInput.placeholder = 'subject';
    subjectInput.addEventListener('input', () => {
      v.subject = subjectInput.value; // persist across tab switches
    });
    card.append(subjectInput);
  }

  // Body is editable; edits persist into the variant itself.
  const body = document.createElement('textarea');
  body.className = 'variant-body';
  body.rows = channel === 'email' ? 8 : 5;
  body.value = v.message || '';
  card.append(body);

  // Preview swaps IN PLACE of the editor — never stacked below it.
  let preview = null;
  const refreshPreview = () => {
    if (!preview || preview.classList.contains('hidden')) return;
    const html = currentEmailHtml(body.value);
    preview.srcdoc =
      html ||
      `<pre style="margin:0;padding:12px;font:13px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap;">${(body.value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')}</pre>`;
  };
  if (channel === 'email') {
    preview = document.createElement('iframe');
    preview.className = 'variant-preview hidden';
    preview.setAttribute('sandbox', ''); // static preview: no scripts, no navigation
    card.append(preview);
  }
  body.addEventListener('input', () => {
    v.message = body.value; // persist across tab switches
    words.textContent = `${wordCount(body.value)} words`;
    refreshPreview();
  });

  const actions = document.createElement('div');
  actions.className = 'variant-actions';

  if (channel === 'email') {
    const pv = document.createElement('button');
    pv.className = 'small';
    pv.textContent = 'Preview';
    pv.onclick = () => {
      const showingPreview = preview.classList.toggle('hidden') === false;
      body.classList.toggle('hidden', showingPreview);
      pv.textContent = showingPreview ? 'Edit' : 'Preview';
      refreshPreview();
    };
    actions.append(pv);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy';
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = async () => {
    const ok = await copyToClipboard(body.value || '');
    showToast(ok ? 'Copied to clipboard' : 'Copy failed — select the text manually');
    markChosen(entryId, i);
  };
  actions.append(copyBtn);

  if (channel === 'whatsapp') {
    const wa = document.createElement('button');
    wa.className = 'copy send';
    wa.textContent = 'Send on WhatsApp';
    wa.onclick = () => {
      openWhatsApp(body.value);
      markChosen(entryId, i);
    };
    actions.append(wa);
  }

  if (channel === 'email') {
    const em = document.createElement('button');
    em.className = 'copy send';
    em.textContent = 'Send email';
    em.onclick = async () => {
      await sendEmailMessage(subjectInput ? subjectInput.value : '', body.value, em);
      markChosen(entryId, i);
    };
    actions.append(em);
  }

  card.append(actions);
  return card;
}

async function markChosen(entryId, i) {
  if (!entryId) return;
  await updateHistoryEntry(entryId, {
    chosenVariantIndex: i,
    copiedAt: new Date().toISOString(),
  });
}

// ---- history -------------------------------------------------------------
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || '';
  }
}

async function renderHistory() {
  const term = (els.historySearch.value || '').toLowerCase();
  const all = await getHistory();
  const items = term ? all.filter((e) => (e.name || '').toLowerCase().includes(term)) : all;

  els.historyCount.textContent = all.length ? `${all.length} saved` : '';

  els.historyList.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = all.length
      ? 'No matches.'
      : 'No messages yet — scrape a profile to generate your first.';
    els.historyList.append(empty);
    return;
  }

  for (const e of items) {
    els.historyList.append(renderHistoryCard(e));
  }
}

function renderHistoryCard(e) {
  if (e.kind === 'callnotes') return renderNotesHistoryCard(e);
  if (e.kind === 'people') return renderPeopleHistoryCard(e);
  const chosen =
    e.chosenVariantIndex != null && e.variants[e.chosenVariantIndex]
      ? e.variants[e.chosenVariantIndex]
      : e.variants[0];

  const card = document.createElement('div');
  card.className = 'hist';

  const top = document.createElement('div');
  top.className = 'hist-top';
  const name = document.createElement('div');
  name.className = 'hist-name';
  name.textContent = e.name;
  top.append(name);

  const meta = document.createElement('div');
  meta.className = 'hist-meta';
  const metaBits = [e.headline, e.template, e.channel, fmtDate(e.scrapedAt)]
    .filter(Boolean)
    .join(' · ');
  meta.append(document.createTextNode(metaBits + ' '));
  if (e.profileUrl) {
    const a = document.createElement('a');
    a.href = e.profileUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'profile ↗';
    meta.append(a);
  }

  const snippet = document.createElement('div');
  snippet.className = 'hist-snippet';
  snippet.textContent = chosen?.message || '';

  const actions = document.createElement('div');
  actions.className = 'hist-actions';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'small';
  expandBtn.textContent = `Show all ${e.variants.length} variants`;

  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = 'Delete';
  delBtn.onclick = async () => {
    await deleteHistoryEntry(e.id);
    renderHistory();
  };

  const details = document.createElement('div');
  details.className = 'hidden';
  e.variants.forEach((v, i) => {
    const block = document.createElement('div');
    block.className = 'hist-variant';
    const head = document.createElement('div');
    head.className = 'variant-angle';
    head.textContent = v.angle || `Variant ${i + 1}`;
    const txt = document.createElement('div');
    txt.className = 'variant-text';
    txt.textContent = v.message || '';
    const copy = document.createElement('button');
    copy.className = 'copy';
    copy.textContent = 'Copy';
    copy.onclick = async () => {
      const ok = await copyToClipboard(v.message || '');
      showToast(ok ? 'Copied to clipboard' : 'Copy failed');
      if (ok) {
        await updateHistoryEntry(e.id, {
          chosenVariantIndex: i,
          copiedAt: new Date().toISOString(),
        });
      }
    };
    block.append(head, txt, copy);
    details.append(block);
  });

  expandBtn.onclick = () => {
    const hidden = details.classList.toggle('hidden');
    expandBtn.textContent = hidden ? `Show all ${e.variants.length} variants` : 'Hide variants';
  };

  actions.append(expandBtn, delBtn);
  card.append(top, meta, snippet, actions, details);
  return card;
}

function renderPeopleHistoryCard(e) {
  const card = document.createElement('div');
  card.className = 'hist';

  const top = document.createElement('div');
  top.className = 'hist-top';
  const name = document.createElement('div');
  name.className = 'hist-name';
  name.textContent = `🎯 ${e.name}`;
  top.append(name);

  const meta = document.createElement('div');
  meta.className = 'hist-meta';
  meta.append(
    document.createTextNode(
      [`${(e.people || []).length} people`, fmtDate(e.scrapedAt)].filter(Boolean).join(' · ') + ' ',
    ),
  );
  if (e.profileUrl) {
    const a = document.createElement('a');
    a.href = e.profileUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'company ↗';
    meta.append(a);
  }

  const snippet = document.createElement('div');
  snippet.className = 'hist-snippet';
  snippet.textContent = (e.people || [])
    .slice(0, 3)
    .map((p) => `${p.name} (${p.score ?? '?'}/10)`)
    .join(' · ');

  const actions = document.createElement('div');
  actions.className = 'hist-actions';
  const expandBtn = document.createElement('button');
  expandBtn.className = 'small';
  expandBtn.textContent = `Show all ${(e.people || []).length}`;
  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = 'Delete';
  delBtn.onclick = async () => {
    await deleteHistoryEntry(e.id);
    renderHistory();
  };
  actions.append(expandBtn, delBtn);

  const details = document.createElement('div');
  details.className = 'hidden';
  for (const p of e.people || []) {
    const row = document.createElement('div');
    row.className = 'hist-variant';
    const head = document.createElement('div');
    head.className = 'variant-angle';
    head.textContent = `${p.score ?? '?'}/10 — ${p.name}`;
    const txt = document.createElement('div');
    txt.className = 'variant-text';
    txt.textContent = [p.title, p.why].filter(Boolean).join(' · ');
    const open = document.createElement('button');
    open.className = 'copy';
    open.textContent = 'Open profile →';
    open.onclick = () => chrome.tabs.create({ url: p.url });
    row.append(head, txt, open);
    details.append(row);
  }
  expandBtn.onclick = () => {
    const hidden = details.classList.toggle('hidden');
    expandBtn.textContent = hidden ? `Show all ${(e.people || []).length}` : 'Hide';
  };

  card.append(top, meta, snippet, actions, details);
  return card;
}

function renderNotesHistoryCard(e) {
  const card = document.createElement('div');
  card.className = 'hist';

  const top = document.createElement('div');
  top.className = 'hist-top';
  const name = document.createElement('div');
  name.className = 'hist-name';
  name.textContent = `📋 ${e.name}`;
  top.append(name);

  const meta = document.createElement('div');
  meta.className = 'hist-meta';
  meta.append(document.createTextNode([e.headline, 'call notes', fmtDate(e.scrapedAt)].filter(Boolean).join(' · ') + ' '));
  if (e.profileUrl) {
    const a = document.createElement('a');
    a.href = e.profileUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'profile ↗';
    meta.append(a);
  }

  const snippet = document.createElement('div');
  snippet.className = 'hist-snippet';
  snippet.textContent = e.notes?.snapshot || '';

  const actions = document.createElement('div');
  actions.className = 'hist-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'small';
  copyBtn.textContent = 'Copy as markdown';
  copyBtn.onclick = async () => {
    const ok = await copyToClipboard(notesToMarkdown(e.name, e.notes || {}));
    showToast(ok ? 'Notes copied' : 'Copy failed');
  };
  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = 'Delete';
  delBtn.onclick = async () => {
    await deleteHistoryEntry(e.id);
    renderHistory();
  };
  actions.append(copyBtn, delBtn);

  card.append(top, meta, snippet, actions);
  return card;
}

// ---- history export / import --------------------------------------------
async function exportHistory() {
  const hist = await getHistory();
  if (!hist.length) {
    showToast('Nothing to export');
    return;
  }
  const blob = new Blob([JSON.stringify(hist, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `remotestar-outreach-history-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importHistoryFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('not an array');
    const before = (await getHistory()).length;
    const after = (await mergeHistory(data)).length;
    showToast(`Imported ${after - before} new entr${after - before === 1 ? 'y' : 'ies'}`);
    renderHistory();
  } catch {
    showToast('Import failed — invalid JSON file');
  }
}

// ---- Gmail account footer -------------------------------------------------
// Shows which Google account "Send email" will send from. Every teammate signs
// in with their own @remotestar.io account; switching = sign out + re-auth.
async function refreshAccountBar(interactive = false) {
  els.accountStatus.textContent = interactive ? '✉ opening Google sign-in…' : '✉ checking Gmail account…';
  els.accountAction.classList.add('hidden');

  // Interactive sign-in can legitimately take a while (user typing a password),
  // but never let the footer hang forever if the flow dies silently.
  const resp = await Promise.race([
    sendMsg({ type: MSG.GMAIL_STATUS, payload: { interactive } }),
    new Promise((resolve) =>
      setTimeout(
        () => resolve({ ok: false, error: 'Sign-in timed out — look for a hidden Google sign-in window, then try again.' }),
        interactive ? 120000 : 15000,
      ),
    ),
  ]);

  if (resp?.ok && resp.signedIn) {
    els.accountStatus.textContent = `✉ sending as ${resp.email}`;
    els.accountAction.textContent = 'switch';
    els.accountAction.onclick = async () => {
      await sendMsg({ type: MSG.GMAIL_SIGNOUT });
      refreshAccountBar(true);
    };
  } else {
    els.accountStatus.textContent = '✉ Gmail: not signed in';
    els.accountAction.textContent = 'sign in';
    els.accountAction.onclick = () => refreshAccountBar(true);
    // Surface WHY an explicit sign-in attempt failed (e.g. the OAuth client_id
    // in manifest.json is still the placeholder / not created yet).
    if (interactive) {
      const detail = resp?.error || 'Google sign-in failed.';
      showToast(/custom uri scheme|invalid.*client|bad client id/i.test(detail)
        ? 'OAuth client not set up yet — see README "Gmail setup" (client_id in manifest.json is a placeholder)'
        : detail);
    }
  }
  els.accountAction.classList.remove('hidden');
}

// ---- wire up -------------------------------------------------------------
els.tabCompose.onclick = () => showView('compose');
els.tabHistory.onclick = () => showView('history');
els.openOptions.onclick = () => chrome.runtime.openOptionsPage();
els.btnScrape.onclick = doScrape;
els.btnFindPeople.onclick = doFindPeople;
els.btnActivity.onclick = doFetchActivity;
els.btnResearch.onclick = doResearch;
els.channelPills.querySelectorAll('.pill').forEach((p) => {
  p.onclick = () => setChannel(p.dataset.channel);
});
els.designPills.querySelectorAll('.pill').forEach((p) => {
  p.onclick = () => setDesign(p.dataset.design);
});
els.btnBack.onclick = () => {
  setStage(resultsOrigin);
  if (resultsOrigin === 'detect') detectPage();
};
els.btnRestart.onclick = () => {
  setStage('detect');
  detectPage();
};
// Keep the identity card in sync with manual edits to the raw fields.
els.fName.addEventListener('input', updateProspectCard);
els.fHeadline.addEventListener('input', updateProspectCard);
els.btnFindContact.onclick = doFindContact;
els.btnGenerate.onclick = doGenerate;
els.btnCallNotes.onclick = doGenerateNotes;
els.btnExport.onclick = exportHistory;
els.btnImport.onclick = () => els.importFile.click();
els.importFile.onchange = (e) => {
  const file = e.target.files?.[0];
  if (file) importHistoryFile(file);
  els.importFile.value = '';
};
els.btnClearHistory.onclick = async () => {
  await clearHistory();
  renderHistory();
};
els.historySearch.oninput = () => renderHistory();

// Keep the page-detection status fresh as the user navigates.
chrome.tabs.onActivated.addListener(() => detectPage());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete' || info.url) detectPage();
});

setStage('detect');
detectPage();
populateTemplates();
populateDesigns();
refreshAccountBar();
getSettings().then((s) => {
  setChannel(s.defaultChannel || 'linkedin');
});
