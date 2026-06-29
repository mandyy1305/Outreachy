// Gmail send via the Gmail REST API. OAuth is handled by chrome.identity using
// the manifest `oauth2` block (client_id + gmail.send scope). Runs in the
// service worker (chrome.identity is available there, not in content scripts).
//
// Setup is documented in the README: create a Google Cloud OAuth client of type
// "Chrome Extension" for this extension's ID, enable the Gmail API, and put the
// client_id in manifest.json's oauth2.client_id.

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

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
