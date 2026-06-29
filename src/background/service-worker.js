// Background service worker (ES module). Jobs:
//  1. Make the toolbar icon open the side panel.
//  2. Route side-panel messages: inject the profile scraper, run the LLM
//     (provider-switched), and fetch full activity from a background tab.
// API keys live only here and in the privileged extension pages — never in a
// content script that shares LinkedIn's tab.

import { MSG } from '../lib/messages.js';
import { getSettings } from '../lib/storage.js';
import { buildSystemPrompt, buildUserPrompt, VARIANTS_SCHEMA } from '../lib/prompt.js';
import { generate as openaiGenerate } from '../lib/llm-openai.js';
import { generate as anthropicGenerate } from '../lib/llm-anthropic.js';
import { lookupContact } from '../lib/signalhire.js';
import { sendEmail } from '../lib/gmail.js';

const ADAPTERS = { openai: openaiGenerate, anthropic: anthropicGenerate };

// Clicking the toolbar icon opens the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === MSG.SCRAPE_PROFILE) {
    handleScrape(msg.tabId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === MSG.GENERATE) {
    handleGenerate(msg.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) =>
        sendResponse({ ok: false, error: e.message, code: e.code, raw: e.raw }),
      );
    return true;
  }
  if (msg?.type === MSG.FETCH_ACTIVITY) {
    handleFetchActivity(msg.profileUrl)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === MSG.FIND_CONTACT) {
    handleFindContact(msg.profileUrl)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
    return true;
  }
  if (msg?.type === MSG.SEND_EMAIL) {
    sendEmail(msg.payload || {})
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});

async function handleFindContact(profileUrl) {
  const settings = await getSettings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await lookupContact({
      apiKey: settings.signalhireKey,
      profileUrl,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleScrape(tabId) {
  if (!tabId) throw new Error('No active tab to scrape.');
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/selectors.js', 'src/content/scraper.js'],
    });
  } catch (e) {
    throw new Error(`Could not read this page (${e.message}). Make sure you are on a LinkedIn profile.`);
  }
  const data = results?.[results.length - 1]?.result;
  if (!data || data.error) {
    throw new Error(data?.error || 'Scrape returned no data. Is this a LinkedIn profile page?');
  }
  return data;
}

async function handleGenerate(payload) {
  const settings = await getSettings();
  const provider = settings.provider || 'openai';
  const apiKey = settings.keys?.[provider] || '';
  const model = settings.models?.[provider] || '';
  if (!apiKey) {
    const e = new Error(`No ${provider} API key set. Open Settings to add one.`);
    e.code = 'NO_KEY';
    throw e;
  }

  const gen = ADAPTERS[provider] || openaiGenerate;
  const template =
    (settings.templates || []).find((t) => t.id === payload.templateId) || null;
  const channel = payload.channel || settings.defaultChannel || 'linkedin';
  const system = buildSystemPrompt(settings, template, channel);
  const user = buildUserPrompt(payload.scraped);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const variants = await gen({
      apiKey,
      model,
      temperature: settings.temperature,
      system,
      user,
      schema: VARIANTS_SCHEMA,
      signal: controller.signal,
    });
    return { variants, model, provider, templateName: template?.name || '' };
  } finally {
    clearTimeout(timeout);
  }
}

// Phase 2 (opt-in): open the prospect's activity page in a BACKGROUND tab,
// scrape more posts, then close it. This navigates LinkedIn programmatically —
// the side panel surfaces that and keeps it user-initiated, one profile at a time.
async function handleFetchActivity(profileUrl) {
  const activityUrl = toActivityUrl(profileUrl);
  if (!activityUrl) throw new Error('Could not derive the activity URL from this profile.');

  const tab = await chrome.tabs.create({ url: activityUrl, active: false });
  try {
    await waitForTabComplete(tab.id, 20000);
    await delay(2500); // let lazily-loaded posts render
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/activity-scraper.js'],
    });
    const data = results?.[results.length - 1]?.result;
    return { posts: (data && data.posts) || [] };
  } finally {
    if (tab?.id != null) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* tab may already be closed */
      }
    }
  }
}

function toActivityUrl(profileUrl) {
  try {
    const u = new URL(profileUrl);
    const m = u.pathname.match(/\/in\/([^/]+)/);
    if (!m) return null;
    return `https://www.linkedin.com/in/${m[1]}/recent-activity/all/`;
  } catch {
    return null;
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
