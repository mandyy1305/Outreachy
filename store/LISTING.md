# Chrome Web Store listing — copy-paste pack

Everything the Developer Dashboard asks for, in the order it asks.

## Store listing tab

**Title**: RemoteStar Outreach Assistant

**Summary (132 chars max)**:
Internal RemoteStar tool: research prospects and draft personalized outreach from the LinkedIn page you're viewing.

**Description**:
Internal tool for the RemoteStar business-development team.

While you view a LinkedIn profile or company page, the assistant helps you:
• Read the open page (only when you click) and review the extracted details
• Build an optional research brief on the prospect using your configured AI provider
• Draft personalized outreach message variants (LinkedIn DM, WhatsApp, or email) and call-preparation notes, which you review and edit before anything is sent
• On a company page, run your configured searches on the People tab and rank likely contacts
• Send an email you approved via your own signed-in Gmail account

Nothing is sent, posted, or connected automatically. Every action is user-initiated, and all history is stored locally in your browser. Sign-in is restricted to remotestar.io Google Workspace accounts.

**Category**: Workflow & Planning (or Productivity → Communication)

**Language**: English

**Screenshots**: at least one, 1280×800 or 640×400 PNG. Take one of the side
panel open on a LinkedIn profile with generated variants visible (crop/resize —
ask Claude to `sips` it to size).

## Privacy tab

**Single purpose description**:
Helps RemoteStar's internal team draft personalized recruiting-sales outreach (messages, emails, call notes) from the LinkedIn page the user is currently viewing, at the user's request.

**Permission justifications**:

- `activeTab` / `scripting`: Reads the LinkedIn profile or company page the user is viewing, only when the user clicks "Scrape" / "Find people", to extract the text the drafts are based on.
- `sidePanel`: The entire UI lives in Chrome's side panel next to the LinkedIn tab.
- `storage`: Stores the user's settings (API keys, templates) and a local history of generated drafts. Nothing is synced or sent to our servers.
- `identity` / `identity.email`: Google sign-in (OAuth) so the user can send an email they approved from their own Gmail account, and to display which account is signed in.
- Host `linkedin.com`: The pages being read (user-initiated, one page at a time).
- Host `api.openai.com` / `api.anthropic.com`: The user's own AI provider key generates the drafts and research briefs.
- Host `signalhire.com`: Optional contact lookup (email/phone) using the user's own SignalHire API key.
- Host `gmail.googleapis.com` / `googleapis.com`: Sending the user-approved email via the Gmail API and reading the signed-in account's email address.

**Remote code**: No, all code is packaged.

**Data usage disclosures** (check exactly these):
- Personally identifiable information: YES (name/contact info of prospects processed to draft messages) — transferred to third parties? NO (goes only to the user's own configured AI provider; not sold; not used for unrelated purposes)
- Authentication information: NO (OAuth tokens stay in the browser)
- Website content: YES (text of the LinkedIn page the user chooses to read)
- Certifications at the bottom: check all three (no sale, no unrelated use, no creditworthiness use)

**Privacy policy URL**: host `store/PRIVACY_POLICY.md` somewhere public first —
e.g. a page on remotestar.io (ask Claude to add it to the landing repo) or a
public GitHub gist — then paste that URL here.

## Distribution tab

- **Visibility**: Unlisted
  (Not searchable or browsable — installable only via the direct link. Works
  from any developer account. Treat the install link as internal: share it in
  the team channel, not publicly. The extension is inert for outsiders anyway —
  Gmail sign-in is locked to remotestar.io accounts and the API keys travel
  separately in the settings file.)

## After it's approved

- Install link: `https://chromewebstore.google.com/detail/hfiknggcdepgdcinpjeigblhnllckbag`
  (assuming the store honors our pinned ID — see note below)
- Teammates: open link with their work account → Add to Chrome → import the
  settings file → sign in. They should REMOVE any load-unpacked copy first.
- Updates: bump `version` in manifest.json, re-zip, upload in the dashboard —
  everyone auto-updates within hours.

## ID note

The upload zip includes the manifest `"key"`, which the store uses to keep our
pinned extension ID (`hfiknggcdepgdcinpjeigblhnllckbag`) — so Gmail OAuth keeps
working unchanged. If the store were to assign a different ID anyway, the only
fix needed is adding `https://<new-id>.chromiumapp.org/` as a second redirect
URI on the "Web application" OAuth client — one minute in the Cloud Console.
