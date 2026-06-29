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
3. Set your **writing style** / **templates** — see below. Save.
4. (Optional) For contact lookup, paste a **SignalHire API key**. For sending email, do the
   one-time **Gmail setup** below.

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

## Channels (LinkedIn / WhatsApp / Email)

Pick a **Channel** in the compose view before generating — it tailors the message format
(WhatsApp is short and casual; Email gets a subject line and greeting/sign-off; LinkedIn is a DM).

For WhatsApp and Email, a **contact block** appears with a **Find email & phone (SignalHire)**
button:

- **Find** calls SignalHire's Person API for the open profile and fills in the email/phone (both
  editable). Requires a SignalHire API key in Settings; it's a paid API and consumes a credit per reveal.
- Each generated variant then gets a channel action: **Copy** (all channels), **Send on WhatsApp**
  (opens `wa.me` with the phone + message), or **Send email** (Gmail API).
- Variant bodies are editable in place, so you can tweak before copying/sending.

## Gmail setup (for "Send email")

The extension sends through the **Gmail API** using Google sign-in (`chrome.identity`) — no SMTP,
no app password (browsers can't do SMTP). One-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com/): create a project, then
   **APIs & Services → Library → Gmail API → Enable**.
2. **APIs & Services → OAuth consent screen**: set it up (External is fine), and add your own
   Google address as a **Test user**.
3. Load this extension unpacked first (so it has an ID), copy the **extension ID** from
   `chrome://extensions`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Application type:
   Chrome Extension**, and paste that extension ID.
5. Copy the generated **client ID** and paste it into `manifest.json` →
   `"oauth2": { "client_id": "…apps.googleusercontent.com" }`, then reload the extension.
6. First time you click **Send email**, Google will ask you to sign in and grant the
   `gmail.send` scope. Sent mail goes from your signed-in Google account.

> The only scope requested is `gmail.send` (send only — no inbox read access).

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
  lib/signalhire.js              # SignalHire Person API — email/phone lookup
  lib/gmail.js                   # Gmail API send via chrome.identity OAuth
  lib/prompt.js                  # RemoteStar context + style + channel + prompt assembly + schema
  lib/messages.js                # shared message-type + channel constants
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
