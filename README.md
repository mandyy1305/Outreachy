# RemoteStar Outreach Assistant

A Chrome (Manifest V3) extension that helps you write short, personalized LinkedIn
outreach messages for **RemoteStar**. While you're on someone's profile, it reads
their headline, work history, About, and recent activity, sends that plus the
RemoteStar pitch to OpenAI, and gives you **2–3 message variants** to choose from.
You copy the best one and paste it into LinkedIn yourself. Every generation is saved
to a local, re-copyable **history**.

## What it does (and doesn't)

- ✅ Reads the profile page **you are viewing**, only when you click **Scrape**.
- ✅ Generates message variants with an LLM; you review, copy, and send manually.
- ✅ Keeps a local history you can browse and re-copy.
- ❌ Does **not** auto-connect, auto-message, or send anything on your behalf.
- ❌ Does **not** crawl, enumerate connections, or run in the background.

> Automated reading of LinkedIn may violate its User Agreement. This design stays at
> the lowest-risk end (read-only, user-initiated, one profile at a time, no auto-send),
> but use it at your discretion and keep volume human-paced.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or Edge).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `linkedin-outreach-extension/` folder.
4. Pin the extension from the puzzle-piece menu.

## First-time setup

1. Click the extension icon → in the side panel, click the **⚙** (Settings).
2. Choose a **provider** (OpenAI or Anthropic), paste that provider's **API key**, and
   confirm the **model** (defaults: `gpt-4o-mini` for OpenAI, `claude-opus-4-8` for Anthropic).
   Keys: <https://platform.openai.com/api-keys> · <https://console.anthropic.com/>
3. Set your **writing style** — a short description is pre-filled, and you can paste a few of
   your own past outreach messages so the model mirrors your voice (strongest signal).
4. Pick a default tone. Save.

Each provider's key is stored separately and locally (`chrome.storage.local`), in plaintext,
on this device only. Keys are never synced to your Google account and are sent only to the
selected provider.

## Using it

1. Open a LinkedIn profile (`linkedin.com/in/…`).
2. Click the extension icon to open the side panel.
3. Click **Scrape this profile**. Review the fields — badges show what was read
   (`read` / `not found` / `error`). Edit or fill anything by hand.
4. Pick a tone, click **Generate messages**.
5. Click **Copy** on the variant you like, then paste it into LinkedIn's message box.
6. Find past messages under the **History** tab; expand to see all variants and re-copy.
   The toolbar there also **exports/imports** your history as JSON.

### Optional: fetch more posts

After scraping, **Fetch full recent posts…** opens the prospect's activity page briefly in a
background tab to pull more of their recent posts into the activity field. This navigates
LinkedIn programmatically, so use it sparingly.

## Project layout

```
manifest.json
src/
  background/service-worker.js   # opens side panel; routes scrape + LLM calls
  content/selectors.js           # LinkedIn DOM strategies — fix HERE when LinkedIn changes
  content/scraper.js             # runs the strategies, returns per-field {value,status}
  content/activity-scraper.js    # scrapes the /recent-activity/all/ page (opt-in)
  sidepanel/                     # main UI: scrape → review → generate → copy → history
  options/                       # settings: provider, keys, models, tone, style, prompt overrides
  lib/storage.js                 # the only module that touches chrome.storage
  lib/llm-openai.js              # OpenAI adapter (provider seam: generate())
  lib/llm-anthropic.js           # Anthropic adapter (same generate() contract)
  lib/prompt.js                  # RemoteStar context + style + prompt assembly + JSON schema
  lib/messages.js                # shared message-type constants
assets/                          # icons
```

## Maintenance note

LinkedIn's DOM is obfuscated and changes often. When the scraper stops reading a
field, fix the strategies in **`src/content/selectors.js`** — that's the single place
selectors live. The mandatory review step means a broken selector just shows up as a
`not found` / `error` badge you can correct by hand, never a silently bad message.

## Editing the code

After changing any file: go to `chrome://extensions`, click the **reload** ↻ on the
extension card, then reload the LinkedIn tab so the freshly injected scraper is current.
Use **Inspect views: service worker** and the side panel's own DevTools for logs.
