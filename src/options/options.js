import { getSettings, saveSettings } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
const el = {
  provider: $('provider'),
  apiKey: $('apiKey'),
  apiKeyLabel: $('apiKeyLabel'),
  model: $('model'),
  modelHint: $('modelHint'),
  temperature: $('temperature'),
  tempVal: $('tempVal'),
  signalhireKey: $('signalhireKey'),
  defaultChannel: $('defaultChannel'),
  emailDesign: $('emailDesign'),
  senderName: $('senderName'),
  senderRole: $('senderRole'),
  ctaUrl: $('ctaUrl'),
  peopleKeywords: $('peopleKeywords'),
  globalRules: $('globalRules'),
  styleDescription: $('styleDescription'),
  templates: $('templates'),
  addTemplate: $('add-template'),
  defaultTemplate: $('defaultTemplate'),
  remoteStarContext: $('remoteStarContext'),
  promptTemplate: $('promptTemplate'),
  status: $('status'),
};
const tplTemplate = $('tpl-template');
const exTemplate = $('tpl-example');

// ---- provider key/model (per-provider, swapped on dropdown change) -------
const keys = { openai: '', anthropic: '' };
const models = { openai: '', anthropic: '' };
let currentProvider = 'openai';

const PROVIDER_META = {
  openai: { label: 'OpenAI API key', placeholder: 'sk-…', modelHint: 'e.g. gpt-4o-mini — confirm the exact id in your OpenAI dashboard.' },
  anthropic: { label: 'Anthropic API key', placeholder: 'sk-ant-…', modelHint: 'e.g. claude-opus-4-8 — confirm the exact id in your Anthropic console.' },
};

function applyProviderUI(provider) {
  const meta = PROVIDER_META[provider];
  el.apiKeyLabel.textContent = meta.label;
  el.apiKey.placeholder = meta.placeholder;
  el.modelHint.textContent = meta.modelHint;
  el.apiKey.value = keys[provider] || '';
  el.model.value = models[provider] || '';
}

el.temperature.addEventListener('input', () => {
  el.tempVal.textContent = el.temperature.value;
});

el.provider.addEventListener('change', () => {
  keys[currentProvider] = el.apiKey.value.trim();
  models[currentProvider] = el.model.value.trim();
  currentProvider = el.provider.value;
  applyProviderUI(currentProvider);
});

// ---- templates -----------------------------------------------------------
function newId() {
  return 'tpl-' + crypto.randomUUID();
}

function addExampleBlock(examplesEl, text) {
  const node = exTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.tpl-example-text').value = text || '';
  node.querySelector('.tpl-example-del').addEventListener('click', () => node.remove());
  examplesEl.append(node);
}

function addTemplateBlock(tpl) {
  const t = tpl || { id: newId(), name: '', instructions: '', examples: [''] };
  const node = tplTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = t.id || newId();
  node.querySelector('.tpl-name').value = t.name || '';
  node.querySelector('.tpl-instructions').value = t.instructions || '';

  const examplesEl = node.querySelector('.tpl-examples');
  const examples = t.examples && t.examples.length ? t.examples : [''];
  examples.forEach((ex) => addExampleBlock(examplesEl, ex));

  node.querySelector('.tpl-name').addEventListener('input', refreshDefaultSelect);
  node.querySelector('.tpl-add-example').addEventListener('click', () => addExampleBlock(examplesEl, ''));
  node.querySelector('.tpl-del').addEventListener('click', () => {
    node.remove();
    refreshDefaultSelect();
  });

  el.templates.append(node);
}

function readTemplates() {
  return Array.from(el.templates.querySelectorAll('.template')).map((node) => ({
    id: node.dataset.id || newId(),
    name: node.querySelector('.tpl-name').value.trim(),
    instructions: node.querySelector('.tpl-instructions').value.trim(),
    examples: Array.from(node.querySelectorAll('.tpl-example-text'))
      .map((t) => t.value.trim())
      .filter(Boolean),
  }));
}

