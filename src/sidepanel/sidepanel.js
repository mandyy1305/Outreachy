import { MSG } from '../lib/messages.js';
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
  review: $('review'),
  fName: $('f-name'),
  fHeadline: $('f-headline'),
  fExperience: $('f-experience'),
  fAbout: $('f-about'),
  fActivity: $('f-activity'),
  btnActivity: $('btn-activity'),
  fTemplate: $('f-template'),
  fChannel: $('f-channel'),
  contactBlock: $('contact-block'),
  btnFindContact: $('btn-find-contact'),
  contactStatus: $('contact-status'),
  emailList: $('email-list'),
  phoneList: $('phone-list'),
  emailCount: $('email-count'),
  phoneCount: $('phone-count'),
  btnGenerate: $('btn-generate'),
  genStatus: $('gen-status'),
  variants: $('variants'),
  historySearch: $('history-search'),
  historyList: $('history-list'),
  historyCount: $('history-count'),
  btnExport: $('btn-export'),
  btnImport: $('btn-import'),
  importFile: $('import-file'),
  btnClearHistory: $('btn-clear-history'),
  toast: $('toast'),
};

// ---- module state --------------------------------------------------------
let currentProfileUrl = '';
let currentEntryId = null;
let toastTimer = null;
let lastVariants = []; // kept so we can re-render when the channel changes
let foundEmails = []; // [{value, rating, subType}]
let foundPhones = [];

// ---- helpers -------------------------------------------------------------
function sendMsg(message) {
  return chrome.runtime.sendMessage(message);
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
  } else {
    renderHistory();
  }
}

// ---- page detection ------------------------------------------------------
async function detectPage() {
  const tab = await getActiveTab();
  const url = tab?.url || '';
  if (PROFILE_RE.test(url)) {
    els.pageStatus.textContent = 'LinkedIn profile detected — ready to scrape.';
    els.pageStatus.classList.remove('error');
    els.btnScrape.disabled = false;
  } else {
    els.pageStatus.textContent = 'Open a LinkedIn profile (linkedin.com/in/…) to begin.';
    els.pageStatus.classList.remove('error');
    els.btnScrape.disabled = true;
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

  setBadge('name', fields.name?.status || 'failed');
  setBadge('headline', fields.headline?.status || 'failed');
  setBadge('experience', fields.experience?.status || 'failed');
  setBadge('about', fields.about?.status || 'failed');
  setBadge('activity', fields.activity?.status || 'failed');

  await populateTemplates();
  applyChannelUI();

  els.review.classList.remove('hidden');
  els.pageStatus.textContent = 'Review the details below, then generate.';

  currentEntryId = null;
  lastVariants = [];
  foundEmails = [];
  foundPhones = [];
  renderContacts();
  els.variants.innerHTML = '';
  els.genStatus.textContent = '';
  els.contactStatus.textContent = '';
}

// ---- channel + contact lookup -------------------------------------------
function applyChannelUI() {
  const channel = els.fChannel.value;
  els.contactBlock.classList.toggle('hidden', channel === 'linkedin');
  // Re-render any existing variants so subject fields / action buttons match.
  if (lastVariants.length) renderVariants(lastVariants, currentEntryId, channel);
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
  const resp = await sendMsg({ type: MSG.SEND_EMAIL, payload: { to, subject, body } });
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
  const scraped = {
    name: els.fName.value.trim(),
    headline: els.fHeadline.value.trim(),
    experience: els.fExperience.value.trim(),
    about: els.fAbout.value.trim(),
    activity: els.fActivity.value.trim(),
  };
  const templateId = els.fTemplate.value;
  const channel = els.fChannel.value;

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
}

function renderVariants(variants, entryId, channel) {
  els.variants.innerHTML = '';
  variants.forEach((v, i) => {
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
      card.append(subjectInput);
    }

    // Body is editable so you can tweak before copying/sending.
    const body = document.createElement('textarea');
    body.className = 'variant-body';
    body.rows = channel === 'email' ? 6 : 4;
    body.value = v.message || '';
    body.addEventListener('input', () => {
      words.textContent = `${wordCount(body.value)} words`;
    });
    card.append(body);

    const actions = document.createElement('div');
    actions.className = 'variant-actions';

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
    els.variants.append(card);
  });
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

// ---- wire up -------------------------------------------------------------
els.tabCompose.onclick = () => showView('compose');
els.tabHistory.onclick = () => showView('history');
els.openOptions.onclick = () => chrome.runtime.openOptionsPage();
els.btnScrape.onclick = doScrape;
els.btnActivity.onclick = doFetchActivity;
els.fChannel.onchange = applyChannelUI;
els.btnFindContact.onclick = doFindContact;
els.btnGenerate.onclick = doGenerate;
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

detectPage();
populateTemplates();
getSettings().then((s) => {
  els.fChannel.value = s.defaultChannel || 'linkedin';
  applyChannelUI();
});
