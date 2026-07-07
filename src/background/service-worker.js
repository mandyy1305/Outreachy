// Background service worker (ES module). Jobs:
//  1. Make the toolbar icon open the side panel.
//  2. Route side-panel messages: inject the profile scraper, run the LLM
//     (provider-switched), and fetch full activity from a background tab.
// API keys live only here and in the privileged extension pages — never in a
// content script that shares LinkedIn's tab.

import { MSG } from '../lib/messages.js';
import { getSettings } from '../lib/storage.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildCallNotesSystemPrompt,
  buildPeopleRankPrompt,
  VARIANTS_SCHEMA,
  CALL_NOTES_SCHEMA,
  PEOPLE_RANK_SCHEMA,
} from '../lib/prompt.js';
import { generate as openaiGenerate } from '../lib/llm-openai.js';
import { generate as anthropicGenerate } from '../lib/llm-anthropic.js';
import { lookupContact } from '../lib/signalhire.js';
import { sendEmail, getAccountStatus, signOut } from '../lib/gmail.js';
import { research } from '../lib/research.js';

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
  if (msg?.type === MSG.RESEARCH) {
    handleResearch(msg.payload || {})
      .then((brief) => sendResponse({ ok: true, brief }))
      .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
    return true;
  }
  if (msg?.type === MSG.FIND_PEOPLE) {
    handleFindPeople(msg.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === MSG.GMAIL_STATUS) {
    getAccountStatus(!!msg.payload?.interactive)
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === MSG.GMAIL_SIGNOUT) {
    signOut()
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
  const mode = payload.mode || 'messages';
  const template =
    (settings.templates || []).find((t) => t.id === payload.templateId) || null;
  const channel = payload.channel || settings.defaultChannel || 'linkedin';

  const system =
    mode === 'callnotes'
      ? buildCallNotesSystemPrompt(settings)
      : buildSystemPrompt(settings, template, channel);
  const user = buildUserPrompt(payload.scraped);
  const schema = mode === 'callnotes' ? CALL_NOTES_SCHEMA : VARIANTS_SCHEMA;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const out = await gen({
      apiKey,
      model,
      temperature: settings.temperature,
      system,
      user,
      schema,
      signal: controller.signal,
    });

    if (mode === 'callnotes') {
      if (!out || typeof out.snapshot !== 'string') {
        const err = new Error('Model output did not match the call-notes format.');
        err.raw = JSON.stringify(out).slice(0, 500);
        throw err;
      }
      return { notes: out, model, provider };
    }

    if (!Array.isArray(out?.variants)) {
      const err = new Error('Model output did not contain a "variants" list.');
      err.raw = JSON.stringify(out).slice(0, 500);
      throw err;
    }
    return { variants: out.variants, model, provider, templateName: template?.name || '' };
  } finally {
    clearTimeout(timeout);
  }
}