function refreshDefaultSelect() {
  const prev = el.defaultTemplate.value;
  el.defaultTemplate.innerHTML = '';
  const blocks = Array.from(el.templates.querySelectorAll('.template'));
  if (!blocks.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(none)';
    el.defaultTemplate.append(o);
    return;
  }
  for (const node of blocks) {
    const o = document.createElement('option');
    o.value = node.dataset.id;
    o.textContent = node.querySelector('.tpl-name').value.trim() || '(untitled)';
    el.defaultTemplate.append(o);
  }
  const ids = blocks.map((b) => b.dataset.id);
  el.defaultTemplate.value = ids.includes(prev) ? prev : ids[0];
}

el.addTemplate.addEventListener('click', () => {
  addTemplateBlock();
  refreshDefaultSelect();
});

// ---- team setup: settings export / import ---------------------------------
// Everything in one JSON file (INCLUDING API keys — share privately). Import
// overwrites all settings except senderName, which stays personal.
$('export-settings').addEventListener('click', async () => {
  const s = await getSettings();
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'remotestar-outreach-settings.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('import-settings').addEventListener('click', () => $('import-settings-file').click());
$('import-settings-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming || typeof incoming !== 'object' || !('provider' in incoming)) {
      throw new Error('not a settings file');
    }
    const mine = await getSettings();
    delete incoming.senderName; // keep the teammate's own identity
    delete incoming.senderRole;
    await saveSettings({ ...incoming, senderName: mine.senderName, senderRole: mine.senderRole });
    await load(); // re-render the form with imported values
    el.status.className = 'status ok';
    el.status.textContent = 'Settings imported — set "Your name" and "Your role", then save.';
  } catch {
    el.status.className = 'status error';
    el.status.textContent = 'Import failed — that does not look like a settings export.';
  }
});

// ---- load / save ---------------------------------------------------------
async function load() {
  const s = await getSettings();

  keys.openai = s.keys.openai || '';
  keys.anthropic = s.keys.anthropic || '';
  models.openai = s.models.openai || '';
  models.anthropic = s.models.anthropic || '';
  currentProvider = s.provider || 'openai';
  el.provider.value = currentProvider;
  applyProviderUI(currentProvider);

  el.temperature.value = s.temperature;
  el.tempVal.textContent = s.temperature;
  el.signalhireKey.value = s.signalhireKey || '';
  el.defaultChannel.value = s.defaultChannel || 'linkedin';
  el.emailDesign.value = s.emailDesign || 'clean';
  el.senderName.value = s.senderName || '';
  el.senderRole.value = s.senderRole || 'Founding Engineer';
  el.ctaUrl.value = s.ctaUrl || '';
  el.peopleKeywords.value = (s.peopleKeywords || []).join('\n');
  el.globalRules.value = s.globalRules;
  el.styleDescription.value = s.styleDescription;
  el.remoteStarContext.value = s.remoteStarContext;
  el.promptTemplate.value = s.promptTemplate;

  el.templates.innerHTML = '';
  (s.templates || []).forEach((t) => addTemplateBlock(t));
  refreshDefaultSelect();
  if (s.defaultTemplateId) el.defaultTemplate.value = s.defaultTemplateId;
}

$('save').addEventListener('click', async () => {
  keys[currentProvider] = el.apiKey.value.trim();
  models[currentProvider] = el.model.value.trim();

  await saveSettings({
    provider: currentProvider,
    keys: { ...keys },
    models: {
      openai: models.openai || 'gpt-4o-mini',
      anthropic: models.anthropic || 'claude-opus-4-8',
    },
    temperature: parseFloat(el.temperature.value),
    signalhireKey: el.signalhireKey.value.trim(),
    defaultChannel: el.defaultChannel.value,
    emailDesign: el.emailDesign.value,
    senderName: el.senderName.value.trim(),
    senderRole: el.senderRole.value.trim() || 'Founding Engineer',
    ctaUrl: el.ctaUrl.value.trim(),
    peopleKeywords: el.peopleKeywords.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    globalRules: el.globalRules.value,
    styleDescription: el.styleDescription.value,
    templates: readTemplates(),
    defaultTemplateId: el.defaultTemplate.value,
    remoteStarContext: el.remoteStarContext.value,
    promptTemplate: el.promptTemplate.value,
  });

  el.status.className = 'status ok';
  el.status.textContent = 'Saved.';
  setTimeout(() => {
    el.status.textContent = '';
  }, 2000);
});

load();
