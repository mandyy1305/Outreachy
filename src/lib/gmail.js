// Gmail send via the Gmail REST API. OAuth uses chrome.identity.launchWebAuthFlow
// (NOT getAuthToken): it pops a normal Google account chooser, so users pick any
// Google account — independent of which account Chrome-the-browser is signed
// into. Crucial for teammates who keep a personal account as their Chrome
// identity but send work mail from @remotestar.io.
//
// Token model: implicit grant (response_type=token, ~1h expiry) cached in
// chrome.storage.local. Renewal is silent (prompt=none) while the user has a
// live Google web session for that account; otherwise we re-prompt.
//
// GCP setup (README): OAuth client of type "Web application" whose authorized
// redirect URI is this extension's chromiumapp.org URL. The client_id lives in
// manifest.json's oauth2 block.

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_KEY = 'gmailToken';

const CLIENT_ID = chrome.runtime.getManifest().oauth2.client_id;
const SCOPES = chrome.runtime.getManifest().oauth2.scopes.join(' ');

// Who is Gmail configured to send as right now?
//   { signedIn: true, email }       — token available (silently or cached)
//   { signedIn: false, error? }     — needs interactive sign-in (or bad client_id)
// interactive=true triggers the Google sign-in popup when needed.
export async function getAccountStatus(interactive = false) {
  let token;
  try {
    token = await getToken(interactive);
  } catch (e) {
    return { signedIn: false, error: e.message };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`userinfo ${res.status}`);
    const j = await res.json();
    return { signedIn: true, email: j.email || '(unknown account)' };
  } catch (e) {
    // Token exists but userinfo failed (e.g. scope not granted yet on an old
    // cached token) — drop it so the next attempt re-consents cleanly.
    await removeCachedToken(token);
    return { signedIn: false, error: e.message };
  }
}

// Forget the cached token so the next send/sign-in picks an account fresh
// (the interactive flow uses prompt=select_account, so switching = sign out
// then sign in and pick the other account).
export async function signOut() {
  await chrome.storage.local.remove(TOKEN_KEY);
  return true;
}

export async function sendEmail({ to, subject, body, html }) {
  if (!to) throw new Error('No recipient email address.');

  let token = await getToken(true);
  const raw = buildRawMessage({ to, subject, body, html });

  let res = await postSend(token, raw);
  if (res.status === 401) {
    // Token expired/stale — drop it and retry once with a fresh one.
    await removeCachedToken(token);
    token = await getToken(true);
    res = await postSend(token, raw);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || '';
    } catch {
      /* non-JSON */
    }
    throw new Error(detail ? `Gmail error: ${detail}` : `Gmail send failed (${res.status}).`);
  }
  return true;
}

async function storedToken() {
  const o = await chrome.storage.local.get(TOKEN_KEY);
  const t = o[TOKEN_KEY];
  // 60s safety margin so we never hand out a token that dies mid-request.
  return t && t.token && t.expiry > Date.now() + 60000 ? t.token : null;
}

function buildAuthUrl(interactive) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPES,
    // select_account = always show the chooser, so users can pick their work
    // account even when a personal one is also signed in. none = silent renew.
    prompt: interactive ? 'select_account' : 'none',
  });
  return `${AUTH_URL}?${p}`;
}

async function webAuth(interactive) {
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({
      url: buildAuthUrl(interactive),
      interactive,
    });
  } catch (e) {
    throw new Error(
      interactive
        ? `Google sign-in did not complete: ${e.message || 'window closed'}`
        : 'Silent sign-in unavailable.',
    );
  }
  if (!redirect) throw new Error('Google sign-in returned no response.');
  const params = new URLSearchParams(new URL(redirect).hash.replace(/^#/, ''));
  const token = params.get('access_token');
  if (!token) throw new Error(`Google returned no token (${params.get('error') || 'unknown error'}).`);
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
  await chrome.storage.local.set({ [TOKEN_KEY]: { token, expiry: Date.now() + expiresIn * 1000 } });
  return token;
}

async function getToken(interactive) {
  const cached = await storedToken();
  if (cached) return cached;
  try {
    return await webAuth(false); // silent renew off the Google web session
  } catch {
    if (!interactive) throw new Error('Not signed in.');
  }
  return webAuth(true);
}

function removeCachedToken() {
  return chrome.storage.local.remove(TOKEN_KEY);
}

function postSend(token, raw) {
  return fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

// Plain text only -> a simple text/plain message. With `html` -> a
// multipart/alternative message where `body` is the text fallback part.
function buildRawMessage({ to, subject, body, html }) {
  const top = [`To: ${to}`, `Subject: ${subject || ''}`, 'MIME-Version: 1.0'];

  if (!html) {
    const headers = [...top, 'Content-Type: text/plain; charset="UTF-8"'];
    return base64Url(headers.join('\r\n') + '\r\n\r\n' + (body || ''));
  }

  const boundary = 'rs_' + Math.random().toString(36).slice(2);
  const headers = [...top, `Content-Type: multipart/alternative; boundary="${boundary}"`];
  const mime = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body || '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    `--${boundary}--`,
  ].join('\r\n');
  return base64Url(mime);
}

// UTF-8 safe base64url (TextEncoder is available in the service worker).
function base64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
