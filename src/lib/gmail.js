// Gmail send via the Gmail REST API. OAuth is handled by chrome.identity using
// the manifest `oauth2` block (client_id + scopes). Runs in the service worker
// (chrome.identity is available there, not in content scripts).
//
// Multi-user: mail is sent as WHOEVER granted the token (`users/me`), so each
// teammate signs in with their own @remotestar.io account. Setup is documented
// in the README: an Internal-consent OAuth client of type "Chrome Extension"
// bound to this extension's pinned ID (see "key" in manifest.json).

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

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
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
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

// Forget the cached token so the next send/sign-in picks an account fresh.
export async function signOut() {
  try {
    const token = await getToken(false);
    if (token) await removeCachedToken(token);
  } catch {
    /* nothing cached */
  }
  await new Promise((resolve) => {
    try {
      chrome.identity.clearAllCachedAuthTokens(resolve);
    } catch {
      resolve();
    }
  });
  return true;
}

export async function sendEmail({ to, subject, body }) {
  if (!to) throw new Error('No recipient email address.');

  let token = await getToken(true);
  const raw = buildRawMessage({ to, subject, body });

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

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        const err = chrome.runtime.lastError;
        if (err || !token) {
          reject(
            new Error(
              (err && err.message) ||
                'Could not get a Google auth token. Is the OAuth client_id set in manifest.json and the Gmail API enabled?',
            ),
          );
        } else {
          resolve(token);
        }
      });
    } catch (e) {
      reject(new Error(`chrome.identity unavailable: ${e.message}`));
    }
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    try {
      chrome.identity.removeCachedAuthToken({ token }, resolve);
    } catch {
      resolve();
    }
  });
}

function postSend(token, raw) {
  return fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

function buildRawMessage({ to, subject, body }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject || ''}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  const mime = headers.join('\r\n') + '\r\n\r\n' + (body || '');
  return base64Url(mime);
}

// UTF-8 safe base64url (TextEncoder is available in the service worker).
function base64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
