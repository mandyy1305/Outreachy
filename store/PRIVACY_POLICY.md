# RemoteStar Outreach Assistant — Privacy Policy

_Last updated: July 3, 2026_

RemoteStar Outreach Assistant is an internal tool for RemoteStar
(remotestar.io) employees. It helps our team draft personalized outreach
messages from LinkedIn pages they are viewing.

## What the extension processes

- **LinkedIn page content**: when you click "Scrape" or "Find people", the
  extension reads the text of the LinkedIn page you are viewing (name,
  headline, work history, posts, or company details). This happens only on
  your explicit action.
- **Generated drafts**: messages, research briefs, and call notes generated
  from that content.
- **Your settings**: API keys, writing templates, and preferences you enter.
- **Your Google account email address**: shown in the UI so you know which
  Gmail account will send email.

## Where data goes

- Page content and drafts are sent to the AI provider **you configure**
  (OpenAI or Anthropic) using **your own API key**, solely to generate drafts
  and research briefs.
- If you use contact lookup, the profile URL is sent to SignalHire using your
  own SignalHire API key.
- If you send an email, it is sent through Google's Gmail API from **your own
  Google account**, only after you click Send.
- **RemoteStar operates no server for this extension.** We do not collect,
  receive, store, sell, or share any of this data. Everything else (settings,
  history) is stored locally in your browser via Chrome's extension storage
  and can be deleted at any time by clearing history in the extension or
  removing the extension.

## Authentication

Google sign-in uses OAuth through Chrome. The extension requests the
`gmail.send` scope (send email only — it cannot read your inbox) and
`userinfo.email` (display which account is signed in). Tokens are stored
locally in your browser and are never transmitted to RemoteStar.

## Contact

Questions: rudraksha.singh@remotestar.io
