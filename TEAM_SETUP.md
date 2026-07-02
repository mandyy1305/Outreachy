# Team setup — 5 minutes

Everything org-level (Google Cloud, OAuth, extension ID) is already done.
You only need these four steps.

## 1. Get the code

Clone the repo (or pull latest if you have it):

```
git clone git@github.com:mandyy1305/Outreachy.git
```

## 2. Load the extension

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select the `Outreachy` folder
4. Confirm the ID shown on the card is `hfiknggcdepgdcinpjeigblhnllckbag`
   (it will be — it's pinned in the manifest)
5. Pin the extension from the puzzle-piece menu

## 3. Import team settings

1. Ask Rudraksha for `remotestar-outreach-settings.json` (contains the API
   keys — it's shared privately, don't repost it)
2. Click the extension icon → ⚙ Settings → **Team setup → Import settings**
3. Set **Your name** (used in email signatures) → **Save settings**

## 4. Sign in to Gmail

In the side panel footer, click **sign in** and pick your **@remotestar.io**
account in the Google popup. The footer should show
"✉ sending as you@remotestar.io". Mail you send goes from YOUR mailbox.

## Daily use (30-second version)

- **Company page** → 🎯 *Find people to pitch* → ranked list → *Open profile*
- **Profile** → *Scrape* → (optional) 🔎 *Deep research* → *Generate messages*
  or 📋 *Call notes*
- Email channel: pick a design, *Preview*, *Send email* — or *Copy* and paste
  into LinkedIn

When the code updates: `git pull`, then hit ↻ on the extension card.
