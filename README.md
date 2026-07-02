# RemoteStar Outreach Assistant

A Chrome (Manifest V3) extension for the RemoteStar team: find, research, and
reach the right people to pitch — from the LinkedIn page you're viewing.

- **On a profile** (`/in/…`): scrape it, optionally run a **deep research** brief
  (provider web search), then generate personalized **message variants**
  (LinkedIn DM / WhatsApp / email) or **call-prep notes**.
- **On a company page** (`/company/…`): **Find people to pitch** — runs your
  configured searches on the company's People tab, then ranks who's worth
  contacting (founders, engineering leaders, talent/HR) with a one-line why + angle.
- **Email**: pick a design (plain / clean / branded card), preview it, and send
  from **your own** @remotestar.io Gmail — every teammate signs in with their own
  Google account (see footer of the side panel).
- Everything is saved to a local, re-copyable **history**.

## What it does (and doesn't)

- ✅ Reads LinkedIn pages **you are viewing**, only when you click a button.
- ✅ Generates message variants / call notes with an LLM; you review before anything is sent.
- ✅ Keeps a local history you can browse and re-copy.
- ❌ Does **not** auto-connect, auto-message, or send anything without a click.
- ❌ Does **not** crawl or run in the background on its own.

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

## Company people finder

On a `linkedin.com/company/…` page, the side panel shows **🎯 Find people to
pitch**. It runs each search from Settings ("People searches", e.g. `founder OR
CEO`, `talent acquisition OR recruiter`) against the company's People tab — one
background tab at a time — dedupes the results, and ranks them with your LLM
for "who would buy RemoteStar", each with a one-line *why* and a suggested
opening *angle*. Click **Open profile →** on a person and continue with the
normal scrape → research → generate flow. Results are saved to History.

## Deep research

After scraping a profile, **🔎 Deep research** uses your configured provider's
web search (OpenAI Responses `web_search` / Anthropic `web_search` tool) to
build a short brief: company stage & funding, hiring signals, the person's
public footprint, and 3 outreach hooks. The brief lands in an editable
**Research** box and is fed into both message generation and call notes. It
costs provider tokens per click; use it for prospects worth the effort.

## Call notes

**📋 Call notes** generates a call-prep brief for the scraped prospect instead
of outreach messages: snapshot, hooks, pitch angles mapped to RemoteStar
differentiators, discovery questions, likely objections with responses, and the
next-step ask. Copy as markdown; every brief is kept in History.

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

### Email designs

On the email channel, pick a design next to the channel selector — **Plain
text** (best deliverability), **Clean** (typographic HTML with a subtle accent
and signature), or **Card** (branded header + a "Book a quick call" button
pointing at the booking link from Settings). **Preview** on any variant shows
the real rendered email; HTML designs are sent as `multipart/alternative` with
a plain-text fallback. Set your signature name, default design, and booking
link in Settings → Email appearance.

## Gmail setup (one-time, for the whole team)

The extension sends through the **Gmail API** using Google sign-in
(`chrome.identity`). Mail is always sent as **whoever signed in** — the side
panel footer shows "✉ sending as …" with a **switch** action, so every teammate
uses their own @remotestar.io mailbox. No SMTP, no app passwords.

The extension's ID is **pinned** via the `"key"` field in `manifest.json`
(`hfiknggcdepgdcinpjeigblhnllckbag` on every machine), so ONE OAuth client works
for everyone. A Workspace admin sets it up once:

1. In [Google Cloud Console](https://console.cloud.google.com/) (signed in under
   the remotestar.io org): create a project, then **APIs & Services → Library →
   Gmail API → Enable**.
2. **APIs & Services → OAuth consent screen** → User type: **Internal**.
   (Internal = only @remotestar.io accounts can use it, no Google verification,
   no test-user list needed — this is what makes it team-wide.)
   Add the scopes `gmail.send` and `userinfo.email`.
3. **Clients → Create client → Application type: Web application** and add this
   **Authorized redirect URI**:
   `https://hfiknggcdepgdcinpjeigblhnllckbag.chromiumapp.org/`
   ("Web application" is correct even though this is an extension — sign-in
   runs through `launchWebAuthFlow`, which shows a normal Google account
   chooser so users can send from their work account no matter which account
   Chrome itself is signed into.)
4. Paste the generated **client ID** into `manifest.json` →
   `"oauth2": { "client_id": "…apps.googleusercontent.com" }`, commit, and have
   everyone reload.
5. First **Send email** (or clicking **sign in** in the footer), Google asks each
   user to sign in and grant `gmail.send`. Done.

> Scopes requested: `gmail.send` (send only — no inbox read access) and
> `userinfo.email` (to show which account the extension will send as).
> The private key matching the manifest `"key"` is NOT in this repo — it's only
> needed if we later publish to the Chrome Web Store under the same ID.

## Project layout

```
manifest.json                    # pinned "key" (stable team extension ID) + oauth2 client
src/
  background/service-worker.js   # routes: scrape, generate (messages/callnotes), people finder, research, gmail
  content/selectors.js           # LinkedIn profile DOM strategies — fix HERE when LinkedIn changes
  content/scraper.js             # runs the strategies, returns per-field {value,status}
  content/activity-scraper.js    # scrapes the /recent-activity/all/ page (opt-in)
  content/company-scraper.js     # scrapes an open /company/ page (name, tagline, size…)
  content/people-scraper.js      # scrapes /company/…/people/?keywords= result cards
  sidepanel/                     # main UI: scrape/find-people → research → generate → send → history
  options/                       # settings: provider keys, people searches, email appearance, style
  lib/storage.js                 # the only module that touches chrome.storage
  lib/llm-openai.js              # OpenAI adapter (provider seam: generate(), schema-agnostic)
  lib/llm-anthropic.js           # Anthropic adapter (same generate() contract)
  lib/research.js                # web-search research brief (OpenAI Responses / Anthropic tools)
  lib/email-designs.js           # plain/clean/card HTML email rendering
  lib/signalhire.js              # SignalHire Person API — email/phone lookup
  lib/gmail.js                   # Gmail API send + account status via chrome.identity OAuth
  lib/prompt.js                  # RemoteStar context + prompts + schemas (variants, call notes, people rank)
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