// Web-search research brief via the configured provider. 90s budget — server-
// side web search rounds are slow.
async function handleResearch(payload) {
  const settings = await getSettings();
  const provider = settings.provider || 'openai';
  const apiKey = settings.keys?.[provider] || '';
  if (!apiKey) {
    const e = new Error(`No ${provider} API key set. Open Settings to add one.`);
    e.code = 'NO_KEY';
    throw e;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    return await research({
      provider,
      apiKey,
      model: settings.models?.[provider] || '',
      scraped: payload.scraped,
      company: payload.company,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ---- company people finder -------------------------------------------------
// On a company page: scrape the company card from the OPEN tab, then run each
// configured keyword search on the company's /people/ tab in a background tab
// (sequential, one at a time — same cautious posture as handleFetchActivity),
// dedupe by profile URL, and rank with the LLM (title heuristics as fallback).

const TITLE_SCORES = [
  [/founder|ceo|chief executive/i, 10],
  [/cto|chief technology|vp.{0,4}eng|head of eng|director of eng/i, 9],
  [/talent|recruit/i, 8],
  [/\bhr\b|human resources|people (ops|operations|team|partner)|chief people/i, 7],
  [/hiring manager|engineering manager/i, 6],
  [/coo|chief operating|operations/i, 5],
];

// Headlines naming a DIFFERENT company ("Founder at OtherCo") are probably
// alumni/vendors the People tab surfaced, not staff — floor them before any
// title keyword can inflate them.
function heuristicScore(title, companyName) {
  const t = title || '';
  const m = t.match(/(?:\bat\b|@)\s*([A-Za-z0-9&.\- ]{2,40})/i);
  if (m && companyName) {
    const named = m[1].trim().toLowerCase();
    const cn = companyName.toLowerCase();
    if (named && !named.includes(cn.slice(0, 6)) && !cn.includes(named.split(' ')[0])) return 2;
  }
  for (const [re, score] of TITLE_SCORES) if (re.test(t)) return score;
  return 2;
}

async function scrapeInBackgroundTab(url, file) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id, 20000);
    await delay(2500); // let lazily-loaded results render
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [file],
    });
    return results?.[results.length - 1]?.result || null;
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

async function handleFindPeople({ tabId, companyUrl }) {
  const m = (companyUrl || '').match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!m) throw new Error('This is not a LinkedIn company page.');
  const slug = m[1];

  // Company card from the tab the user is looking at.
  let company = { name: slug };
  if (tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/company-scraper.js'],
      });
      company = results?.[results.length - 1]?.result || company;
    } catch {
      /* company card is nice-to-have */
    }
  }

  const settings = await getSettings();
  const keywords = (settings.peopleKeywords || []).filter(Boolean).slice(0, 6);
  if (!keywords.length) throw new Error('No people-search keywords configured (see Settings).');

  const byUrl = new Map();
  for (const kw of keywords) {
    const url = `https://www.linkedin.com/company/${slug}/people/?keywords=${encodeURIComponent(kw)}`;
    try {
      const data = await scrapeInBackgroundTab(url, 'src/content/people-scraper.js');
      for (const p of data?.people || []) {
        if (!byUrl.has(p.url)) byUrl.set(p.url, { ...p, matchedKeyword: kw });
      }
    } catch {
      /* one failed query shouldn't kill the run */
    }
  }

  const people = Array.from(byUrl.values()).slice(0, 30);
  if (!people.length) {
    throw new Error(
      'No people found. LinkedIn may have shown a login/consent wall in the background tab, or the people tab is hidden for this company.',
    );
  }

  // Heuristic scores first — they also serve as the no-API-key fallback.
  for (const p of people) p.score = heuristicScore(p.title, company?.name);
  let companyFit = null;

  const provider = settings.provider || 'openai';
  const apiKey = settings.keys?.[provider] || '';
  if (apiKey) {
    try {
      const { system, user } = buildPeopleRankPrompt(company, people);
      const gen = ADAPTERS[provider] || openaiGenerate;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const out = await gen({
          apiKey,
          model: settings.models?.[provider] || '',
          temperature: 0.2,
          system,
          user,
          schema: PEOPLE_RANK_SCHEMA,
          signal: controller.signal,
        });
        for (const r of out?.ranked || []) {
          const p = people[r.index];
          if (!p) continue;
          p.score = r.score;
          p.why = r.why;
          p.angle = r.angle;
        }
        companyFit = out?.companyFit || null;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      /* ranking is best-effort — heuristic scores already set */
    }
  }

  people.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { company, companyFit, people };
}

// Phase 2 (opt-in): open the prospect's activity page in a BACKGROUND tab,
// scrape more posts, then close it. This navigates LinkedIn programmatically —
// the side panel surfaces that and keeps it user-initiated, one profile at a time.
async function handleFetchActivity(profileUrl) {
  const activityUrl = toActivityUrl(profileUrl);
  if (!activityUrl) throw new Error('Could not derive the activity URL from this profile.');
  const data = await scrapeInBackgroundTab(activityUrl, 'src/content/activity-scraper.js');
  return { posts: (data && data.posts) || [] };
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
